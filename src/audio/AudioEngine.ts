import * as Tone from 'tone';
import type { NoteEvent, HandSelection } from '../types';
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
  private metronomeEnabled = false;
  private metronomeInterval: number | null = null;
  private initPromise: Promise<void> | null = null;

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

  private async doInit(): Promise<void> {

    await Tone.start();

    // Use Salamander Grand Piano samples
    const baseUrl = 'https://tonejs.github.io/audio/salamander/';
    this.sampler = new Tone.Sampler({
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

    // Wait for samples to load
    await Tone.loaded();

    // Metronome click synth
    this.metronomeSynth = new Tone.Synth({
      oscillator: { type: 'sine' },
      envelope: { attack: 0.001, decay: 0.1, sustain: 0, release: 0.1 },
      volume: -15,
    }).toDestination();

    this.isReady = true;
  }

  get ready(): boolean {
    return this.isReady;
  }

  setVolume(db: number): void {
    if (this.sampler) this.sampler.volume.value = db;
  }

  getVolume(): number {
    return this.sampler?.volume.value ?? 0;
  }

  playNote(midiNumber: number, duration: number = 0.5, velocity: number = 0.8): void {
    if (!this.sampler || !this.isReady) return;
    const noteName = midiToNoteName(midiNumber);
    this.sampler.triggerAttackRelease(noteName, duration, Tone.now(), velocity);
  }

  playNoteOn(midiNumber: number, velocity: number = 0.8): void {
    if (!this.sampler || !this.isReady) return;
    const noteName = midiToNoteName(midiNumber);
    this.sampler.triggerAttack(noteName, Tone.now(), velocity);
  }

  playNoteOff(midiNumber: number): void {
    if (!this.sampler || !this.isReady) return;
    const noteName = midiToNoteName(midiNumber);
    this.sampler.triggerRelease(noteName, Tone.now());
  }

  schedulePlayback(
    events: NoteEvent[],
    hand: HandSelection,
    onCursorAdvance: (index: number) => void,
    onComplete: () => void,
  ): void {
    this.clearSchedule();
    this.cursorCallback = onCursorAdvance;
    this.completionCallback = onComplete;

    const transport = Tone.getTransport();
    transport.bpm.value = this._tempo * this._tempoScale;
    transport.position = 0;

    const staffFilter = hand === 'both' ? null : (hand === 'right' ? 1 : 2);

    for (const event of events) {
      const filteredNotes = staffFilter
        ? event.notes.filter(n => n.staff === staffFilter)
        : event.notes;

      if (filteredNotes.length === 0) continue;

      const timeInSeconds = event.timestamp / this._tempoScale;

      const eventId = transport.schedule((time) => {
        for (const note of filteredNotes) {
          if (this.sampler) {
            const name = midiToNoteName(note.midi);
            const dur = note.duration / this._tempoScale;
            this.sampler.triggerAttackRelease(name, dur, time, note.velocity);
          }
        }
        // Update cursor on the main thread
        Tone.getDraw().schedule(() => {
          this.cursorCallback?.(event.index);
        }, time);
      }, timeInSeconds);

      this.scheduledEvents.push(eventId);
    }

    // Schedule completion
    if (events.length > 0) {
      const lastEvent = events[events.length - 1];
      const maxDur = lastEvent.notes.length > 0
        ? Math.max(...lastEvent.notes.map(n => n.duration))
        : 0.5;
      const endTime = (lastEvent.timestamp + maxDur) / this._tempoScale + 0.5;

      const endId = transport.schedule(() => {
        Tone.getDraw().schedule(() => {
          this.completionCallback?.();
        }, Tone.now());
      }, endTime);
      this.scheduledEvents.push(endId);
    }
  }

  async countIn(beats: number = 4, onBeat?: (beat: number) => void): Promise<void> {
    if (!this.metronomeSynth || !this.isReady) return;
    const interval = 60 / (this._tempo * this._tempoScale);

    for (let i = 0; i < beats; i++) {
      const freq = i === 0 ? 1200 : 900;
      this.metronomeSynth.triggerAttackRelease(freq, '16n');
      onBeat?.(i + 1);
      if (i < beats - 1) {
        await new Promise(resolve => setTimeout(resolve, interval * 1000));
      }
    }
    // Small pause after last beat before starting
    await new Promise(resolve => setTimeout(resolve, interval * 1000));
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
    Tone.getTransport().stop();
    this.clearSchedule();
  }

  private clearSchedule(): void {
    const transport = Tone.getTransport();
    for (const id of this.scheduledEvents) {
      transport.clear(id);
    }
    this.scheduledEvents = [];
    transport.cancel();
  }

  setTempo(bpm: number): void {
    this._tempo = bpm;
    Tone.getTransport().bpm.value = bpm * this._tempoScale;
    if (this.metronomeEnabled) this.startMetronome();
  }

  getTempo(): number {
    return this._tempo;
  }

  setTempoScale(scale: number): void {
    this._tempoScale = Math.max(0.25, Math.min(2.0, scale));
    Tone.getTransport().bpm.value = this._tempo * this._tempoScale;
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
    this.stop();
    this.stopMetronome();
    this.sampler?.dispose();
    this.metronomeSynth?.dispose();
    this.sampler = null;
    this.metronomeSynth = null;
    this.isReady = false;
  }
}
