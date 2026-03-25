import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    scrollToCursor: vi.fn(),
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
    midi, name: `N${midi}`, duration: 0.5, durationBeats: 1,
    velocity: 0.8, staff, voice: 1, tied: false,
  };
}

function makeTimeline(events: { midis: number[]; staff?: 1 | 2; measure?: number }[]): NoteEvent[] {
  return events.map((e, i) => ({
    index: i,
    timestamp: i * 0.5,
    timestampBeats: i,
    notes: e.midis.map(m => makeNote(m, e.staff ?? 1)),
    measureNumber: e.measure ?? Math.floor(i / 4) + 1,
  }));
}

function createMockAnalyzer(timeline: NoteEvent[]) {
  return {
    getTimeline: vi.fn().mockReturnValue(timeline),
    filterByHand: vi.fn().mockImplementation((hand: string) => {
      if (hand === 'both') return timeline;
      const staff = hand === 'right' ? 1 : 2;
      return timeline
        .map(event => ({ ...event, notes: event.notes.filter(n => n.staff === staff) }))
        .filter(e => e.notes.length > 0);
    }),
  } as any;
}

describe('PracticeMode - setHand while active', () => {
  it('resets cursor and stats when hand changes during practice', async () => {
    const timeline = makeTimeline([
      { midis: [60], staff: 1 },
      { midis: [40], staff: 2 },
      { midis: [64], staff: 1 },
      { midis: [44], staff: 2 },
    ]);
    const im = new InputManager();
    const events = new EventEmitter();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer(timeline), im, createMockKeyboard(), events,
    );

    await pm.start();
    im.simulateNoteOn(60); // play first note (staff 1)
    expect(pm.getCursorIndex()).toBe(1);

    // Switch to right hand only
    pm.setHand('right');
    expect(pm.getCursorIndex()).toBe(0); // reset
    expect(pm.getState().totalNotes).toBe(2); // only staff-1 events
  });
});

describe('PracticeMode - accompaniment', () => {
  it('plays accompaniment notes from other hand when enabled', async () => {
    const timeline = makeTimeline([
      { midis: [60], staff: 1 },
      { midis: [64], staff: 1 },
    ]);
    // Add staff-2 notes to full timeline
    timeline[0].notes.push(makeNote(40, 2));
    timeline[1].notes.push(makeNote(44, 2));

    const audio = createMockAudio();
    const im = new InputManager();
    const events = new EventEmitter();
    const analyzer = {
      getTimeline: vi.fn().mockReturnValue(timeline),
      filterByHand: vi.fn().mockImplementation((hand: string) => {
        if (hand === 'both') return timeline;
        const staff = hand === 'right' ? 1 : 2;
        return timeline
          .map(e => ({ ...e, notes: e.notes.filter(n => n.staff === staff) }))
          .filter(e => e.notes.length > 0);
      }),
    } as any;

    const pm = new PracticeMode(
      audio, createMockRenderer(), analyzer, im, createMockKeyboard(), events,
    );

    pm.setHand('right');
    pm.setAccompaniment(true);
    expect(pm.isAccompanimentEnabled()).toBe(true);

    await pm.start();
    im.simulateNoteOn(60); // play right hand note

    // Accompaniment should have played the left hand note (40)
    expect(audio.playNote).toHaveBeenCalledWith(40, expect.any(Number), expect.any(Number));
  });

  it('does not play accompaniment when disabled', async () => {
    const timeline = makeTimeline([{ midis: [60], staff: 1 }, { midis: [64], staff: 1 }]);
    timeline[0].notes.push(makeNote(40, 2));

    const audio = createMockAudio();
    const im = new InputManager();
    const pm = new PracticeMode(
      audio, createMockRenderer(),
      createMockAnalyzer(timeline), im, createMockKeyboard(), new EventEmitter(),
    );

    pm.setHand('right');
    pm.setAccompaniment(false);
    await pm.start();
    im.simulateNoteOn(60);

    expect(audio.playNote).not.toHaveBeenCalled();
  });
});

