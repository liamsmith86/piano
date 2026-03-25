import type { AudioEngine } from '../audio/AudioEngine';
import type { ScoreRenderer } from '../score/ScoreRenderer';
import type { ScoreAnalyzer } from '../score/ScoreAnalyzer';
import type { InputManager } from '../input/InputManager';
import type { VirtualKeyboard } from '../input/VirtualKeyboard';
import type { NoteEvent, HandSelection, PracticeState, InputEvent, MeasureStats } from '../types';
import { midiToNoteName } from '../types';
import type { EventEmitter } from '../events';

export class PracticeMode {
  private audio: AudioEngine;
  private renderer: ScoreRenderer;
  private analyzer: ScoreAnalyzer;
  private inputManager: InputManager;
  private virtualKeyboard: VirtualKeyboard | null;
  private events: EventEmitter;

  private active = false;
  private cursorIndex = 0;
  private timeline: NoteEvent[] = [];
  private filteredTimeline: NoteEvent[] = [];
  private hand: HandSelection = 'both';
  private accompaniment = false;
  private loopStart: number | null = null;
  private loopEnd: number | null = null;
  private loopEnabled = false;
  private autoAdvanceTimeout: number = 0;
  private autoAdvanceTimer: ReturnType<typeof setTimeout> | null = null;
  private noteOffTimers = new Set<ReturnType<typeof setTimeout>>();

  private hitCount = new Map<number, number>(); // midi → count of hits
  private expectedMidis: number[] = [];

  // Stats
  private totalNotes = 0;
  private correctCount = 0;
  private wrongCount = 0;
  private measureStatsMap = new Map<number, MeasureStats>();
  private startTime: number | null = null;
  private streak = 0;
  private bestStreak = 0;
  private wrongNotesList: number[] = [];

  private inputHandler: (event: InputEvent) => void;

  constructor(
    audio: AudioEngine,
    renderer: ScoreRenderer,
    analyzer: ScoreAnalyzer,
    inputManager: InputManager,
    virtualKeyboard: VirtualKeyboard | null,
    events: EventEmitter,
  ) {
    this.audio = audio;
    this.renderer = renderer;
    this.analyzer = analyzer;
    this.inputManager = inputManager;
    this.virtualKeyboard = virtualKeyboard;
    this.events = events;

    this.inputHandler = (event: InputEvent) => this.handleInput(event);
  }

  async start(): Promise<void> {
    if (!this.audio.ready) {
      await this.audio.init();
    }

    this.timeline = this.analyzer.getTimeline();
    if (this.timeline.length === 0) {
      console.warn('Cannot start practice: no notes in timeline');
      return;
    }

    // Clear any visual state from previous session
    this.renderer.clearNoteHighlights();

    this.active = true;
    this.updateFilteredTimeline();
    this.cursorIndex = 0;
    this.hitCount.clear();
    this.correctCount = 0;
    this.wrongCount = 0;
    this.wrongNotesList = [];
    this.measureStatsMap.clear();
    this.lastSyncedOsmdIndex = -1;
    this.streak = 0;
    this.bestStreak = 0;
    this.startTime = Date.now();
    this.totalNotes = this.filteredTimeline.length;

    this.renderer.cursorReset();
    this.renderer.cursorShow();

    // Advance cursor to first event with notes for selected hand
    this.syncCursorToIndex();
    this.updateExpectedNotes();
    this.highlightExpected();
    this.startAutoAdvanceTimer();

    this.inputManager.addListener(this.inputHandler);
  }

  stop(): void {
    this.active = false;
    this.clearAutoAdvanceTimer();
    for (const id of this.noteOffTimers) clearTimeout(id);
    this.noteOffTimers.clear();
    this.inputManager.removeListener(this.inputHandler);
    this.renderer.clearNoteHighlights();
    this.renderer.cursorHide();
    this.virtualKeyboard?.highlightKeys([]);
  }

