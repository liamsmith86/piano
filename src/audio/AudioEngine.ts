import * as Tone from 'tone';
import type { NoteEvent, HandSelection, TempoChange } from '../types';
import { midiToNoteName } from '../types';

export class AudioEngine {
  private sampler: Tone.Sampler | null = null;
  private metronomeSynth: Tone.Synth | null = null;
  private isReady = false;
  private scheduledEvents: number[] = [];
  private cursorCallback: ((index: number) => void) | null = null;
  private completionCallback: (() => void) | null = null;
  private _tempo: number = 120;
  private _tempoScale: number = 1.0;
  private volumeDb = -20;
  private activePlaybackTempo = 120;
  private metronomeEnabled = false;
  private metronomeInterval: number | null = null;
  private initPromise: Promise<void> | null = null;
  private lifecycleGeneration = 0;
  private countInGeneration = 0;
  private countInDelay: {
    timerId: ReturnType<typeof setTimeout>;
    resolve: (completed: boolean) => void;
  } | null = null;

  async init(): Promise<void> {
    if (this.isReady) return;
    if (this.initPromise) return this.initPromise;
    this.initPromise = this.doInit().catch((err) => {
      // Reset so next call can retry
      this.initPromise = null;
      throw err;
    });
    return this.initPromise;
  }

  /**
   * Resume the AudioContext — must be called from a user gesture handler on iOS Safari.
   * Safe to call multiple times; returns immediately if already running.
   */
  async unlockAudio(): Promise<void> {
    await Tone.start();
    // Also explicitly resume context for iOS Safari edge cases
    if (Tone.getContext().state !== 'running') {
      await Tone.getContext().resume();
    }
  }

