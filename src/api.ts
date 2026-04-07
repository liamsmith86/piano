import type {
  NoteEvent, SongInfo, HandSelection, AppMode, PlaybackState, PracticeState,
  AppEventName, AppEventMap,
} from './types';
import { PRELOADED_SONGS, filenameToTitle } from './types';
import { EventEmitter } from './events';
import { ScoreRenderer } from './score/ScoreRenderer';
import { ScoreAnalyzer } from './score/ScoreAnalyzer';
import { AudioEngine } from './audio/AudioEngine';
import { InputManager } from './input/InputManager';
import { MidiInput } from './input/MidiInput';
import { VirtualKeyboard } from './input/VirtualKeyboard';
import { KeyboardInput } from './input/KeyboardInput';
import { PlayMode } from './modes/PlayMode';
import { PracticeMode } from './modes/PracticeMode';
import { ScoreInteraction } from './score/ScoreInteraction';
import { FingeringComputer } from './score/FingeringComputer';
import { saveUploadedSong, getUploadedSongs, getUploadedSongData } from './storage';

export class PianoApp {
  readonly events = new EventEmitter();
  readonly renderer: ScoreRenderer;
  readonly analyzer = new ScoreAnalyzer();
  readonly audio = new AudioEngine();
  readonly inputManager = new InputManager();
  readonly midiInput: MidiInput;
  readonly keyboardInput: KeyboardInput;
  readonly playMode: PlayMode;
  readonly practiceMode: PracticeMode;
  readonly scoreInteraction: ScoreInteraction;
  readonly fingeringComputer = new FingeringComputer();

  virtualKeyboard: VirtualKeyboard | null = null;

  private currentMode: AppMode = 'play';
  private currentHand: HandSelection = 'both';
  private loadedSong: SongInfo | null = null;
  private uploadedSongs: SongInfo[] = [];
  private discoveredSongs: SongInfo[] = [];
  private loadGeneration = 0; // guards against concurrent loadSong calls

  constructor(
    scoreContainer: HTMLElement,
    keyboardContainer?: HTMLElement,
  ) {
    this.renderer = new ScoreRenderer(scoreContainer);
    this.midiInput = new MidiInput(this.inputManager);
    this.keyboardInput = new KeyboardInput(this.inputManager);

    if (keyboardContainer) {
      this.virtualKeyboard = new VirtualKeyboard(keyboardContainer, this.inputManager);
      this.virtualKeyboard.render();
    }

    this.playMode = new PlayMode(this.audio, this.renderer, this.analyzer, this.events);
    this.practiceMode = new PracticeMode(
      this.audio, this.renderer, this.analyzer,
      this.inputManager, this.virtualKeyboard, this.events,
    );
    this.scoreInteraction = new ScoreInteraction(scoreContainer, this.renderer);
    this.scoreInteraction.init();

    // Forward input events
    this.inputManager.addListener((event) => {
      this.events.emit('inputNote', event);
    });
  }

  async init(): Promise<void> {
    await this.audio.init();
    await this.midiInput.init();
    this.keyboardInput.init();
  }

  // --- Song Management ---

  async loadSong(urlOrFile: string | File): Promise<void> {
    // Guard against concurrent loads — a newer call supersedes this one
    const generation = ++this.loadGeneration;

    // Full state reset before loading new song
    this.playMode.stop();
    this.practiceMode.stop();
    this.clearLoop();
    this.scoreInteraction.clearSelection();

    if (typeof urlOrFile === 'string') {
      await this.renderer.load(urlOrFile);
      if (generation !== this.loadGeneration) return; // superseded by newer load

      // Find or create song info
      const preloaded = PRELOADED_SONGS.find(s => s.url === urlOrFile);
      if (preloaded) {
        this.loadedSong = preloaded;
      } else {
        this.loadedSong = {
          id: urlOrFile,
          title: filenameToTitle(urlOrFile.split('/').pop() ?? urlOrFile),
          url: urlOrFile,
          source: 'uploaded',
        };
      }
    } else {
      const buffer = await urlOrFile.arrayBuffer();
      if (generation !== this.loadGeneration) return; // superseded by newer load
      await this.renderer.load(buffer);
      if (generation !== this.loadGeneration) return; // superseded by newer load
      const songId = `upload-${Date.now()}`;
      const title = filenameToTitle(urlOrFile.name);
      this.loadedSong = {
        id: songId,
        title,
        url: '',
        source: 'uploaded',
      };
      // Persist to IndexedDB
      try {
        await saveUploadedSong(songId, title, buffer);
        this.uploadedSongs.push(this.loadedSong);
      } catch (err) {
        console.warn('Failed to persist uploaded song:', err);
      }
    }

    if (generation !== this.loadGeneration) return; // superseded by newer load

    // Analyze the loaded score
    const osmd = this.renderer.getOSMD();
    if (osmd) {
      this.analyzer.analyze(osmd);
      const tempo = this.analyzer.getDefaultTempo();
      this.audio.setTempo(tempo);

      // Auto-adjust virtual keyboard range to match song
      if (this.virtualKeyboard) {
        const allMidis = this.analyzer.getTimeline().flatMap(e => e.notes.map(n => n.midi));
        this.virtualKeyboard.adjustRangeForSong(allMidis);
      }
    }

    this.renderer.setHand(this.currentHand);
    this.scoreInteraction.buildMeasureMap();
    this.events.emit('loaded', { songId: this.loadedSong!.id });
  }