  private handleInput(event: InputEvent): void {
    if (!this.active || event.type !== 'noteOn') return;

    const midi = event.midiNumber;

    // Count how many times this midi is expected vs how many times hit
    const expectedCount = this.expectedMidis.filter(m => m === midi).length;
    const currentHits = this.hitCount.get(midi) ?? 0;
    const isExpected = currentHits < expectedCount;

    if (isExpected) {
      // Correct note
      this.hitCount.set(midi, currentHits + 1);
      this.audio.playNoteOn(midi, event.velocity || 0.8);
      this.virtualKeyboard?.markCorrect(midi);
      this.events.emit('noteCorrect', {
        midiNumber: midi,
        cursorIndex: this.cursorIndex,
      });

      // Reset auto-advance timer on any correct input
      this.startAutoAdvanceTimer();

      // Check if all notes in this chord are hit (count-aware)
      const allHit = this.expectedMidis.every(m => {
        const needed = this.expectedMidis.filter(x => x === m).length;
        return (this.hitCount.get(m) ?? 0) >= needed;
      });
      if (allHit) {
        this.correctCount++;
        this.streak++;
        if (this.streak > this.bestStreak) {
          this.bestStreak = this.streak;
        }
        this.trackMeasureStat(true);
        // Mark the current notes green before advancing
        this.renderer.markNotesPlayed();
        this.advanceCursor();
      }
    } else {
      // Wrong note
      this.wrongCount++;
      this.streak = 0;
      this.wrongNotesList.push(midi);
      if (this.wrongNotesList.length > 200) {
        this.wrongNotesList = this.wrongNotesList.slice(-200);
      }
      this.trackMeasureStat(false);
      this.audio.playNoteOn(midi, 0.3); // Play quietly so user hears what they pressed
      this.virtualKeyboard?.markWrong(midi);

      // Show wrong note marker on the score
      this.showWrongNoteOnStaff(midi);

      this.events.emit('noteWrong', {
        midiNumber: midi,
        expected: [...this.expectedMidis],
        cursorIndex: this.cursorIndex,
      });
    }

    // Release note after a short delay (for practice feedback)
    const timerId = setTimeout(() => {
      this.audio.playNoteOff(midi);
      this.noteOffTimers.delete(timerId);
    }, 300);
    this.noteOffTimers.add(timerId);
  }

  private advanceCursor(): void {
    const prevIndex = this.cursorIndex;
    this.cursorIndex++;

    if (this.cursorIndex >= this.filteredTimeline.length) {
      if (this.loopEnabled && this.loopStart !== null) {
        // Loop back to start of range — reset green notes for fresh visual
        this.renderer.resetPlayedNotes();
        this.cursorIndex = 0;
        this.hitCount.clear();
        this.syncCursorToIndex();
        this.updateExpectedNotes();
        this.highlightExpected();
        this.events.emit('cursorAdvanced', { from: prevIndex, to: 0 });
        return;
      }
      // Song complete
      this.active = false;
      this.clearAutoAdvanceTimer();
      this.inputManager.removeListener(this.inputHandler);
      this.renderer.clearNoteHighlights();
      this.events.emit('songEnd', { stats: this.getState() });
      return;
    }

    this.hitCount.clear();

    // Detect repeat: if next event's measure is before previous, reset green notes
    const prevEvent = this.filteredTimeline[prevIndex];
    const nextEvent = this.filteredTimeline[this.cursorIndex];
    if (prevEvent && nextEvent && nextEvent.measureNumber < prevEvent.measureNumber) {
      this.renderer.resetPlayedNotes();
    }

    // Play accompaniment for inactive hand if enabled
    if (this.accompaniment && this.hand !== 'both') {
      this.playAccompaniment(prevIndex);
    }

    this.syncCursorToIndex();
    this.updateExpectedNotes();
    this.highlightExpected();
    this.renderer.scrollToCursor();
    this.startAutoAdvanceTimer();

    this.events.emit('cursorAdvanced', { from: prevIndex, to: this.cursorIndex });
  }

  private lastSyncedOsmdIndex = -1;

  private syncCursorToIndex(): void {
    const targetEvent = this.filteredTimeline[this.cursorIndex];
    if (!targetEvent) return;

    const targetOsmdIndex = targetEvent.index;

    if (this.lastSyncedOsmdIndex >= 0 && targetOsmdIndex > this.lastSyncedOsmdIndex) {
      // Incremental advance from current position (O(delta) instead of O(n))
      const steps = targetOsmdIndex - this.lastSyncedOsmdIndex;
      for (let i = 0; i < steps; i++) {
        this.renderer.cursorNext();
      }
    } else {
      // Full reset needed (first note, loop back, or hand switch)
      this.renderer.cursorReset();
      for (let i = 0; i < targetOsmdIndex; i++) {
        this.renderer.cursorNext();
      }
    }

    this.lastSyncedOsmdIndex = targetOsmdIndex;
  }

  private updateExpectedNotes(): void {
    const event = this.filteredTimeline[this.cursorIndex];
    if (!event) {
      this.expectedMidis = [];
      return;
    }

    this.expectedMidis = event.notes.map(n => n.midi);
  }

  private highlightExpected(): void {
    this.virtualKeyboard?.highlightKeys(this.expectedMidis);
    // Highlight noteheads at current cursor position in blue
    this.renderer.highlightCurrentNotes('#3b82f6');
  }

  private trackMeasureStat(correct: boolean): void {
    const event = this.filteredTimeline[this.cursorIndex];
    if (!event) return;
    const measure = event.measureNumber;
    if (!this.measureStatsMap.has(measure)) {
      this.measureStatsMap.set(measure, { measure, correct: 0, wrong: 0 });
    }
    const stats = this.measureStatsMap.get(measure)!;
    if (correct) stats.correct++;
    else stats.wrong++;
  }

  private showWrongNoteOnStaff(wrongMidi: number): void {
    const wrongName = midiToNoteName(wrongMidi);
    this.renderer.showWrongNoteAtCursor(wrongMidi, wrongName);
  }

