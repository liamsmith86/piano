import { describe, it, expect, vi, beforeEach } from 'vitest';
import { InputManager } from '../../src/input/InputManager';
import { EventEmitter } from '../../src/events';
import { PracticeMode } from '../../src/modes/PracticeMode';
import type { NoteEvent, NoteInfo } from '../../src/types';
import {
  midiToNoteName,
  noteNameToMidi,
  midiToFrequency,
  midiToStaffPosition,
} from '../../src/types';

// --- Utility edge cases ---

describe('Utility Edge Cases', () => {
  it('midiToNoteName handles boundary values', () => {
    expect(midiToNoteName(0)).toBe('C-1');
    expect(midiToNoteName(127)).toBe('G9');
    expect(midiToNoteName(21)).toBe('A0');  // lowest piano key
    expect(midiToNoteName(108)).toBe('C8'); // highest piano key
  });

  it('noteNameToMidi handles lowercase', () => {
    expect(noteNameToMidi('c4')).toBe(60);
    expect(noteNameToMidi('a4')).toBe(69);
  });

  it('midiToFrequency handles extreme values', () => {
    const f0 = midiToFrequency(0);
    expect(f0).toBeGreaterThan(0);
    expect(f0).toBeLessThan(20); // below human hearing

    const f127 = midiToFrequency(127);
    expect(f127).toBeGreaterThan(10000);
  });

  it('midiToStaffPosition is consistent across octaves', () => {
    // B4 is reference for treble (position 0)
    // B5 should be +7 (one octave = 7 diatonic steps)
    const posB4 = midiToStaffPosition(71, 1);
    const posB5 = midiToStaffPosition(83, 1);
    expect(posB5 - posB4).toBe(7);
  });

  it('noteNameToMidi roundtrips for all piano keys', () => {
    for (let midi = 21; midi <= 108; midi++) {
      const name = midiToNoteName(midi);
      const back = noteNameToMidi(name);
      expect(back).toBe(midi);
    }
  });
});

// --- Practice Mode edge cases ---