  async loadUploadedSongsFromStorage(): Promise<void> {
    try {
      const stored = await getUploadedSongs();
      this.uploadedSongs = stored.map(s => s.info);
    } catch (err) {
      console.warn('Failed to load uploaded songs from storage:', err);
    }
  }

  /** Discover songs from the manifest generated by the Vite plugin */
  async discoverSongs(): Promise<void> {
    try {
      const resp = await fetch('/songs/manifest.json');
      if (!resp.ok) return;
      const entries: { file: string; folder: string }[] = await resp.json();
      this.discoveredSongs = entries
        .filter(e => {
          // Skip songs already in PRELOADED_SONGS
          const url = `/songs/${e.folder}${e.file}`;
          return !PRELOADED_SONGS.some(s => s.url === url);
        })
        .map(e => ({
          id: `discovered-${e.folder}${e.file}`.replace(/[^a-z0-9]/gi, '-').toLowerCase(),
          title: filenameToTitle(e.file),
          url: `/songs/${e.folder}${e.file}`,
          source: 'preloaded' as const,
        }));
    } catch {
      // Manifest not available — no extra songs
    }
  }

  async loadSongById(id: string): Promise<void> {
    // Check preloaded first
    const preloaded = PRELOADED_SONGS.find(s => s.id === id);
    if (preloaded) {
      await this.loadSong(preloaded.url);
      return;
    }
    // Check discovered songs (from manifest)
    const discovered = this.discoveredSongs.find(s => s.id === id);
    if (discovered) {
      await this.loadSong(discovered.url);
      return;
    }
    // Check uploaded — guard against concurrent loads
    const generation = ++this.loadGeneration;
    const data = await getUploadedSongData(id);
    if (generation !== this.loadGeneration) return;
    if (data) {
      // Reset state before loading
      this.playMode.stop();
      this.practiceMode.stop();
      this.clearLoop();
      this.scoreInteraction.clearSelection();

      await this.renderer.load(data);
      if (generation !== this.loadGeneration) return;
      this.loadedSong = this.uploadedSongs.find(s => s.id === id) ?? null;
      const osmd = this.renderer.getOSMD();
      if (osmd) {
        this.analyzer.analyze(osmd);
        this.audio.setTempo(this.analyzer.getDefaultTempo());
        if (this.virtualKeyboard) {
          const allMidis = this.analyzer.getTimeline().flatMap(e => e.notes.map(n => n.midi));
          this.virtualKeyboard.adjustRangeForSong(allMidis);
        }
      }
      this.renderer.setHand(this.currentHand);
      this.scoreInteraction.buildMeasureMap();
      if (this.loadedSong) {
        this.events.emit('loaded', { songId: this.loadedSong.id });
      }
    }
  }

  getSongList(): SongInfo[] {
    return [...PRELOADED_SONGS, ...this.discoveredSongs, ...this.uploadedSongs];
  }

  getLoadedSong(): SongInfo | null {
    return this.loadedSong;
  }

  updateOverlays(settings: { showNoteNamesOnScore: boolean; showAllAccidentals: boolean; showFingering: boolean; showChords: boolean }): void {
    const osmd = this.renderer.getOSMD();
    if (!osmd) return;

    const timeline = this.analyzer.getTimeline();

    if (settings.showFingering && timeline.length > 0) {
      // Clear existing fingering before recomputing
      for (const event of timeline) {
        for (const note of event.notes) {
          note.finger = undefined;
        }
      }
      const rightEvents = this.analyzer.filterByHand('right');
      const leftEvents = this.analyzer.filterByHand('left');
      if (rightEvents.length > 0) this.fingeringComputer.compute(rightEvents, 'right');
      if (leftEvents.length > 0) this.fingeringComputer.compute(leftEvents, 'left');
    }

    const overlay = this.renderer.getOverlay();
    overlay.setShowNoteNames(settings.showNoteNamesOnScore);
    overlay.setShowAccidentals(settings.showAllAccidentals);
    overlay.setShowFingering(settings.showFingering);
    overlay.setShowChords(settings.showChords);
    overlay.update(osmd, timeline);
  }