  private playAccompaniment(fromIndex: number): void {
    // Find the original timeline event and play notes from the other hand
    const currentEvent = this.filteredTimeline[fromIndex];
    if (!currentEvent) return;

    const fullEvent = this.timeline.find(e => e.index === currentEvent.index);
    if (!fullEvent) return;

    const otherStaff = this.hand === 'right' ? 2 : 1;
    const accompNotes = fullEvent.notes.filter(n => n.staff === otherStaff);

    for (const note of accompNotes) {
      this.audio.playNote(note.midi, note.duration, note.velocity * 0.5);
    }
  }

  private updateFilteredTimeline(): void {
    let events = this.analyzer.filterByHand(this.hand);

    // Apply measure range filter
    if (this.loopEnabled && this.loopStart !== null && this.loopEnd !== null) {
      events = events.filter(e =>
        e.measureNumber >= this.loopStart! && e.measureNumber <= this.loopEnd!
      );
    }

    this.filteredTimeline = events;
  }

  setHand(hand: HandSelection): void {
    this.hand = hand;
    if (this.active) {
      this.updateFilteredTimeline();
      this.totalNotes = this.filteredTimeline.length;
      // Reset to beginning with new filter
      this.cursorIndex = 0;
      this.hitCount.clear();
      this.syncCursorToIndex();
      this.updateExpectedNotes();
      this.highlightExpected();
    }
  }

  setAccompaniment(enabled: boolean): void {
    this.accompaniment = enabled;
  }

  isAccompanimentEnabled(): boolean {
    return this.accompaniment;
  }

  getState(): PracticeState {
    return {
      cursorIndex: this.cursorIndex,
      expectedNotes: [...this.expectedMidis],
      hitNotes: [...this.hitCount.keys()],
      wrongNotes: [...this.wrongNotesList],
      totalNotes: this.totalNotes,
      correctCount: this.correctCount,
      wrongCount: this.wrongCount,
      startTime: this.startTime,
      streak: this.streak,
      bestStreak: this.bestStreak,
      measureStats: [...this.measureStatsMap.values()].sort((a, b) => a.measure - b.measure),
    };
  }

  isActive(): boolean {
    return this.active;
  }

  getCursorIndex(): number {
    return this.cursorIndex;
  }

  getExpectedNotes(): number[] {
    return [...this.expectedMidis];
  }

  getAccuracy(): number {
    const total = this.correctCount + this.wrongCount;
    return total === 0 ? 100 : Math.round((this.correctCount / total) * 100);
  }

  getElapsedTime(): number {
    if (!this.startTime) return 0;
    return (Date.now() - this.startTime) / 1000;
  }

  // --- Auto Advance ---

  private startAutoAdvanceTimer(): void {
    this.clearAutoAdvanceTimer();
    if (this.autoAdvanceTimeout <= 0 || !this.active) return;

    this.autoAdvanceTimer = setTimeout(() => {
      if (!this.active) return;
      // Play the correct notes as a hint
      for (const midi of this.expectedMidis) {
        this.audio.playNote(midi, 0.5, 0.6);
      }
      // Mark as a wrong attempt (user didn't press in time)
      this.wrongCount++;
      this.streak = 0;
      this.trackMeasureStat(false);
      // Advance cursor
      this.hitCount.clear();
      this.advanceCursor();
    }, this.autoAdvanceTimeout);
  }

  private clearAutoAdvanceTimer(): void {
    if (this.autoAdvanceTimer !== null) {
      clearTimeout(this.autoAdvanceTimer);
      this.autoAdvanceTimer = null;
    }
  }

  setAutoAdvance(timeoutMs: number): void {
    this.autoAdvanceTimeout = timeoutMs;
    if (this.active) {
      this.startAutoAdvanceTimer();
    }
  }

  getAutoAdvanceTimeout(): number {
    return this.autoAdvanceTimeout;
  }

  // --- Loop/Measure Range ---

  setLoop(startMeasure: number, endMeasure: number): void {
    this.loopStart = startMeasure;
    this.loopEnd = endMeasure;
    this.loopEnabled = true;
    if (this.active) {
      this.updateFilteredTimeline();
      this.totalNotes = this.filteredTimeline.length;
      // Reset stats when changing loop range
      this.correctCount = 0;
      this.wrongCount = 0;
      this.measureStatsMap.clear();
      this.streak = 0;
      this.cursorIndex = 0;
      this.hitCount.clear();
      this.syncCursorToIndex();
      this.updateExpectedNotes();
      this.highlightExpected();
    }
  }

  clearLoop(): void {
    this.loopStart = null;
    this.loopEnd = null;
    this.loopEnabled = false;
    if (this.active) {
      this.updateFilteredTimeline();
      this.totalNotes = this.filteredTimeline.length;
    }
  }

  isLoopEnabled(): boolean {
    return this.loopEnabled;
  }

  getLoopRange(): { start: number; end: number } | null {
    if (!this.loopEnabled || this.loopStart === null || this.loopEnd === null) return null;
    return { start: this.loopStart, end: this.loopEnd };
  }
}
