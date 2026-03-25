import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InputManager } from '../../src/input/InputManager';
import { EventEmitter } from '../../src/events';
import type { NoteEvent, NoteInfo } from '../../src/types';

// Mock classes for PracticeMode dependencies
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

function createMockAnalyzer(timeline: NoteEvent[]) {
  return {
    getTimeline: vi.fn().mockReturnValue(timeline),
    filterByHand: vi.fn().mockImplementation((hand: string) => {
      if (hand === 'both') return timeline;
      const staff = hand === 'right' ? 1 : 2;
      return timeline
        .map((e, i) => ({ ...e, index: i, notes: e.notes.filter(n => n.staff === staff) }))
        .filter(e => e.notes.length > 0);
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

function makeNote(midi: number, staff: 1 | 2 = 1): NoteInfo {
  return {
    midi,
    name: `N${midi}`,
    duration: 0.5,
    durationBeats: 1,
    velocity: 0.8,
    staff,
    voice: 1,
    tied: false,
  };
}

function makeTimeline(events: { midis: number[]; staff?: 1 | 2 }[]): NoteEvent[] {
  return events.map((e, i) => ({
    index: i,
    timestamp: i * 0.5,
    timestampBeats: i,
    notes: e.midis.map(m => makeNote(m, e.staff ?? 1)),
    measureNumber: Math.floor(i / 4) + 1,
  }));
}

// We test PracticeMode by importing the actual class but with mocked dependencies
import { PracticeMode } from '../../src/modes/PracticeMode';

describe('PracticeMode', () => {
  let pm: PracticeMode;
  let audio: ReturnType<typeof createMockAudio>;
  let renderer: ReturnType<typeof createMockRenderer>;
  let inputManager: InputManager;
  let events: EventEmitter;
  let keyboard: ReturnType<typeof createMockKeyboard>;
  let timeline: NoteEvent[];

  beforeEach(() => {
    timeline = makeTimeline([
      { midis: [60] },         // C4
      { midis: [64] },         // E4
      { midis: [67] },         // G4
      { midis: [60, 64, 67] }, // C major chord
    ]);

    audio = createMockAudio();
    renderer = createMockRenderer();
    inputManager = new InputManager();
    events = new EventEmitter();
    keyboard = createMockKeyboard();
    const analyzer = createMockAnalyzer(timeline);

    pm = new PracticeMode(audio, renderer, analyzer, inputManager, keyboard, events);
  });

  it('starts practice mode correctly', async () => {
    await pm.start();

    expect(pm.isActive()).toBe(true);
    expect(pm.getCursorIndex()).toBe(0);
    expect(pm.getExpectedNotes()).toEqual([60]);
    expect(renderer.cursorReset).toHaveBeenCalled();
    expect(renderer.cursorShow).toHaveBeenCalled();
    expect(keyboard.highlightKeys).toHaveBeenCalledWith([60]);
  });

  it('advances cursor on correct note', async () => {
    await pm.start();
    const correctFn = vi.fn();
    events.on('noteCorrect', correctFn);

    inputManager.simulateNoteOn(60);

    expect(correctFn).toHaveBeenCalledWith({
      midiNumber: 60,
      cursorIndex: 0,
    });
    expect(pm.getCursorIndex()).toBe(1);
    expect(pm.getExpectedNotes()).toEqual([64]);
  });

  it('shows wrong note and does not advance on incorrect input', async () => {
    await pm.start();
    const wrongFn = vi.fn();
    events.on('noteWrong', wrongFn);

    inputManager.simulateNoteOn(62); // D4 instead of C4

    expect(wrongFn).toHaveBeenCalledWith({
      midiNumber: 62,
      expected: [60],
      cursorIndex: 0,
    });
    expect(pm.getCursorIndex()).toBe(0); // didn't advance
    expect(keyboard.markWrong).toHaveBeenCalledWith(62);
    expect(renderer.showWrongNote).toHaveBeenCalled();
  });

  it('handles chords: waits for all notes before advancing', async () => {
    // Skip to the chord at index 3
    timeline = makeTimeline([
      { midis: [60, 64, 67] }, // C major chord
      { midis: [72] },
    ]);
    const analyzer = createMockAnalyzer(timeline);
    pm = new PracticeMode(audio, renderer, analyzer, inputManager, keyboard, events);

    await pm.start();
    expect(pm.getExpectedNotes()).toEqual([60, 64, 67]);

    inputManager.simulateNoteOn(60); // first note
    expect(pm.getCursorIndex()).toBe(0); // still waiting

    inputManager.simulateNoteOn(64); // second note
    expect(pm.getCursorIndex()).toBe(0); // still waiting

    inputManager.simulateNoteOn(67); // third note - all hit!
    expect(pm.getCursorIndex()).toBe(1); // advanced
  });

  it('plays sound on correct note', async () => {
    await pm.start();
    inputManager.simulateNoteOn(60, 90);

    expect(audio.playNoteOn).toHaveBeenCalledWith(60, 90);
  });

  it('plays quiet sound on wrong note', async () => {
    await pm.start();
    inputManager.simulateNoteOn(62);

    expect(audio.playNoteOn).toHaveBeenCalledWith(62, 0.3);
  });

  it('tracks accuracy correctly', async () => {
    await pm.start();

    inputManager.simulateNoteOn(62); // wrong
    inputManager.simulateNoteOn(60); // correct
    inputManager.simulateNoteOn(64); // correct (next note)

    expect(pm.getAccuracy()).toBe(67); // 2 correct, 1 wrong
  });

  it('tracks streak correctly', async () => {
    await pm.start();

    inputManager.simulateNoteOn(60); // correct, streak 1
    expect(pm.getState().streak).toBe(1);

    inputManager.simulateNoteOn(64); // correct, streak 2
    expect(pm.getState().streak).toBe(2);

    inputManager.simulateNoteOn(66); // wrong, streak resets
    expect(pm.getState().streak).toBe(0);

    inputManager.simulateNoteOn(67); // correct, streak 1
    expect(pm.getState().streak).toBe(1);
    expect(pm.getState().bestStreak).toBe(2);
  });

  it('emits songEnd when all notes completed', async () => {
    timeline = makeTimeline([{ midis: [60] }, { midis: [64] }]);
    const analyzer = createMockAnalyzer(timeline);
    pm = new PracticeMode(audio, renderer, analyzer, inputManager, keyboard, events);

    const endFn = vi.fn();
    events.on('songEnd', endFn);

    await pm.start();
    inputManager.simulateNoteOn(60);
    inputManager.simulateNoteOn(64);

    expect(endFn).toHaveBeenCalled();
    expect(pm.isActive()).toBe(false);
  });

  it('stops practice mode correctly', async () => {
    await pm.start();
    pm.stop();

    expect(pm.isActive()).toBe(false);
    expect(renderer.cursorHide).toHaveBeenCalled();
    expect(keyboard.highlightKeys).toHaveBeenCalledWith([]);
  });

  it('does not respond to input when stopped', async () => {
    await pm.start();
    pm.stop();

    const listener = vi.fn();
    events.on('noteCorrect', listener);

    inputManager.simulateNoteOn(60);

    expect(listener).not.toHaveBeenCalled();
  });

  it('ignores noteOff events', async () => {
    await pm.start();
    inputManager.simulateNoteOff(60);

    expect(pm.getCursorIndex()).toBe(0);
  });

  it('getState returns correct state', async () => {
    await pm.start();
    inputManager.simulateNoteOn(60);

    const state = pm.getState();
    expect(state.cursorIndex).toBe(1);
    expect(state.correctCount).toBe(1);
    expect(state.wrongCount).toBe(0);
    expect(state.totalNotes).toBe(4);
    expect(state.startTime).not.toBeNull();
  });

  it('marks correct keys on virtual keyboard', async () => {
    await pm.start();
    inputManager.simulateNoteOn(60);

    expect(keyboard.markCorrect).toHaveBeenCalledWith(60);
  });

  it('tracks per-measure stats', async () => {
    await pm.start();

    // First note is in measure 1
    inputManager.simulateNoteOn(62); // wrong, measure 1
    inputManager.simulateNoteOn(60); // correct, measure 1

    const state = pm.getState();
    expect(state.measureStats.length).toBeGreaterThan(0);
    const m1 = state.measureStats.find(m => m.measure === 1);
    expect(m1).toBeDefined();
    expect(m1!.correct).toBe(1);
    expect(m1!.wrong).toBe(1);
  });

  it('measure stats reset on start', async () => {
    await pm.start();
    inputManager.simulateNoteOn(62); // wrong
    inputManager.simulateNoteOn(60); // correct

    pm.stop();
    await pm.start();

    const state = pm.getState();
    expect(state.measureStats.length).toBe(0);
  });
});
