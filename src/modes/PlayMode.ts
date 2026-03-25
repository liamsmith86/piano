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
  private currentIndex = 0;
  private timeline: NoteEvent[] = [];
  private hand: HandSelection = 'both';

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

    // Start fresh
    this.renderer.cursorReset();
    this.renderer.cursorShow();
    this.currentIndex = 0;

    this.timeline = this.analyzer.getTimeline();

    this.audio.schedulePlayback(
      this.timeline,
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
    this.state = 'stopped';
    this.events.emit('playbackStateChanged', { state: 'stopped' });
  }

  private onCursorAdvance(index: number): void {
    const prevIndex = this.currentIndex;
    // Mark previous notes as played (green)
    this.renderer.markNotesPlayed();
    // Advance cursor to match timeline index
    while (this.currentIndex < index) {
      this.renderer.cursorNext();
      this.currentIndex++;
    }
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

  getState(): PlaybackState {
    return this.state;
  }

  getCurrentIndex(): number {
    return this.currentIndex;
  }

  getProgress(): number {
    if (this.timeline.length === 0) return 0;
    return this.currentIndex / this.timeline.length;
  }

  seekToMeasure(measure: number): void {
    const wasPlaying = this.state === 'playing';
    if (wasPlaying) this.stop();

    this.renderer.setCursorToMeasure(measure);
    // Find the timeline index for this measure
    const idx = this.timeline.findIndex(e => e.measureNumber >= measure);
    this.currentIndex = idx >= 0 ? idx : 0;

    if (wasPlaying) {
      this.start();
    }
  }
}
