import type { AudioEngine } from '../audio/AudioEngine';
import type { ScoreRenderer } from '../score/ScoreRenderer';
import type { ScoreAnalyzer } from '../score/ScoreAnalyzer';
import type { NoteEvent, HandSelection, PlaybackState, TempoChange } from '../types';
import type { EventEmitter } from '../events';

export class PlayMode {
  private audio: AudioEngine;
  private renderer: ScoreRenderer;
  private analyzer: ScoreAnalyzer;
  private events: EventEmitter;
  private state: PlaybackState = 'stopped';
  private currentIndex = 0;       // OSMD cursor step (for cursor sync)
  private timelinePosition = 0;   // position in timeline array (for progress)
  private timeline: NoteEvent[] = [];
  private hand: HandSelection = 'both';
  private loopStart: number | null = null;
  private loopEnd: number | null = null;
  private lastMeasure = 0;        // for detecting repeats
  private eventByIndex = new Map<number, NoteEvent>(); // O(1) lookup by cursor step
  private playbackGeneration = 0;
  private pendingStartMeasure: number | null = null;

  constructor(
    audio: AudioEngine,
    renderer: ScoreRenderer,
    analyzer: ScoreAnalyzer,
    events: EventEmitter,
  ) {
    this.audio = audio;
    this.renderer = renderer;
    this.analyzer = analyzer;
    this.events = events;
  }

  async start(): Promise<void> {
    if (this.state === 'playing') return;

    if (this.state === 'paused') {
      this.audio.resume();
      this.state = 'playing';
      this.events.emit('playbackStateChanged', { state: 'playing' });
      return;
    }

    const generation = ++this.playbackGeneration;
    if (!this.audio.ready) {
      await this.audio.init();
      if (generation !== this.playbackGeneration) return;
    }

    // Clear any visual state from previous playthrough
    this.renderer.clearNoteHighlights();

    // Start fresh — filter timeline by loop range if set
    let fullTimeline = this.analyzer.filterByHand(this.hand);
    if (this.loopStart !== null && this.loopEnd !== null) {
      fullTimeline = fullTimeline.filter(
        e => e.measureNumber >= this.loopStart! && e.measureNumber <= this.loopEnd!
      );
    }
    this.timeline = fullTimeline;
    this.buildEventIndex();

    if (this.timeline.length === 0) {
      this.renderer.cursorHide();
      return;
    }

    const requestedMeasure = this.pendingStartMeasure;
    this.pendingStartMeasure = null;
    const requestedPosition = requestedMeasure === null
      ? 0
      : this.timeline.findIndex(event => event.measureNumber >= requestedMeasure);
    const startPosition = requestedPosition >= 0 ? requestedPosition : this.timeline.length - 1;
    const playbackTimeline = this.timeline.slice(startPosition);

    // Position cursor at the requested start of the range.
    this.renderer.setCursorToMeasure(playbackTimeline[0].measureNumber);
    this.renderer.cursorShow();
    this.currentIndex = playbackTimeline[0].index;
    this.timelinePosition = startPosition;
    this.lastMeasure = 0;

    this.scheduleSegment(playbackTimeline, generation);

    this.audio.play();
    this.state = 'playing';
    this.events.emit('playbackStateChanged', { state: 'playing' });
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.audio.pause();
    this.state = 'paused';
    this.events.emit('playbackStateChanged', { state: 'paused' });
  }

  stop(): void {
    this.playbackGeneration++;
    this.audio.stop();
    this.renderer.clearNoteHighlights();
    this.renderer.cursorReset();
    this.currentIndex = 0;
    this.timelinePosition = 0;
    this.pendingStartMeasure = null;
    const stateChanged = this.state !== 'stopped';
    this.state = 'stopped';
    if (stateChanged) {
      this.events.emit('playbackStateChanged', { state: 'stopped' });
    }
  }

  private onCursorAdvance(eventIndex: number, generation: number): void {
    if (generation !== this.playbackGeneration || this.state !== 'playing') return;
    const prevIndex = this.currentIndex;

    // Detect repeat: if current event's measure is before the last played measure,
    // reset green notes so repeat section gets fresh visual feedback
    const event = this.eventByIndex.get(eventIndex);
    if (event && event.measureNumber < this.lastMeasure) {
      this.renderer.resetPlayedNotes();
    }
    if (event) this.lastMeasure = event.measureNumber;

    // Mark previous notes as played (green)
    this.renderer.markNotesPlayed();
    // Advance OSMD cursor to match the event's cursor step position,
    // marking intermediate positions green (notes from other voices/hands)
    while (this.currentIndex < eventIndex) {
      this.renderer.cursorNext();
      this.renderer.markNotesPlayed();
      this.currentIndex++;
    }
    // Track timeline array position for progress calculation
    this.timelinePosition++;
    // Highlight current notes (blue) and scroll to keep visible
    this.renderer.highlightCurrentNotes('#3b82f6');
    this.renderer.scrollToCursor();
    this.events.emit('cursorAdvanced', { from: prevIndex, to: this.currentIndex });
  }