  private async doInit(): Promise<void> {
    const generation = this.lifecycleGeneration;
    await this.unlockAudio();

    // Use Salamander Grand Piano samples
    const baseUrl = 'https://tonejs.github.io/audio/salamander/';
    const sampler = new Tone.Sampler({
      urls: {
        A0: 'A0.mp3', C1: 'C1.mp3', 'D#1': 'Ds1.mp3', 'F#1': 'Fs1.mp3',
        A1: 'A1.mp3', C2: 'C2.mp3', 'D#2': 'Ds2.mp3', 'F#2': 'Fs2.mp3',
        A2: 'A2.mp3', C3: 'C3.mp3', 'D#3': 'Ds3.mp3', 'F#3': 'Fs3.mp3',
        A3: 'A3.mp3', C4: 'C4.mp3', 'D#4': 'Ds4.mp3', 'F#4': 'Fs4.mp3',
        A4: 'A4.mp3', C5: 'C5.mp3', 'D#5': 'Ds5.mp3', 'F#5': 'Fs5.mp3',
        A5: 'A5.mp3', C6: 'C6.mp3', 'D#6': 'Ds6.mp3', 'F#6': 'Fs6.mp3',
        A6: 'A6.mp3', C7: 'C7.mp3', 'D#7': 'Ds7.mp3', 'F#7': 'Fs7.mp3',
        A7: 'A7.mp3', C8: 'C8.mp3',
      },
      baseUrl,
      release: 1,
    }).toDestination();

    try {
      // Wait for samples to load
      await Tone.loaded();
    } catch (error) {
      sampler.dispose();
      throw error;
    }

    if (generation !== this.lifecycleGeneration) {
      sampler.dispose();
      return;
    }

    // Metronome click synth
    const metronomeSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
      volume: -15,
    }).toDestination();

    sampler.volume.value = this.volumeDb;

    this.sampler = sampler;
    this.metronomeSynth = metronomeSynth;
    this.isReady = true;
  }

  get ready(): boolean {
    return this.isReady;
  }

  setVolume(db: number): void {
    this.volumeDb = db;
    if (this.sampler) this.sampler.volume.value = db;
  }

  getVolume(): number {
    return this.sampler?.volume.value ?? this.volumeDb;
  }

  playNote(midiNumber: number, duration: number = 0.5, velocity: number = 0.8): void {
    if (!this.sampler || !this.isReady) return;
    const noteName = midiToNoteName(midiNumber);
    this.sampler.triggerAttackRelease(noteName, duration, Tone.now(), velocity);
  }

  noteOn(midiNumber: number, velocity: number = 0.8): void {
    if (!this.sampler || !this.isReady) return;
    const normalizedVelocity = Number.isFinite(velocity)
      ? Math.max(0, Math.min(1, velocity))
      : 0.8;
    this.sampler.triggerAttack(midiToNoteName(midiNumber), Tone.now(), normalizedVelocity);
  }

  noteOff(midiNumber: number): void {
    if (!this.sampler || !this.isReady) return;
    this.sampler.triggerRelease(midiToNoteName(midiNumber), Tone.now());
  }

  schedulePlayback(
    events: NoteEvent[],
    hand: HandSelection,
    onCursorAdvance: (index: number) => void,
    onComplete: () => void,
    tempoMap: TempoChange[] = [],
  ): void {
    this.clearSchedule();
    this.cursorCallback = onCursorAdvance;
    this.completionCallback = onComplete;

    const transport = Tone.getTransport();
    this.activePlaybackTempo = tempoMap[0]?.bpm ?? this._tempo;
    transport.bpm.value = this.activePlaybackTempo * this._tempoScale;
    transport.position = 0;

    const staffFilter = hand === 'both' ? null : (hand === 'right' ? 1 : 2);
    const ppq = transport.PPQ;

    // Schedule tempo changes in musical time. The callback reads the current
    // scale so moving the tempo control during playback takes effect without
    // rebuilding every note event.
    for (const change of tempoMap.slice(1)) {
      const tempoId = transport.schedule((time) => {
        this.activePlaybackTempo = change.bpm;
        transport.bpm.setValueAtTime(change.bpm * this._tempoScale, time);
      }, `${change.timestampBeats * ppq}i`);
      this.scheduledEvents.push(tempoId);
    }

    for (const event of events) {
      const filteredNotes = staffFilter
        ? event.notes.filter(n => n.staff === staffFilter)
        : event.notes;

      if (filteredNotes.length === 0) continue;

      const eventId = transport.schedule((time) => {
        for (const note of filteredNotes) {
          if (this.sampler) {
            const name = midiToNoteName(note.midi);
            const dur = `${Math.max(1, note.durationBeats * ppq)}i`;
            this.sampler.triggerAttackRelease(name, dur, time, note.velocity);
          }
        }
        // Update cursor on the main thread
        Tone.getDraw().schedule(() => {
          this.cursorCallback?.(event.index);
        }, time);
      }, `${event.timestampBeats * ppq}i`);

      this.scheduledEvents.push(eventId);
    }

    // Schedule completion
    if (events.length > 0) {
      const lastEvent = events[events.length - 1];
      const maxDurationBeats = lastEvent.notes.length > 0
        ? Math.max(...lastEvent.notes.map(note => note.durationBeats))
        : 1;
      const endTicks = (lastEvent.timestampBeats + maxDurationBeats + 0.25) * ppq;

      const endId = transport.schedule(() => {
        Tone.getDraw().schedule(() => {
          this.completionCallback?.();
        }, Tone.now());
      }, `${endTicks}i`);
      this.scheduledEvents.push(endId);
    }
  }

  async countIn(beats: number = 4, onBeat?: (beat: number) => void): Promise<boolean> {
    if (!this.metronomeSynth || !this.isReady) return true;
    this.cancelCountIn();
    const generation = this.countInGeneration;
    const interval = 60 / (this._tempo * this._tempoScale);

    for (let i = 0; i < beats; i++) {
      if (generation !== this.countInGeneration) return false;
      const freq = i === 0 ? 1200 : 900;
      this.metronomeSynth.triggerAttackRelease(freq, '16n');
      onBeat?.(i + 1);
      if (!await this.waitForCountInBeat(interval * 1000, generation)) return false;
    }
    return generation === this.countInGeneration;
  }

  play(): void {
    Tone.getTransport().start();
  }

  pause(): void {
    Tone.getTransport().pause();
  }

  resume(): void {
    Tone.getTransport().start();
  }

  stop(): void {
    this.cancelCountIn();
    Tone.getTransport().stop();
    this.sampler?.releaseAll();
    this.clearSchedule();
  }

  cancelCountIn(): void {
    this.countInGeneration++;
    if (this.countInDelay) {
      clearTimeout(this.countInDelay.timerId);
      const { resolve } = this.countInDelay;
      this.countInDelay = null;
      resolve(false);
    }
  }

  private waitForCountInBeat(milliseconds: number, generation: number): Promise<boolean> {
    return new Promise(resolve => {
      const timerId = setTimeout(() => {
        if (this.countInDelay?.timerId === timerId) {
          this.countInDelay = null;
        }
        resolve(generation === this.countInGeneration);
      }, milliseconds);
      this.countInDelay = { timerId, resolve };
    });
  }

  private clearSchedule(): void {
    const transport = Tone.getTransport();
    for (const id of this.scheduledEvents) {
      transport.clear(id);
    }
    this.scheduledEvents = [];
    transport.cancel();
    Tone.getDraw().cancel();
    this.cursorCallback = null;
    this.completionCallback = null;
  }

  setTempo(bpm: number): void {
    if (!Number.isFinite(bpm)) return;
    this._tempo = Math.max(1, bpm);
    this.activePlaybackTempo = this._tempo;
    Tone.getTransport().bpm.value = this._tempo * this._tempoScale;
    if (this.metronomeEnabled) this.startMetronome();
  }

  getTempo(): number {
    return this._tempo;
  }

  setTempoScale(scale: number): void {
    if (!Number.isFinite(scale)) return;
    this._tempoScale = Math.max(0.25, Math.min(2.0, scale));
    Tone.getTransport().bpm.value = this.activePlaybackTempo * this._tempoScale;
    if (this.metronomeEnabled) this.startMetronome();
  }

  getTempoScale(): number {
    return this._tempoScale;
  }

  startMetronome(bpm?: number): void {
    this.stopMetronome();
    this.metronomeEnabled = true;
    const tempo = bpm ?? (this._tempo * this._tempoScale);
    const interval = 60 / tempo;

    let beat = 0;
    const tick = () => {
      if (!this.metronomeEnabled) return;
      const freq = beat % 4 === 0 ? 1000 : 800;
      this.metronomeSynth?.triggerAttackRelease(freq, '16n');
      beat++;
    };

    tick();
    this.metronomeInterval = window.setInterval(tick, interval * 1000);
  }

  stopMetronome(): void {
    this.metronomeEnabled = false;
    if (this.metronomeInterval !== null) {
      clearInterval(this.metronomeInterval);
      this.metronomeInterval = null;
    }
  }

  isMetronomeEnabled(): boolean {
    return this.metronomeEnabled;
  }

  getTransportPosition(): number {
    return Tone.getTransport().seconds;
  }

  destroy(): void {
    this.lifecycleGeneration++;
    this.stop();
    this.stopMetronome();
    this.sampler?.dispose();
    this.metronomeSynth?.dispose();
    this.sampler = null;
    this.metronomeSynth = null;
    this.isReady = false;
    this.initPromise = null;
  }
}
