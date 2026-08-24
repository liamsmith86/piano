import type * as ToneModule from 'tone';
import type {
  AudioLoadProgress,
  HandSelection,
  NoteEvent,
  TempoChange,
} from '../types';
import { midiToNoteName } from '../types';

type Tone = typeof import('./toneRuntime');
type AudioStateListener = (progress: AudioLoadProgress) => void;

interface PlaybackCallbacks {
  onCursorAdvance: (index: number) => void;
  onComplete: () => void;
  onCountInBeat?: (beat: number, total: number) => void;
  onCountInComplete?: () => void;
}

interface PlaybackScheduleOptions {
  tempoMap?: TempoChange[];
  leadInBeats?: number;
  loop?: boolean;
}

interface CountInTask {
  timerIds: number[];
  resolve: (completed: boolean) => void;
}

const SAMPLE_BASE_URL = 'https://tonejs.github.io/audio/salamander/';
const SAMPLE_URLS: Readonly<Record<string, string>> = {
  A0: 'A0.mp3', C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
  A1: 'A1.mp3', C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
  A2: 'A2.mp3', C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
  A3: 'A3.mp3', C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
  A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
  A5: 'A5.mp3', C6: 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
  A6: 'A6.mp3', C7: 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3',
  A7: 'A7.mp3', C8: 'C8.mp3',
};
const SAMPLE_CONCURRENCY = 6;

/**
 * Owns the shared Web Audio clock used by playback, count-in, and metronome.
 * Tone is loaded lazily, while a native AudioContext can still be unlocked in
 * the synchronous portion of an iOS user gesture.
 */
export class AudioEngine {
  private tone: Tone | null = null;
  private tonePromise: Promise<Tone> | null = null;
  private gestureContext: AudioContext | null = null;
  private sampler: ToneModule.Sampler | null = null;
  private metronomeSynth: ToneModule.Synth | null = null;
  private isReady = false;
  private initPromise: Promise<void> | null = null;
  private readonly stateListener: AudioStateListener | null;

  private scheduledEvents: number[] = [];
  private metronomeEventId: number | null = null;
  private playbackActive = false;
  private transportStartedForMetronome = false;
  private scheduleGeneration = 0;
  private lifecycleGeneration = 0;
  private destroyed = false;

  private _tempo = 120;
  private _tempoScale = 1;
  private activePlaybackTempo = 120;
  private volumeDb = -20;
  private metronomeEnabled = false;

  private countInGeneration = 0;
  private countInTask: CountInTask | null = null;

  constructor(stateListener?: AudioStateListener) {
    this.stateListener = stateListener ?? null;
    this.emitLoadState('idle', 0);
  }

  /** Download the Tone module without creating instruments or fetching samples. */
  async prepare(): Promise<void> {
    await this.loadTone();
  }

  async init(): Promise<void> {
    if (this.isReady) return;
    if (this.destroyed) throw new Error('Audio engine has been destroyed');
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.doInit().catch((error: unknown) => {
      this.initPromise = null;
      const message = error instanceof Error ? error.message : 'Unable to load piano samples';
      this.emitLoadState('error', 0, message);
      throw error;
    });
    return this.initPromise;
  }

  /**
   * Must be invoked synchronously from a click/key/touch handler. Creating and
   * resuming the native context here preserves iOS user activation even when
   * the lazily imported Tone module has not arrived yet.
   */
  unlockAudioFromGesture(): void {
    if (this.destroyed) return;
    if (!this.gestureContext) {
      const Context = window.AudioContext
        ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (Context) {
        this.gestureContext = new Context({ latencyHint: 'interactive' });
      }
    }

    void this.gestureContext?.resume().catch(() => {});
    if (this.tone) {
      this.attachGestureContext(this.tone);
      void this.tone.start().catch(() => {});
    }
  }

  /** Resume the shared context, safe to call repeatedly after the gesture path. */
  async unlockAudio(): Promise<void> {
    const tone = await this.loadTone();
    this.attachGestureContext(tone);
    await tone.start();
    if (tone.getContext().state !== 'running') {
      await tone.getContext().resume();
    }
  }