  private onComplete(generation: number): void {
    if (generation !== this.playbackGeneration) return;
    this.audio.stop();
    this.state = 'stopped';
    this.events.emit('playbackStateChanged', { state: 'stopped' });
    this.events.emit('songEnd', {
      stats: {
        cursorIndex: this.timeline.length,
        expectedNotes: [],
        hitNotes: [],
        wrongNotes: [],
        totalNotes: this.timeline.length,
        correctCount: 0,
        wrongCount: 0,
        startTime: null,
        streak: 0,
        bestStreak: 0,
        measureStats: [],
      },
    });
  }

  setHand(hand: HandSelection): void {
    if (hand === this.hand) return;
    this.hand = hand;
    if (this.state !== 'stopped') {
      this.stop();
    }
  }

  setLoop(startMeasure: number, endMeasure: number): void {
    const normalizeMeasure = (measure: number): number => (
      Number.isFinite(measure) ? Math.max(1, Math.trunc(measure)) : 1
    );
    const start = normalizeMeasure(startMeasure);
    const end = normalizeMeasure(endMeasure);
    this.loopStart = Math.min(start, end);
    this.loopEnd = Math.max(start, end);
    if (this.state !== 'stopped') this.stop();
  }

  clearLoop(): void {
    this.loopStart = null;
    this.loopEnd = null;
    if (this.state !== 'stopped') this.stop();
  }

  getState(): PlaybackState {
    return this.state;
  }

  getCurrentIndex(): number {
    return this.timelinePosition;
  }

  getProgress(): number {
    if (this.timeline.length === 0) return 0;
    return Math.min(1, this.timelinePosition / this.timeline.length);
  }

  seekToMeasure(measure: number): void {
    const normalizedMeasure = Number.isFinite(measure) ? Math.max(1, Math.trunc(measure)) : 1;
    const wasPlaying = this.state === 'playing';
    const generation = ++this.playbackGeneration;

    // Stop current audio scheduling
    this.audio.stop();
    this.renderer.clearNoteHighlights();

    // Rebuild timeline (respecting loop range)
    let fullTimeline = this.analyzer.filterByHand(this.hand);
    if (this.loopStart !== null && this.loopEnd !== null) {
      fullTimeline = fullTimeline.filter(
        e => e.measureNumber >= this.loopStart! && e.measureNumber <= this.loopEnd!
      );
    }
    this.timeline = fullTimeline;
    this.buildEventIndex();

    // Find position in timeline for this measure
    const seekIdx = this.timeline.findIndex(e => e.measureNumber >= normalizedMeasure);
    const startFrom = seekIdx >= 0 ? seekIdx : Math.max(0, this.timeline.length - 1);

    // Position cursor
    if (this.timeline.length > 0 && startFrom < this.timeline.length) {
      this.renderer.setCursorToMeasure(this.timeline[startFrom].measureNumber);
      this.currentIndex = this.timeline[startFrom].index;
    } else {
      this.renderer.cursorReset();
      this.currentIndex = 0;
    }
    this.renderer.cursorShow();
    this.timelinePosition = startFrom;
    this.lastMeasure = 0;

    if (wasPlaying && this.timeline.length > 0 && startFrom < this.timeline.length) {
      const seekTimeline = this.timeline.slice(startFrom);
      this.scheduleSegment(seekTimeline, generation);
      this.audio.play();
      this.state = 'playing';
      this.events.emit('playbackStateChanged', { state: 'playing' });

      // Highlight current notes
      this.renderer.highlightCurrentNotes('#3b82f6');
    } else {
      this.pendingStartMeasure = this.timeline[startFrom]?.measureNumber ?? normalizedMeasure;
      this.state = 'stopped';
      this.events.emit('playbackStateChanged', { state: 'stopped' });
    }
  }

  private buildEventIndex(): void {
    this.eventByIndex.clear();
    for (const event of this.timeline) {
      this.eventByIndex.set(event.index, event);
    }
  }

  private scheduleSegment(events: NoteEvent[], generation: number): void {
    const startSeconds = events[0].timestamp;
    const startBeats = events[0].timestampBeats;
    const endBeats = events[events.length - 1].timestampBeats;
    const offsetTimeline = events.map(event => ({
      ...event,
      timestamp: event.timestamp - startSeconds,
      timestampBeats: event.timestampBeats - startBeats,
    }));

    this.audio.schedulePlayback(
      offsetTimeline,
      this.hand,
      index => this.onCursorAdvance(index, generation),
      () => this.onComplete(generation),
      this.getTempoMapForSegment(startBeats, endBeats),
    );
  }

  private getTempoMapForSegment(startBeat: number, endBeat: number): TempoChange[] {
    const sourceMap = this.analyzer.getTempoMap();
    let activeBpm = this.analyzer.getDefaultTempo();
    for (const change of sourceMap) {
      if (change.timestampBeats > startBeat) break;
      activeBpm = change.bpm;
    }

    return [
      { timestampBeats: 0, bpm: activeBpm },
      ...sourceMap
        .filter(change => change.timestampBeats > startBeat && change.timestampBeats <= endBeat)
        .map(change => ({
          timestampBeats: change.timestampBeats - startBeat,
          bpm: change.bpm,
        })),
    ];
  }
}