  // --- Score State ---

  getNoteTimeline(): NoteEvent[] {
    return this.analyzer.getTimeline();
  }

  getCursorPosition(): number {
    if (this.currentMode === 'practice') {
      return this.practiceMode.getCursorIndex();
    }
    return this.playMode.getCurrentIndex();
  }

  setCursorPosition(index: number): void {
    // For practice mode, restart at the given index
    const event = this.analyzer.getEventAtIndex(index);
    if (event) {
      this.renderer.setCursorToMeasure(event.measureNumber);
    }
  }

  getExpectedNotes(): NoteEvent[] {
    if (this.currentMode !== 'practice') return [];
    const event = this.practiceMode.getCurrentEvent();
    return event ? [event] : [];
  }

  // --- Mode ---

  setMode(mode: AppMode): void {
    // Stop current mode
    if (this.currentMode === 'play') {
      this.playMode.stop();
    } else {
      this.practiceMode.stop();
    }

    this.currentMode = mode;
    this.events.emit('modeChanged', { mode });
  }

  getMode(): AppMode {
    return this.currentMode;
  }

  // --- Play Mode ---

  async play(): Promise<void> {
    if (this.currentMode === 'play') {
      await this.playMode.start();
    }
  }

  pause(): void {
    if (this.currentMode === 'play') {
      this.playMode.pause();
    }
  }

  stop(): void {
    if (this.currentMode === 'play') {
      this.playMode.stop();
    } else {
      this.practiceMode.stop();
    }
  }

  setTempo(bpm: number): void {
    this.audio.setTempo(bpm);
  }

  setTempoScale(scale: number): void {
    this.audio.setTempoScale(scale);
  }

  getPlaybackState(): PlaybackState {
    return this.playMode.getState();
  }

  // --- Practice Mode ---

  async startPractice(): Promise<void> {
    if (this.currentMode === 'practice') {
      await this.practiceMode.start();
    }
  }

  stopPractice(): void {
    this.practiceMode.stop();
  }

  simulateNoteInput(midiNumber: number): void {
    this.inputManager.simulateNoteOn(midiNumber);
  }

  simulateNoteRelease(midiNumber: number): void {
    this.inputManager.simulateNoteOff(midiNumber);
  }

  getPracticeState(): PracticeState {
    return this.practiceMode.getState();
  }

  // --- Hand Selection ---

  setHand(hand: HandSelection): void {
    this.currentHand = hand;
    this.renderer.setHand(hand);
    this.playMode.setHand(hand);
    this.practiceMode.setHand(hand);
    this.events.emit('handChanged', { hand });
  }

  getHand(): HandSelection {
    return this.currentHand;
  }

  setZoom(zoom: number): void {
    this.renderer.setZoom(zoom);
    // Re-sync cursor after zoom (OSMD re-render resets cursor to beginning)
    this.practiceMode.resyncCursor();
    this.scoreInteraction.buildMeasureMap();
    this.events.emit('zoomed', { zoom: this.renderer.getZoom() });
  }

  getZoom(): number {
    return this.renderer.getZoom();
  }

  setAccompaniment(enabled: boolean): void {
    this.practiceMode.setAccompaniment(enabled);
  }

  setAutoAdvance(timeoutMs: number): void {
    this.practiceMode.setAutoAdvance(timeoutMs);
  }

  // --- Loop ---

  setLoop(startMeasure: number, endMeasure: number): void {
    this.practiceMode.setLoop(startMeasure, endMeasure);
    this.playMode.setLoop(startMeasure, endMeasure);
  }

  clearLoop(): void {
    this.practiceMode.clearLoop();
    this.playMode.clearLoop();
  }

  getLoopRange(): { start: number; end: number } | null {
    return this.practiceMode.getLoopRange();
  }

  getTotalMeasures(): number {
    return this.renderer.getTotalMeasures();
  }

  // --- Metronome ---

  toggleMetronome(): boolean {
    if (this.audio.isMetronomeEnabled()) {
      this.audio.stopMetronome();
      return false;
    } else {
      this.audio.startMetronome();
      return true;
    }
  }

  // --- Events ---

  on<K extends AppEventName>(event: K, callback: (data: AppEventMap[K]) => void): void {
    this.events.on(event, callback);
  }

  off<K extends AppEventName>(event: K, callback: (data: AppEventMap[K]) => void): void {
    this.events.off(event, callback);
  }

  // --- Cleanup ---

  destroy(): void {
    this.playMode.stop();
    this.practiceMode.stop();
    this.scoreInteraction.destroy();
    this.audio.destroy();
    this.midiInput.destroy();
    this.keyboardInput.destroy();
    this.virtualKeyboard?.destroy();
    this.inputManager.destroy();
    this.renderer.destroy();
    this.events.removeAllListeners();
  }
}