  private async loadTone(): Promise<Tone> {
    if (this.tone) return this.tone;
    if (this.destroyed) throw new Error('Audio engine has been destroyed');
    if (!this.tonePromise) {
      this.tonePromise = import('./toneRuntime').then(tone => {
        if (this.destroyed) throw new Error('Audio engine has been destroyed');
        this.attachGestureContext(tone);
        this.tone = tone;
        return tone;
      }).catch(error => {
        this.tonePromise = null;
        throw error;
      });
    }
    return this.tonePromise;
  }

  private attachGestureContext(tone: Tone): void {
    if (!this.gestureContext) return;
    const rawContext = tone.getContext().rawContext;
    if (rawContext !== this.gestureContext) {
      tone.setContext(this.gestureContext, true);
    }
  }

  private async doInit(): Promise<void> {
    const generation = this.lifecycleGeneration;
    const tone = await this.loadTone();
    await this.unlockAudio();

    const entries = Object.entries(SAMPLE_URLS);
    this.emitLoadState('loading', 0);
    const sampleBuffers = await this.loadSampleBuffers(tone, entries, generation);

    if (generation !== this.lifecycleGeneration || this.destroyed) return;

    const sampler = new tone.Sampler({
      urls: sampleBuffers,
      release: 1,
    }).toDestination();
    sampler.volume.value = this.volumeDb;

    const metronomeSynth = new tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
      volume: -15,
    }).toDestination();

    if (generation !== this.lifecycleGeneration || this.destroyed) {
      sampler.dispose();
      metronomeSynth.dispose();
      return;
    }

    this.sampler = sampler;
    this.metronomeSynth = metronomeSynth;
    this.isReady = true;
    this.emitLoadState('ready', entries.length);

    if (this.metronomeEnabled && !this.playbackActive) {
      this.startStandaloneMetronome();
    }
  }

  private async loadSampleBuffers(
    tone: Tone,
    entries: [string, string][],
    generation: number,
  ): Promise<Record<string, AudioBuffer>> {
    const result: Record<string, AudioBuffer> = {};
    const wrappers: ToneModule.ToneAudioBuffer[] = [];
    let nextIndex = 0;
    let loaded = 0;
    let firstError: Error | null = null;

    const worker = async () => {
      while (!firstError) {
        const index = nextIndex++;
        if (index >= entries.length) return;
        const [note, file] = entries[index];
        try {
          const wrapper = await tone.ToneAudioBuffer.fromUrl(`${SAMPLE_BASE_URL}${file}`);
          wrappers.push(wrapper);
          const buffer = wrapper.get();
          if (!buffer) throw new Error(`Decoded sample was empty: ${file}`);
          result[note] = buffer;
          loaded++;
          if (generation === this.lifecycleGeneration && !this.destroyed) {
            this.emitLoadState('loading', loaded);
          }
        } catch (error) {
          firstError = error instanceof Error ? error : new Error(`Failed to load ${file}`);
        }
      }
    };

    await Promise.all(
      Array.from({ length: Math.min(SAMPLE_CONCURRENCY, entries.length) }, () => worker()),
    );
    wrappers.forEach(buffer => buffer.dispose());

    if (firstError) throw firstError;
    return result;
  }

  private emitLoadState(
    state: AudioLoadProgress['state'],
    loadedSamples: number,
    error?: string,
  ): void {
    this.stateListener?.({
      state,
      loadedSamples,
      totalSamples: Object.keys(SAMPLE_URLS).length,
      ...(error ? { error } : {}),
    });
  }

  get ready(): boolean {
    return this.isReady;
  }

  setVolume(db: number): void {
    if (Number.isNaN(db)) return;
    this.volumeDb = db;
    if (this.sampler) this.sampler.volume.value = db;
  }

  getVolume(): number {
    return this.sampler?.volume.value ?? this.volumeDb;
  }

  playNote(midiNumber: number, duration = 0.5, velocity = 0.8): void {
    if (!this.sampler || !this.isReady || !this.tone) return;
    const safeDuration = Number.isFinite(duration) ? Math.max(0.01, duration) : 0.5;
    this.sampler.triggerAttackRelease(
      midiToNoteName(midiNumber), safeDuration, this.tone.now(), this.normalizeVelocity(velocity),
    );
  }

  noteOn(midiNumber: number, velocity = 0.8): void {
    if (!this.sampler || !this.isReady || !this.tone) return;
    this.sampler.triggerAttack(
      midiToNoteName(midiNumber), this.tone.now(), this.normalizeVelocity(velocity),
    );
  }

  noteOff(midiNumber: number): void {
    if (!this.sampler || !this.isReady || !this.tone) return;
    this.sampler.triggerRelease(midiToNoteName(midiNumber), this.tone.now());
  }

  private normalizeVelocity(velocity: number): number {
    return Number.isFinite(velocity) ? Math.max(0, Math.min(1, velocity)) : 0.8;
  }

  schedulePlayback(
    events: NoteEvent[],
    hand: HandSelection,
    callbacks: PlaybackCallbacks,
    options: PlaybackScheduleOptions = {},
  ): void {
    const tone = this.tone;
    if (!tone) return;

    const transport = tone.getTransport();
    transport.stop();
    this.clearPlaybackSchedule();
    this.clearMetronomeSchedule();
    this.transportStartedForMetronome = false;

    const generation = this.scheduleGeneration;
    const tempoMap = options.tempoMap ?? [];
    const leadInBeats = Math.max(0, Math.trunc(options.leadInBeats ?? 0));
    const ppq = transport.PPQ;
    this.activePlaybackTempo = tempoMap[0]?.bpm ?? this._tempo;
    transport.bpm.value = this.activePlaybackTempo * this._tempoScale;
    transport.position = 0;
    transport.loop = false;
    this.playbackActive = true;

    this.scheduleCountIn(leadInBeats, callbacks, generation, ppq);

    for (const change of tempoMap.slice(1)) {
      const tempoId = transport.schedule(time => {
        if (generation !== this.scheduleGeneration) return;
        this.activePlaybackTempo = change.bpm;
        transport.bpm.setValueAtTime(change.bpm * this._tempoScale, time);
      }, `${(leadInBeats + change.timestampBeats) * ppq}i`);
      this.scheduledEvents.push(tempoId);
    }

    const staffFilter = hand === 'both' ? null : hand === 'right' ? 1 : 2;
    for (const event of events) {
      const notes = staffFilter
        ? event.notes.filter(note => note.staff === staffFilter)
        : event.notes;
      if (notes.length === 0) continue;

      const eventId = transport.schedule(time => {
        if (generation !== this.scheduleGeneration) return;
        for (const note of notes) {
          const duration = `${Math.max(1, note.durationBeats * ppq)}i`;
          this.sampler?.triggerAttackRelease(
            midiToNoteName(note.midi), duration, time, this.normalizeVelocity(note.velocity),
          );
        }
        tone.getDraw().schedule(() => {
          if (generation === this.scheduleGeneration) callbacks.onCursorAdvance(event.index);
        }, time);
      }, `${(leadInBeats + event.timestampBeats) * ppq}i`);
      this.scheduledEvents.push(eventId);
    }

    const playbackEndBeats = this.getPlaybackEndBeats(events);
    if (options.loop && playbackEndBeats > 0) {
      transport.loopStart = `${leadInBeats * ppq}i`;
      transport.loopEnd = `${(leadInBeats + playbackEndBeats) * ppq}i`;
      transport.loop = true;
    } else if (events.length > 0) {
      const endTicks = (leadInBeats + playbackEndBeats + 0.25) * ppq;
      const endId = transport.schedule(time => {
        tone.getDraw().schedule(() => {
          if (generation === this.scheduleGeneration) callbacks.onComplete();
        }, time);
      }, `${endTicks}i`);
      this.scheduledEvents.push(endId);
    }

    if (this.metronomeEnabled) {
      this.scheduleMetronome(leadInBeats);
    }
  }

  private scheduleCountIn(
    beats: number,
    callbacks: PlaybackCallbacks,
    generation: number,
    ppq: number,
  ): void {
    if (beats === 0 || !this.tone) return;
    const tone = this.tone;
    const transport = tone.getTransport();

    for (let index = 0; index < beats; index++) {
      const beatId = transport.schedule(time => {
        if (generation !== this.scheduleGeneration) return;
        const frequency = index === 0 ? 1200 : 900;
        this.metronomeSynth?.triggerAttackRelease(frequency, '16n', time);
        tone.getDraw().schedule(() => {
          if (generation === this.scheduleGeneration) {
            callbacks.onCountInBeat?.(index + 1, beats);
          }
        }, time);
      }, `${index * ppq}i`);
      this.scheduledEvents.push(beatId);
    }

    const completeId = transport.schedule(time => {
      tone.getDraw().schedule(() => {
        if (generation === this.scheduleGeneration) callbacks.onCountInComplete?.();
      }, time);
    }, `${beats * ppq}i`);
    this.scheduledEvents.push(completeId);
  }

  private getPlaybackEndBeats(events: NoteEvent[]): number {
    let end = 0;
    for (const event of events) {
      for (const note of event.notes) {
        end = Math.max(end, event.timestampBeats + Math.max(0, note.durationBeats));
      }
    }
    return end;
  }

  async countIn(beats = 4, onBeat?: (beat: number) => void): Promise<boolean> {
    if (!this.metronomeSynth || !this.isReady || !this.tone) return true;
    this.cancelCountIn();
    const tone = this.tone;
    const generation = this.countInGeneration;
    const count = Math.max(1, Math.min(16, Math.trunc(beats)));
    const interval = 60 / (this._tempo * this._tempoScale);
    const startTime = tone.now() + 0.03;
    const timerIds: number[] = [];

    return new Promise(resolve => {
      for (let index = 0; index < count; index++) {
        const frequency = index === 0 ? 1200 : 900;
        this.metronomeSynth?.triggerAttackRelease(
          frequency, '16n', startTime + index * interval,
        );
        timerIds.push(tone.getContext().setTimeout(() => {
          if (generation === this.countInGeneration) onBeat?.(index + 1);
        }, index * interval));
      }

      timerIds.push(tone.getContext().setTimeout(() => {
        if (this.countInTask?.resolve === resolve) this.countInTask = null;
        resolve(generation === this.countInGeneration);
      }, count * interval));
      this.countInTask = { timerIds, resolve };
    });
  }

  cancelCountIn(): void {
    this.countInGeneration++;
    const task = this.countInTask;
    if (!task) return;
    this.countInTask = null;
    const context = this.tone?.getContext();
    for (const timerId of task.timerIds) context?.clearTimeout(timerId);
    task.resolve(false);
  }

  play(): void {
    this.tone?.getTransport().start();
  }

  pause(): void {
    this.tone?.getTransport().pause();
  }

  resume(): void {
    this.tone?.getTransport().start();
  }

  stop(): void {
    this.cancelCountIn();
    const tone = this.tone;
    if (!tone) return;

    const transport = tone.getTransport();
    transport.stop();
    transport.loop = false;
    this.playbackActive = false;
    this.transportStartedForMetronome = false;
    this.sampler?.releaseAll();
    this.clearPlaybackSchedule();
    this.clearMetronomeSchedule();

    if (this.metronomeEnabled && this.isReady) {
      this.startStandaloneMetronome();
    }
  }

  private clearPlaybackSchedule(): void {
    this.scheduleGeneration++;
    if (!this.tone) return;
    const transport = this.tone.getTransport();
    for (const id of this.scheduledEvents) transport.clear(id);
    this.scheduledEvents = [];
    this.tone.getDraw().cancel();
  }

  setTempo(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    this._tempo = Math.max(1, bpm);
    if (!this.playbackActive) this.activePlaybackTempo = this._tempo;
    const transport = this.tone?.getTransport();
    if (transport) {
      transport.bpm.value = this.activePlaybackTempo * this._tempoScale;
    }
  }

  getTempo(): number {
    return this._tempo;
  }

  setTempoScale(scale: number): void {
    if (!Number.isFinite(scale)) return;
    this._tempoScale = Math.max(0.25, Math.min(2, scale));
    const transport = this.tone?.getTransport();
    if (transport) {
      transport.bpm.value = this.activePlaybackTempo * this._tempoScale;
    }
  }

  getTempoScale(): number {
    return this._tempoScale;
  }

  startMetronome(): void {
    this.metronomeEnabled = true;
    if (!this.isReady || !this.tone || !this.metronomeSynth) return;
    if (this.playbackActive) {
      this.scheduleMetronome(this.getCurrentBeatOffset());
    } else {
      this.startStandaloneMetronome();
    }
  }

  private startStandaloneMetronome(): void {
    if (!this.tone || !this.metronomeSynth || !this.metronomeEnabled) return;
    const transport = this.tone.getTransport();
    transport.stop();
    transport.loop = false;
    transport.position = 0;
    transport.bpm.value = this._tempo * this._tempoScale;
    this.activePlaybackTempo = this._tempo;
    this.scheduleMetronome(0);
    transport.start();
    this.transportStartedForMetronome = true;
  }

  private scheduleMetronome(startAtBeats: number): void {
    if (!this.tone || !this.metronomeSynth) return;
    this.clearMetronomeSchedule();
    const transport = this.tone.getTransport();
    const ppq = transport.PPQ;
    let fallbackBeat = Math.max(0, Math.round(startAtBeats));

    this.metronomeEventId = transport.scheduleRepeat(time => {
      const ticks = transport.getTicksAtTime?.(time);
      const beat = Number.isFinite(ticks) ? Math.round(ticks / ppq) : fallbackBeat++;
      const frequency = beat % 4 === 0 ? 1000 : 800;
      this.metronomeSynth?.triggerAttackRelease(frequency, '16n', time);
    }, '4n', `${Math.max(0, startAtBeats) * ppq}i`);
  }

  private getCurrentBeatOffset(): number {
    const transport = this.tone?.getTransport();
    if (!transport) return 0;
    return Math.ceil(transport.ticks / transport.PPQ);
  }

  stopMetronome(): void {
    this.metronomeEnabled = false;
    this.clearMetronomeSchedule();
    if (this.transportStartedForMetronome && this.tone) {
      const transport = this.tone.getTransport();
      transport.stop();
      transport.position = 0;
      this.transportStartedForMetronome = false;
    }
  }

  private clearMetronomeSchedule(): void {
    if (this.metronomeEventId !== null && this.tone) {
      this.tone.getTransport().clear(this.metronomeEventId);
    }
    this.metronomeEventId = null;
  }

  isMetronomeEnabled(): boolean {
    return this.metronomeEnabled;
  }

  getTransportPosition(): number {
    return this.tone?.getTransport().seconds ?? 0;
  }

  getDiagnostics(): {
    ready: boolean;
    scheduledPlaybackEvents: number;
    metronomeScheduled: boolean;
    playbackActive: boolean;
  } {
    return {
      ready: this.isReady,
      scheduledPlaybackEvents: this.scheduledEvents.length,
      metronomeScheduled: this.metronomeEventId !== null,
      playbackActive: this.playbackActive,
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.lifecycleGeneration++;
    this.destroyed = true;
    this.stop();
    this.stopMetronome();
    this.sampler?.dispose();
    this.metronomeSynth?.dispose();
    this.sampler = null;
    this.metronomeSynth = null;
    this.isReady = false;
    this.initPromise = null;
    this.tonePromise = null;
    const context = this.gestureContext;
    this.gestureContext = null;
    if (context && context.state !== 'closed') void context.close().catch(() => {});
  }
}
