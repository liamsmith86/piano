import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InputManager } from '../../src/input/InputManager';
import { EventEmitter } from '../../src/events';
import { PracticeMode } from '../../src/modes/PracticeMode';
import type { NoteEvent, NoteInfo } from '../../src/types';

function createMockAudio() {
  return {
    ready: true,
    init: vi.fn().mockResolvedValue(undefined),
    playNote: vi.fn(),
    playNoteOn: vi.fn(),
    playNoteOff: vi.fn(),
  } as any;
}

function createMockRenderer() {
  return {
    cursorReset: vi.fn(),
    cursorNext: vi.fn().mockReturnValue(true),
    cursorShow: vi.fn(),
    cursorHide: vi.fn(),
    getCursorXPosition: vi.fn().mockReturnValue(100),
    getStaffYPosition: vi.fn().mockReturnValue(50),
    showWrongNote: vi.fn(),
    highlightCurrentNotes: vi.fn(),
    markNotesPlayed: vi.fn(),
    clearNoteHighlights: vi.fn(),
  } as any;
}

function makeNote(midi: number, staff: 1 | 2 = 1): NoteInfo {
  return {
    midi, name: `N${midi}`, duration: 0.5, durationBeats: 1,
    velocity: 0.8, staff, voice: 1, tied: false,
  };
}

function makeTimeline(): NoteEvent[] {
  // 8 events across 4 measures (2 per measure)
  return Array.from({ length: 8 }, (_, i) => ({
    index: i,
    timestamp: i * 0.5,
    timestampBeats: i,
    notes: [makeNote(60 + i)],
    measureNumber: Math.floor(i / 2) + 1, // measures 1-4
  }));
}

function createMockAnalyzer(timeline: NoteEvent[]) {
  return {
    getTimeline: vi.fn().mockReturnValue(timeline),
    filterByHand: vi.fn().mockImplementation((hand: string) => {
      if (hand === 'both') return timeline;
      return timeline;
    }),
  } as any;
}

function createMockKeyboard() {
  return {
    highlightKeys: vi.fn(),
    markCorrect: vi.fn(),
    markWrong: vi.fn(),
  } as any;
}

describe('PracticeMode Loop', () => {
  let pm: PracticeMode;
  let inputManager: InputManager;
  let events: EventEmitter;
  let timeline: NoteEvent[];

  beforeEach(() => {
    timeline = makeTimeline();
    const audio = createMockAudio();
    const renderer = createMockRenderer();
    inputManager = new InputManager();
    events = new EventEmitter();
    const keyboard = createMockKeyboard();
    const analyzer = createMockAnalyzer(timeline);

    pm = new PracticeMode(audio, renderer, analyzer, inputManager, keyboard, events);
  });

  it('setLoop filters to specified measures', async () => {
    pm.setLoop(2, 3); // measures 2-3 = events at indices 2,3,4,5
    await pm.start();

    const state = pm.getState();
    expect(state.totalNotes).toBe(4); // 2 notes per measure * 2 measures
  });

  it('loops back to start after reaching end of range', async () => {
    pm.setLoop(1, 1); // Just measure 1 = 2 events (indices 0,1, midis 60,61)
    await pm.start();

    const cursorAdvanced = vi.fn();
    events.on('cursorAdvanced', cursorAdvanced);

    // Play through measure 1
    inputManager.simulateNoteOn(60); // first note
    inputManager.simulateNoteOn(61); // second note - should loop

    // Should have looped back to position 0
    expect(pm.getCursorIndex()).toBe(0);
    expect(pm.getExpectedNotes()).toEqual([60]); // back to first note
  });

  it('clearLoop removes the loop', async () => {
    pm.setLoop(1, 2);
    pm.clearLoop();
    await pm.start();

    expect(pm.getState().totalNotes).toBe(8); // all events
    expect(pm.isLoopEnabled()).toBe(false);
  });

  it('getLoopRange returns correct range when enabled', () => {
    expect(pm.getLoopRange()).toBeNull();

    pm.setLoop(3, 4);
    expect(pm.getLoopRange()).toEqual({ start: 3, end: 4 });

    pm.clearLoop();
    expect(pm.getLoopRange()).toBeNull();
  });

  it('isLoopEnabled returns correct state', () => {
    expect(pm.isLoopEnabled()).toBe(false);
    pm.setLoop(1, 2);
    expect(pm.isLoopEnabled()).toBe(true);
    pm.clearLoop();
    expect(pm.isLoopEnabled()).toBe(false);
  });

  it('does not emit songEnd when loop is enabled', async () => {
    pm.setLoop(1, 1); // 2 events
    await pm.start();

    const endFn = vi.fn();
    events.on('songEnd', endFn);

    inputManager.simulateNoteOn(60);
    inputManager.simulateNoteOn(61);

    expect(endFn).not.toHaveBeenCalled();
    expect(pm.isActive()).toBe(true);
  });

  it('emits songEnd without loop at end of song', async () => {
    // No loop - all 8 events
    await pm.start();

    const endFn = vi.fn();
    events.on('songEnd', endFn);

    // Play all 8 notes
    for (let i = 0; i < 8; i++) {
      inputManager.simulateNoteOn(60 + i);
    }

    expect(endFn).toHaveBeenCalled();
    expect(pm.isActive()).toBe(false);
  });
});