describe('PracticeMode - auto-advance', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('auto-advances after timeout', async () => {
    const timeline = makeTimeline([{ midis: [60] }, { midis: [64] }, { midis: [67] }]);
    const audio = createMockAudio();
    const im = new InputManager();
    const events = new EventEmitter();
    const pm = new PracticeMode(
      audio, createMockRenderer(),
      createMockAnalyzer(timeline), im, createMockKeyboard(), events,
    );

    pm.setAutoAdvance(1000);
    expect(pm.getAutoAdvanceTimeout()).toBe(1000);

    await pm.start();
    expect(pm.getCursorIndex()).toBe(0);

    vi.advanceTimersByTime(1100);
    expect(pm.getCursorIndex()).toBe(1);
    expect(pm.getState().wrongCount).toBe(1);
    // Should have played the hint note
    expect(audio.playNote).toHaveBeenCalledWith(60, 0.5, 0.6);
  });

  it('setAutoAdvance while active starts timer', async () => {
    const timeline = makeTimeline([{ midis: [60] }, { midis: [64] }]);
    const im = new InputManager();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer(timeline), im, createMockKeyboard(), new EventEmitter(),
    );

    await pm.start();
    pm.setAutoAdvance(500);

    vi.advanceTimersByTime(600);
    expect(pm.getCursorIndex()).toBe(1);
  });

  it('disabling auto-advance prevents timer', async () => {
    const timeline = makeTimeline([{ midis: [60] }, { midis: [64] }]);
    const im = new InputManager();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer(timeline), im, createMockKeyboard(), new EventEmitter(),
    );

    pm.setAutoAdvance(500);
    await pm.start();
    pm.setAutoAdvance(0);

    vi.advanceTimersByTime(1000);
    expect(pm.getCursorIndex()).toBe(0);
  });
});

describe('PracticeMode - setLoop while active', () => {
  it('resets stats when loop is set during practice', async () => {
    const timeline = makeTimeline([
      { midis: [60], measure: 1 },
      { midis: [64], measure: 1 },
      { midis: [67], measure: 2 },
      { midis: [72], measure: 2 },
      { midis: [76], measure: 3 },
    ]);
    const im = new InputManager();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer(timeline), im, createMockKeyboard(), new EventEmitter(),
    );

    await pm.start();
    im.simulateNoteOn(60); // correct
    im.simulateNoteOn(62); // wrong
    expect(pm.getState().correctCount).toBe(1);
    expect(pm.getState().wrongCount).toBe(1);

    // Set loop — should reset stats
    pm.setLoop(1, 2);
    expect(pm.getState().correctCount).toBe(0);
    expect(pm.getState().wrongCount).toBe(0);
    expect(pm.getCursorIndex()).toBe(0);
  });

  it('clearLoop while active restores full timeline', async () => {
    const timeline = makeTimeline([
      { midis: [60], measure: 1 },
      { midis: [64], measure: 2 },
      { midis: [67], measure: 3 },
    ]);
    const im = new InputManager();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer(timeline), im, createMockKeyboard(), new EventEmitter(),
    );

    pm.setLoop(1, 1);
    await pm.start();
    expect(pm.getState().totalNotes).toBe(1);

    pm.clearLoop();
    expect(pm.getState().totalNotes).toBe(3);
    expect(pm.isLoopEnabled()).toBe(false);
  });
});

describe('PracticeMode - empty timeline guard', () => {
  it('does not start if timeline is empty', async () => {
    const im = new InputManager();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer([]), im, createMockKeyboard(), new EventEmitter(),
    );

    await pm.start();
    expect(pm.isActive()).toBe(false);
  });
});

describe('PracticeMode - wrong note marker', () => {
  it('calls showWrongNote on renderer with note name', async () => {
    const timeline = makeTimeline([{ midis: [60] }]);
    const renderer = createMockRenderer();
    const im = new InputManager();
    const pm = new PracticeMode(
      createMockAudio(), renderer,
      createMockAnalyzer(timeline), im, createMockKeyboard(), new EventEmitter(),
    );

    await pm.start();
    im.simulateNoteOn(62); // wrong note D4

    expect(renderer.showWrongNote).toHaveBeenCalledWith(100, 50, 'D4');
  });
});

describe('PracticeMode - stop clears everything', () => {
  it('clears auto-advance timer, highlights, and keyboard on stop', async () => {
    const timeline = makeTimeline([{ midis: [60] }, { midis: [64] }]);
    const renderer = createMockRenderer();
    const keyboard = createMockKeyboard();
    const im = new InputManager();
    const pm = new PracticeMode(
      createMockAudio(), renderer,
      createMockAnalyzer(timeline), im, keyboard, new EventEmitter(),
    );

    await pm.start();
    pm.stop();

    expect(renderer.clearNoteHighlights).toHaveBeenCalled();
    expect(renderer.cursorHide).toHaveBeenCalled();
    expect(keyboard.highlightKeys).toHaveBeenCalledWith([]);
    expect(pm.isActive()).toBe(false);
  });
});
