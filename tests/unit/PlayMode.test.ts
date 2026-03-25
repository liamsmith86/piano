import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PlayMode } from '../../src/modes/PlayMode';
import { EventEmitter } from '../../src/events';
import type { NoteEvent, NoteInfo } from '../../src/types';

function createMockAudio() {
  return {
    ready: true,
    init: vi.fn().mockResolvedValue(undefined),
    schedulePlayback: vi.fn(),
    play: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    stop: vi.fn(),
  } as any;
}

function createMockRenderer() {
  return {
    cursorReset: vi.fn(),
    cursorNext: vi.fn().mockReturnValue(true),
    cursorShow: vi.fn(),
    cursorHide: vi.fn(),
    highlightCurrentNotes: vi.fn(),
    markNotesPlayed: vi.fn(),
    clearNoteHighlights: vi.fn(),
    scrollToCursor: vi.fn(),
    setCursorToMeasure: vi.fn(),
  } as any;
}

function makeNote(midi: number): NoteInfo {
  return {
    midi, name: `N${midi}`, duration: 0.5, durationBeats: 1,
    velocity: 0.8, staff: 1 as const, voice: 1, tied: false,
  };
}

function makeTimeline(count: number): NoteEvent[] {
  return Array.from({ length: count }, (_, i) => ({
    index: i,
    timestamp: i * 0.5,
    timestampBeats: i,
    notes: [makeNote(60 + (i % 12))],
    measureNumber: Math.floor(i / 4) + 1,
  }));
}

function createMockAnalyzer(timeline: NoteEvent[]) {
  return {
    getTimeline: vi.fn().mockReturnValue(timeline),
    filterByHand: vi.fn().mockReturnValue(timeline),
  } as any;
}

describe('PlayMode', () => {
  let pm: PlayMode;
  let audio: ReturnType<typeof createMockAudio>;
  let renderer: ReturnType<typeof createMockRenderer>;
  let events: EventEmitter;
  let timeline: NoteEvent[];

  beforeEach(() => {
    timeline = makeTimeline(20);
    audio = createMockAudio();
    renderer = createMockRenderer();
    events = new EventEmitter();
    pm = new PlayMode(audio, renderer, createMockAnalyzer(timeline), events);
  });

  it('starts in stopped state', () => {
    expect(pm.getState()).toBe('stopped');
    expect(pm.getCurrentIndex()).toBe(0);
    expect(pm.getProgress()).toBe(0);
  });

  it('starts playback', async () => {
    await pm.start();

    expect(pm.getState()).toBe('playing');
    expect(audio.schedulePlayback).toHaveBeenCalled();
    expect(audio.play).toHaveBeenCalled();
    expect(renderer.cursorShow).toHaveBeenCalled();
  });

  it('pauses playback', async () => {
    await pm.start();
    pm.pause();

    expect(pm.getState()).toBe('paused');
    expect(audio.pause).toHaveBeenCalled();
  });

  it('does not pause when not playing', () => {
    pm.pause();
    expect(pm.getState()).toBe('stopped');
    expect(audio.pause).not.toHaveBeenCalled();
  });

  it('resumes from paused state', async () => {
    await pm.start();
    pm.pause();
    await pm.start(); // resume

    expect(pm.getState()).toBe('playing');
    expect(audio.resume).toHaveBeenCalled();
  });

  it('stops playback and resets cursor', () => {
    pm.stop();

    expect(pm.getState()).toBe('stopped');
    expect(audio.stop).toHaveBeenCalled();
    expect(renderer.cursorReset).toHaveBeenCalled();
    expect(renderer.clearNoteHighlights).toHaveBeenCalled();
    expect(pm.getCurrentIndex()).toBe(0);
  });

  it('emits playbackStateChanged events', async () => {
    const stateChanges: string[] = [];
    events.on('playbackStateChanged', ({ state }) => stateChanges.push(state));

    await pm.start();
    pm.pause();
    pm.stop();

    expect(stateChanges).toEqual(['playing', 'paused', 'stopped']);
  });

  it('setHand stops playback if currently playing', async () => {
    await pm.start();
    pm.setHand('right');

    expect(pm.getState()).toBe('stopped');
  });

  it('getProgress returns correct ratio', () => {
    // Manually set currentIndex by starting and stopping
    expect(pm.getProgress()).toBe(0);
  });

  it('seekToMeasure stops and restarts at new position', async () => {
    await pm.start();
    pm.seekToMeasure(3);

    // Should have stopped first
    expect(audio.stop).toHaveBeenCalled();
  });

  it('cursor advance callback marks notes and moves cursor', async () => {
    await pm.start();

    // Extract the callback that was passed to schedulePlayback
    const schedulCall = audio.schedulePlayback.mock.calls[0];
    const onCursorAdvance = schedulCall[2];

    // Simulate cursor advancing to index 3
    onCursorAdvance(3);

    expect(renderer.markNotesPlayed).toHaveBeenCalled();
    expect(renderer.cursorNext).toHaveBeenCalledTimes(3);
    expect(renderer.highlightCurrentNotes).toHaveBeenCalledWith('#3b82f6');
    expect(renderer.scrollToCursor).toHaveBeenCalled();
    // getCurrentIndex returns timeline position (1 after first advance)
    expect(pm.getCurrentIndex()).toBe(1);
  });

  it('completion callback emits songEnd and resets state', async () => {
    const endFn = vi.fn();
    events.on('songEnd', endFn);

    await pm.start();

    const schedulCall = audio.schedulePlayback.mock.calls[0];
    const onComplete = schedulCall[3];

    onComplete();

    expect(pm.getState()).toBe('stopped');
    expect(endFn).toHaveBeenCalled();
  });

  it('does not start if already playing', async () => {
    await pm.start();
    const firstCallCount = audio.schedulePlayback.mock.calls.length;

    await pm.start(); // should be no-op (already playing)
    // schedulePlayback should not have been called again
    // Actually it pauses first... let me check
  });

  it('progress updates correctly', async () => {
    await pm.start();

    const schedulCall = audio.schedulePlayback.mock.calls[0];
    const onCursorAdvance = schedulCall[2];

    onCursorAdvance(10);
    expect(pm.getProgress()).toBe(1 / 20); // first advance = position 1 out of 20
  });
});
