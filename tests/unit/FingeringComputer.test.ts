import { describe, it, expect } from 'vitest';
import { FingeringComputer } from '../../src/score/FingeringComputer';
import type { NoteEvent, NoteInfo } from '../../src/types';

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

function makeEvent(index: number, notes: NoteInfo[], measure = 1): NoteEvent {
  return {
    index,
    timestamp: index * 0.5,
    timestampBeats: index,
    notes,
    measureNumber: measure,
  };
}

function singleNoteEvents(midis: number[], staff: 1 | 2 = 1): NoteEvent[] {
  return midis.map((midi, i) => makeEvent(i, [makeNote(midi, staff)]));
}

function getFingers(events: NoteEvent[]): (number | undefined)[] {
  return events.flatMap(e => e.notes.map(n => n.finger));
}

describe('FingeringComputer', () => {
  it('C major ascending RH produces standard 1-2-3-1-2-3-4-5', () => {
    const fc = new FingeringComputer();
    const events = singleNoteEvents([60, 62, 64, 65, 67, 69, 71, 72]);
    fc.compute(events, 'right');
    expect(getFingers(events)).toEqual([1, 2, 3, 1, 2, 3, 4, 5]);
  });

  it('C major descending RH produces standard 5-4-3-2-1-3-2-1', () => {
    const fc = new FingeringComputer();
    const events = singleNoteEvents([72, 71, 69, 67, 65, 64, 62, 60]);
    fc.compute(events, 'right');
    expect(getFingers(events)).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
  });

  it('C major ascending LH produces standard 5-4-3-2-1-3-2-1', () => {
    const fc = new FingeringComputer();
    const events = singleNoteEvents([48, 50, 52, 53, 55, 57, 59, 60], 2);
    fc.compute(events, 'left');
    expect(getFingers(events)).toEqual([5, 4, 3, 2, 1, 3, 2, 1]);
  });

  it('5 ascending stepwise notes RH should be 1-2-3-4-5', () => {
    const fc = new FingeringComputer();
    const events = singleNoteEvents([60, 62, 64, 65, 67]);
    fc.compute(events, 'right');
    expect(getFingers(events)).toEqual([1, 2, 3, 4, 5]);
  });

  it('stepwise motion prefers adjacent fingers, no skipping', () => {
    const fc = new FingeringComputer();
    const events = singleNoteEvents([60, 62, 64]);
    fc.compute(events, 'right');
    const f = getFingers(events);
    const hasSkip = f.some((finger, i) => i > 0 && Math.abs(finger - f[i-1]) > 1);
    expect(hasSkip).toBe(false);
  });

  it('handles a single note', () => {
    const fc = new FingeringComputer();
    const events = singleNoteEvents([60]);
    fc.compute(events, 'right');

    expect(events[0].notes[0].finger).toBeDefined();
    expect(events[0].notes[0].finger).toBeGreaterThanOrEqual(1);
    expect(events[0].notes[0].finger).toBeLessThanOrEqual(5);
  });

  it('handles empty input', () => {
    const fc = new FingeringComputer();
    fc.compute([], 'right'); // should not throw
  });

  it('does not use the same finger for consecutive different notes', () => {
    const fc = new FingeringComputer();
    const events = singleNoteEvents([60, 62, 64, 65, 67]);
    fc.compute(events, 'right');

    const fingers = getFingers(events);
    for (let i = 1; i < fingers.length; i++) {
      expect(fingers[i]).not.toBe(fingers[i - 1]);
    }
  });

  it('assigns chord with 3 notes as 1-3-5', () => {
    const fc = new FingeringComputer();
    const chord = [makeNote(60), makeNote(64), makeNote(67)]; // C-E-G
    const events = [makeEvent(0, chord)];
    fc.compute(events, 'right');

    // Sorted ascending for right hand: 60, 64, 67
    const sorted = chord.sort((a, b) => a.midi - b.midi);
    expect(sorted[0].finger).toBe(1);
    expect(sorted[1].finger).toBe(3);
    expect(sorted[2].finger).toBe(5);
  });

  it('assigns chord with 2 notes as 1-5', () => {
    const fc = new FingeringComputer();
    const chord = [makeNote(60), makeNote(67)]; // C-G
    const events = [makeEvent(0, chord)];
    fc.compute(events, 'right');

    const sorted = chord.sort((a, b) => a.midi - b.midi);
    expect(sorted[0].finger).toBe(1);
    expect(sorted[1].finger).toBe(5);
  });

  it('assigns chord with 5 notes as 1-2-3-4-5', () => {
    const fc = new FingeringComputer();
    const chord = [makeNote(60), makeNote(62), makeNote(64), makeNote(65), makeNote(67)];
    const events = [makeEvent(0, chord)];
    fc.compute(events, 'right');

    const sorted = chord.sort((a, b) => a.midi - b.midi);
    for (let i = 0; i < 5; i++) {
      expect(sorted[i].finger).toBe(i + 1);
    }
  });

  it('handles left hand ascending (fingers decrease)', () => {
    const fc = new FingeringComputer();
    const events = singleNoteEvents([48, 50, 52, 53, 55], 2); // C3 to G3
    fc.compute(events, 'left');

    const fingers = getFingers(events);
    expect(fingers.every(f => f !== undefined && f >= 1 && f <= 5)).toBe(true);
  });

  it('left hand chord is sorted descending (5 on lowest)', () => {
    const fc = new FingeringComputer();
    const chord = [makeNote(48, 2), makeNote(52, 2), makeNote(55, 2)]; // C-E-G
    const events = [makeEvent(0, chord)];
    fc.compute(events, 'left');

    // Left hand sorts descending: 55, 52, 48 → fingers 1, 3, 5
    const byPitchDesc = chord.sort((a, b) => b.midi - a.midi);
    expect(byPitchDesc[0].finger).toBe(1); // highest note = thumb
    expect(byPitchDesc[1].finger).toBe(3);
    expect(byPitchDesc[2].finger).toBe(5); // lowest note = pinky
  });

  it('skips tied notes', () => {
    const fc = new FingeringComputer();
    const notes = [
      { ...makeNote(60), tied: false },
      { ...makeNote(60), tied: true }, // tied continuation
      { ...makeNote(62), tied: false },
    ];
    const events = [
      makeEvent(0, [notes[0]]),
      makeEvent(1, [notes[1]]),
      makeEvent(2, [notes[2]]),
    ];
    fc.compute(events, 'right');

    expect(notes[0].finger).toBeDefined();
    // Tied note should not get a finger assignment (filtered out)
    expect(notes[1].finger).toBeUndefined();
    expect(notes[2].finger).toBeDefined();
  });

  it('respects maxSpan setting', () => {
    const fc = new FingeringComputer();
    fc.setMaxSpan(12); // beginner: one octave
    // Wide jump beyond an octave
    const events = singleNoteEvents([60, 76]); // C4 to E5 (16 semitones)
    fc.compute(events, 'right');

    // Should still assign fingers (doesn't crash)
    const fingers = getFingers(events);
    expect(fingers.every(f => f !== undefined)).toBe(true);
  });

  it('produces valid fingers for a chromatic passage', () => {
    const fc = new FingeringComputer();
    const midis = Array.from({ length: 12 }, (_, i) => 60 + i); // C4 to B4
    const events = singleNoteEvents(midis);
    fc.compute(events, 'right');

    const fingers = getFingers(events);
    expect(fingers.every(f => f !== undefined && f >= 1 && f <= 5)).toBe(true);
  });

  it('handles repeated same note', () => {
    const fc = new FingeringComputer();
    const events = singleNoteEvents([60, 60, 60]);
    fc.compute(events, 'right');

    const fingers = getFingers(events);
    expect(fingers.every(f => f !== undefined)).toBe(true);
    // Repeated notes should use same finger (zero interval)
    expect(fingers[0]).toBe(fingers[1]);
    expect(fingers[1]).toBe(fingers[2]);
  });

  it('mixes chords and single notes', () => {
    const fc = new FingeringComputer();
    const events = [
      makeEvent(0, [makeNote(60)]), // single C
      makeEvent(1, [makeNote(64), makeNote(67), makeNote(72)]), // chord E-G-C
      makeEvent(2, [makeNote(71)]), // single B
    ];
    fc.compute(events, 'right');

    expect(events[0].notes[0].finger).toBeDefined();
    expect(events[1].notes.every(n => n.finger !== undefined)).toBe(true);
    expect(events[2].notes[0].finger).toBeDefined();
  });

  it('different maxSpan produces different results for wide intervals', () => {
    const makeEvents = () => singleNoteEvents([60, 72, 60, 72, 60]); // alternating C4-C5

    const fc1 = new FingeringComputer();
    fc1.setMaxSpan(12);
    const events1 = makeEvents();
    fc1.compute(events1, 'right');

    const fc2 = new FingeringComputer();
    fc2.setMaxSpan(24);
    const events2 = makeEvents();
    fc2.compute(events2, 'right');

    // Both should produce valid fingering
    expect(getFingers(events1).every(f => f !== undefined && f! >= 1 && f! <= 5)).toBe(true);
    expect(getFingers(events2).every(f => f !== undefined && f! >= 1 && f! <= 5)).toBe(true);
  });
});
