import type { AudioEngine } from '../audio/AudioEngine';
import type { ScoreRenderer } from '../score/ScoreRenderer';
import type { ScoreAnalyzer } from '../score/ScoreAnalyzer';
import type { NoteEvent, HandSelection, PlaybackState } from '../types';
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

    if (!this.audio.ready) {
      await this.audio.init();
    }

    if (this.state === 'paused') {
      this.audio.resume();
      this.state = 'playing';
      this.events.emit('playbackStateChanged', { state: 'playing' });
      return;
    }

    // Clear any visual state from previous playthrough
    this.renderer.clearNoteHighlights();

    // Start fresh — filter timeline by loop range if set
    let fullTimeline = this.analyzer.getTimeline();
    if (this.loopStart !== null && this.loopEnd !== null) {
      fullTimeline = fullTimeline.filter(
        e => e.measureNumber >= this.loopStart! && e.measureNumber <= this.loopEnd!
      );
    }
    this.timeline = fullTimeline;

    // Position cursor at the start of the range
    if (this.timeline.length > 0) {
      this.renderer.setCursorToMeasure(this.timeline[0].measureNumber);
    } else {
      this.renderer.cursorReset();
    }
    this.renderer.cursorShow();
    this.currentIndex = this.timeline.length > 0 ? this.timeline[0].index : 0;
    this.timelinePosition = 0;
    this.lastMeasure = 0;

    // Offset timestamps so playback starts at time 0
    const startOffset = this.timeline.length > 0 ? this.timeline[0].timestamp : 0;
    const offsetTimeline = this.timeline.map(e => ({
      ...e,
      timestamp: e.timestamp - startOffset,
    }));

    this.audio.schedulePlayback(
      offsetTimeline,
      this.hand,
      (index) => this.onCursorAdvance(index),
      () => this.onComplete(),
    );

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
    this.audio.stop();
    this.renderer.clearNoteHighlights();
    this.renderer.cursorReset();
    this.currentIndex = 0;
    this.timelinePosition = 0;
    this.state = 'stopped';
    this.events.emit('playbackStateChanged', { state: 'stopped' });
  }

  private onCursorAdvance(eventIndex: number): void {
    const prevIndex = this.currentIndex;

    // Detect repeat: if current event's measure is before the last played measure,
    // reset green notes so repeat section gets fresh visual feedback
    const event = this.timeline.find(e => e.index === eventIndex);
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

  private onComplete(): void {
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
    this.hand = hand;
    if (this.state === 'playing') {
      this.stop();
    }
  }

  setLoop(startMeasure: number, endMeasure: number): void {
    this.loopStart = startMeasure;
    this.loopEnd = endMeasure;
  }

  clearLoop(): void {
    this.loopStart = null;
    this.loopEnd = null;
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

  async seekToMeasure(measure: number): Promise<void> {
    const wasPlaying = this.state === 'playing';

    // Stop current audio scheduling
    this.audio.stop();
    this.renderer.clearNoteHighlights();

    // Rebuild timeline (respecting loop range)
    let fullTimeline = this.analyzer.getTimeline();
    if (this.loopStart !== null && this.loopEnd !== null) {
      fullTimeline = fullTimeline.filter(
        e => e.measureNumber >= this.loopStart! && e.measureNumber <= this.loopEnd!
      );
    }
    this.timeline = fullTimeline;

    // Find position in timeline for this measure
    const seekIdx = this.timeline.findIndex(e => e.measureNumber >= measure);
    const startFrom = seekIdx >= 0 ? seekIdx : 0;

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
      // Schedule playback from the seek position
      const seekTimeline = this.timeline.slice(startFrom);
      const startOffset = seekTimeline[0].timestamp;
      const offsetTimeline = seekTimeline.map(e => ({
        ...e,
        timestamp: e.timestamp - startOffset,
      }));

      this.audio.schedulePlayback(
        offsetTimeline,
        this.hand,
        (index) => this.onCursorAdvance(index),
        () => this.onComplete(),
      );
      this.audio.play();
      this.state = 'playing';
      this.events.emit('playbackStateChanged', { state: 'playing' });

      // Highlight current notes
      this.renderer.highlightCurrentNotes('#3b82f6');
    } else {
      this.state = 'stopped';
      this.events.emit('playbackStateChanged', { state: 'stopped' });
    }
  }
}