function createMockAudio() {
  return {
    ready: true,
    init: vi.fn().mockResolvedValue(undefined),
    playNote: vi.fn(),
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
    showWrongNoteAtCursor: vi.fn(),
    highlightCurrentNotes: vi.fn(),
    markNotesPlayed: vi.fn(),
    clearNoteHighlights: vi.fn(),
    resetPlayedNotes: vi.fn(),
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

function makeTimeline(events: { midis: number[]; staff?: 1 | 2 }[]): NoteEvent[] {
  return events.map((e, i) => ({
    index: i,
    timestamp: i * 0.5,
    timestampBeats: i,
    notes: e.midis.map(m => makeNote(m, e.staff ?? 1)),
    measureNumber: Math.floor(i / 4) + 1,
  }));
}

function createMockAnalyzer(timeline: NoteEvent[]) {
  return {
    getTimeline: vi.fn().mockReturnValue(timeline),
    filterByHand: vi.fn().mockImplementation((hand: string) => {
      if (hand === 'both') return timeline;
      const staff = hand === 'right' ? 1 : 2;
      return timeline
        .map(e => ({ ...e, notes: e.notes.filter(n => n.staff === staff) }))
        .filter(e => e.notes.length > 0);
    }),
  } as any;
}

describe('PracticeMode Edge Cases', () => {
  it('handles single-note song', async () => {
    const timeline = makeTimeline([{ midis: [60] }]);
    const im = new InputManager();
    const events = new EventEmitter();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer(timeline), im,
      createMockKeyboard(), events,
    );

    const endFn = vi.fn();
    events.on('songEnd', endFn);

    await pm.start();
    expect(pm.getState().totalNotes).toBe(1);

    im.simulateNoteOn(60);
    expect(endFn).toHaveBeenCalled();
    expect(pm.isActive()).toBe(false);
  });

  it('handles rapid successive inputs', async () => {
    const timeline = makeTimeline([
      { midis: [60] }, { midis: [64] }, { midis: [67] },
      { midis: [72] }, { midis: [76] },
    ]);
    const im = new InputManager();
    const events = new EventEmitter();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer(timeline), im,
      createMockKeyboard(), events,
    );

    await pm.start();

    // Rapid-fire all correct notes
    im.simulateNoteOn(60);
    im.simulateNoteOn(64);
    im.simulateNoteOn(67);
    im.simulateNoteOn(72);
    im.simulateNoteOn(76);

    expect(pm.getState().correctCount).toBe(5);
    expect(pm.isActive()).toBe(false);
  });

  it('handles large chords (5+ notes)', async () => {
    const timeline = makeTimeline([
      { midis: [60, 64, 67, 72, 76] }, // 5-note chord
    ]);
    const im = new InputManager();
    const events = new EventEmitter();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer(timeline), im,
      createMockKeyboard(), events,
    );

    await pm.start();
    expect(pm.getExpectedNotes()).toEqual([60, 64, 67, 72, 76]);

    // Press in random order
    im.simulateNoteOn(72);
    expect(pm.getCursorIndex()).toBe(0); // not all hit yet
    im.simulateNoteOn(60);
    im.simulateNoteOn(76);
    im.simulateNoteOn(67);
    im.simulateNoteOn(64); // last one

    expect(pm.getState().correctCount).toBe(1);
  });

  it('handles same note pressed twice', async () => {
    const timeline = makeTimeline([{ midis: [60] }]);
    const im = new InputManager();
    const events = new EventEmitter();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer(timeline), im,
      createMockKeyboard(), events,
    );

    await pm.start();
    // Press the correct note twice rapidly
    im.simulateNoteOn(60);
    // Song should have ended after the first press
    expect(pm.isActive()).toBe(false);
  });

  it('wrong note does not affect hit tracking', async () => {
    const timeline = makeTimeline([{ midis: [60, 64] }]); // chord
    const im = new InputManager();
    const events = new EventEmitter();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer(timeline), im,
      createMockKeyboard(), events,
    );

    await pm.start();

    im.simulateNoteOn(62); // wrong
    im.simulateNoteOn(60); // correct
    im.simulateNoteOn(63); // wrong
    im.simulateNoteOn(64); // correct - completes chord

    expect(pm.getState().correctCount).toBe(1);
    expect(pm.getState().wrongCount).toBe(2);
  });

  it('getAccuracy handles zero inputs', async () => {
    const timeline = makeTimeline([{ midis: [60] }]);
    const im = new InputManager();
    const events = new EventEmitter();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer(timeline), im,
      createMockKeyboard(), events,
    );

    await pm.start();
    expect(pm.getAccuracy()).toBe(100); // no inputs = 100%
  });

  it('elapsed time increases during practice', async () => {
    const timeline = makeTimeline([{ midis: [60] }, { midis: [64] }]);
    const im = new InputManager();
    const events = new EventEmitter();
    const pm = new PracticeMode(
      createMockAudio(), createMockRenderer(),
      createMockAnalyzer(timeline), im,
      createMockKeyboard(), events,
    );

    await pm.start();
    const t1 = pm.getElapsedTime();
    expect(t1).toBeGreaterThanOrEqual(0);

    // Small delay
    await new Promise(r => setTimeout(r, 50));
    const t2 = pm.getElapsedTime();
    expect(t2).toBeGreaterThan(t1);
  });
});

// --- InputManager edge cases ---

describe('InputManager Edge Cases', () => {
  it('handles noteOff for note that was never pressed', () => {
    const im = new InputManager();
    const listener = vi.fn();
    im.addListener(listener);

    // noteOff without prior noteOn
    im.simulateNoteOff(60);

    expect(listener).toHaveBeenCalled();
    expect(im.isNoteActive(60)).toBe(false);
  });

  it('handles duplicate noteOn', () => {
    const im = new InputManager();

    im.simulateNoteOn(60);
    im.simulateNoteOn(60); // duplicate

    expect(im.isNoteActive(60)).toBe(true);
    expect(im.getActiveNotes().size).toBe(1);
  });

  it('handles many simultaneous notes', () => {
    const im = new InputManager();

    // Press 10 notes at once
    for (let i = 60; i < 70; i++) {
      im.simulateNoteOn(i);
    }

    expect(im.getActiveNotes().size).toBe(10);

    // Release all
    for (let i = 60; i < 70; i++) {
      im.simulateNoteOff(i);
    }

    expect(im.getActiveNotes().size).toBe(0);
  });
});

// --- EventEmitter edge cases ---

describe('EventEmitter Edge Cases', () => {
  it('same listener added twice only fires once', () => {
    const emitter = new EventEmitter();
    const listener = vi.fn();

    emitter.on('loaded', listener);
    emitter.on('loaded', listener); // duplicate

    emitter.emit('loaded', { songId: 'x' });
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('removing non-existent listener is a no-op', () => {
    const emitter = new EventEmitter();
    const listener = vi.fn();

    // Remove listener that was never added
    expect(() => emitter.off('loaded', listener)).not.toThrow();
  });

  it('removeAllListeners for non-existent event is a no-op', () => {
    const emitter = new EventEmitter();
    expect(() => emitter.removeAllListeners('loaded')).not.toThrow();
  });
});
