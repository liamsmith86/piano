import { describe, it, expect } from 'vitest';
import { ScoreAnalyzer } from '../../src/score/ScoreAnalyzer';
import type { NoteEvent } from '../../src/types';

// Mock OSMD with a cursor that iterates through predefined data
function createMockOSMD(noteData: { midi: number; staff: number; beats: number; measure: number; tied?: boolean }[][]) {
  let cursorPos = 0;
  const totalPositions = noteData.length;
  let beatPosition = 0;

  const mockCursor = {
    reset: () => { cursorPos = 0; beatPosition = 0; },
    next: () => { cursorPos++; beatPosition += 0.25; },
    Iterator: {
      get EndReached() { return cursorPos >= totalPositions; },
      get currentTimeStamp() {
        return { RealValue: beatPosition };
      },
      get CurrentMeasureIndex() {
        return noteData[cursorPos]?.[0]?.measure ?? 0;
      },
      get CurrentVoiceEntries() {
        if (cursorPos >= totalPositions) return [];
        return noteData[cursorPos].map(note => ({
          Notes: [{
            isRest: () => note.midi === 0,
            halfTone: note.midi > 0 ? note.midi - 12 : 0,
            Length: { RealValue: note.beats / 4 },
            ParentStaffEntry: {
              ParentStaff: { idInMusicSheet: note.staff - 1 },
            },
            NoteTie: note.tied ? { StartNote: {} } : undefined,
          }],
          ParentVoice: { VoiceId: 1 },
        }));
      },
    },
  };

  return {
    cursors: [mockCursor],
    sheet: {
      HasBPMInfo: true,
      SourceMeasures: [
        { TempoInBPM: 120, Duration: { RealValue: 1 } },
      ],
    },
  } as any;
}

describe('ScoreAnalyzer', () => {
  it('extracts single notes from cursor', () => {
    const osmd = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
      [{ midi: 64, staff: 1, beats: 1, measure: 0 }],
    ]);

    const analyzer = new ScoreAnalyzer();
    const timeline = analyzer.analyze(osmd);

    expect(timeline).toHaveLength(2);
    expect(timeline[0].notes[0].midi).toBe(60);
    expect(timeline[1].notes[0].midi).toBe(64);
  });

  it('assigns correct staff numbers', () => {
    const osmd = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],  // treble
      [{ midi: 40, staff: 2, beats: 1, measure: 0 }],  // bass
    ]);

    const analyzer = new ScoreAnalyzer();
    const timeline = analyzer.analyze(osmd);

    expect(timeline[0].notes[0].staff).toBe(1);
    expect(timeline[1].notes[0].staff).toBe(2);
  });

  it('groups chords at same position', () => {
    const osmd = createMockOSMD([
      [
        { midi: 60, staff: 1, beats: 1, measure: 0 },
        { midi: 64, staff: 1, beats: 1, measure: 0 },
        { midi: 67, staff: 1, beats: 1, measure: 0 },
      ],
    ]);

    const analyzer = new ScoreAnalyzer();
    const timeline = analyzer.analyze(osmd);

    expect(timeline).toHaveLength(1);
    expect(timeline[0].notes).toHaveLength(3);
    expect(timeline[0].notes.map(n => n.midi)).toEqual([60, 64, 67]);
  });

  it('skips rests', () => {
    const osmd = createMockOSMD([
      [{ midi: 0, staff: 1, beats: 1, measure: 0 }],  // rest (midi 0)
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
    ]);

    const analyzer = new ScoreAnalyzer();
    const timeline = analyzer.analyze(osmd);

    expect(timeline).toHaveLength(1);
    expect(timeline[0].notes[0].midi).toBe(60);
  });

  it('skips tied continuation notes', () => {
    const osmd = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
      [{ midi: 60, staff: 1, beats: 1, measure: 0, tied: true }], // tied continuation
    ]);

    const analyzer = new ScoreAnalyzer();
    const timeline = analyzer.analyze(osmd);

    expect(timeline).toHaveLength(1);
  });

  it('filterByHand returns only matching staff', () => {
    const osmd = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
      [{ midi: 40, staff: 2, beats: 1, measure: 0 }],
      [{ midi: 64, staff: 1, beats: 1, measure: 0 }],
    ]);

    const analyzer = new ScoreAnalyzer();
    analyzer.analyze(osmd);

    const rightHand = analyzer.filterByHand('right');
    expect(rightHand).toHaveLength(2);
    expect(rightHand.every(e => e.notes.every(n => n.staff === 1))).toBe(true);

    const leftHand = analyzer.filterByHand('left');
    expect(leftHand).toHaveLength(1);
    expect(leftHand[0].notes[0].staff).toBe(2);
  });

  it('filterByHand both returns all events', () => {
    const osmd = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
      [{ midi: 40, staff: 2, beats: 1, measure: 0 }],
    ]);

    const analyzer = new ScoreAnalyzer();
    analyzer.analyze(osmd);

    const both = analyzer.filterByHand('both');
    expect(both).toHaveLength(2);
  });

  it('getTotalDuration returns correct value', () => {
    const osmd = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
      [{ midi: 64, staff: 1, beats: 2, measure: 0 }],
    ]);

    const analyzer = new ScoreAnalyzer();
    analyzer.analyze(osmd);

    const duration = analyzer.getTotalDuration();
    expect(duration).toBeGreaterThan(0);
  });

  it('getEventAtIndex returns correct event', () => {
    const osmd = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
      [{ midi: 64, staff: 1, beats: 1, measure: 0 }],
    ]);

    const analyzer = new ScoreAnalyzer();
    analyzer.analyze(osmd);

    const event = analyzer.getEventAtIndex(1);
    expect(event).not.toBeNull();
    expect(event!.notes[0].midi).toBe(64);

    const oob = analyzer.getEventAtIndex(99);
    expect(oob).toBeNull();
  });

  it('getDefaultTempo returns extracted tempo', () => {
    const osmd = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
    ]);

    const analyzer = new ScoreAnalyzer();
    analyzer.analyze(osmd);

    expect(analyzer.getDefaultTempo()).toBe(120);
  });

  it('resets on re-analysis', () => {
    const osmd1 = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
    ]);
    const osmd2 = createMockOSMD([
      [{ midi: 64, staff: 1, beats: 1, measure: 0 }],
      [{ midi: 67, staff: 1, beats: 1, measure: 0 }],
    ]);

    const analyzer = new ScoreAnalyzer();

    analyzer.analyze(osmd1);
    expect(analyzer.getTimeline()).toHaveLength(1);

    analyzer.analyze(osmd2);
    expect(analyzer.getTimeline()).toHaveLength(2);
    expect(analyzer.getTimeline()[0].notes[0].midi).toBe(64);
  });

  it('handles empty score', () => {
    const osmd = createMockOSMD([]);
    const analyzer = new ScoreAnalyzer();
    const timeline = analyzer.analyze(osmd);

    expect(timeline).toHaveLength(0);
    expect(analyzer.getTotalDuration()).toBe(0);
  });

  it('generates note names for each note', () => {
    const osmd = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
    ]);

    const analyzer = new ScoreAnalyzer();
    analyzer.analyze(osmd);

    expect(analyzer.getTimeline()[0].notes[0].name).toBe('C4');
  });

  it('assigns sequential indices', () => {
    const osmd = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
      [{ midi: 64, staff: 1, beats: 1, measure: 0 }],
      [{ midi: 67, staff: 1, beats: 1, measure: 0 }],
    ]);

    const analyzer = new ScoreAnalyzer();
    const timeline = analyzer.analyze(osmd);

    expect(timeline[0].index).toBe(0);
    expect(timeline[1].index).toBe(1);
    expect(timeline[2].index).toBe(2);
  });

  it('filterByHand preserves original indices for cursor sync', () => {
    // Events at indices 0 (staff 1), 1 (staff 2), 2 (staff 1), 3 (staff 2)
    const osmd = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
      [{ midi: 40, staff: 2, beats: 1, measure: 0 }],
      [{ midi: 64, staff: 1, beats: 1, measure: 0 }],
      [{ midi: 44, staff: 2, beats: 1, measure: 0 }],
    ]);

    const analyzer = new ScoreAnalyzer();
    analyzer.analyze(osmd);

    const rightHand = analyzer.filterByHand('right');
    expect(rightHand).toHaveLength(2);
    // Original indices 0 and 2 (the staff-1 events)
    expect(rightHand[0].index).toBe(0);
    expect(rightHand[1].index).toBe(2);

    const leftHand = analyzer.filterByHand('left');
    expect(leftHand).toHaveLength(2);
    // Original indices 1 and 3 (the staff-2 events)
    expect(leftHand[0].index).toBe(1);
    expect(leftHand[1].index).toBe(3);
  });

  it('handles multi-tempo pieces correctly', () => {
    // Create a mock with tempo changes between measures
    let cursorPos = 0;
    let beatPos = 0;

    const noteData = [
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
      [{ midi: 64, staff: 1, beats: 1, measure: 1 }],
    ];

    const mockCursor = {
      reset: () => { cursorPos = 0; beatPos = 0; },
      next: () => { cursorPos++; beatPos += 0.25; },
      Iterator: {
        get EndReached() { return cursorPos >= noteData.length; },
        get currentTimeStamp() { return { RealValue: beatPos }; },
        get CurrentMeasureIndex() { return noteData[cursorPos]?.[0]?.measure ?? 0; },
        get CurrentVoiceEntries() {
          if (cursorPos >= noteData.length) return [];
          return noteData[cursorPos].map(note => ({
            Notes: [{
              isRest: () => false,
              halfTone: note.midi - 12,
              Length: { RealValue: note.beats / 4 },
              ParentStaffEntry: { ParentStaff: { idInMusicSheet: 0 } },
              NoteTie: undefined,
            }],
            ParentVoice: { VoiceId: 1 },
          }));
        },
      },
    };

    const multiTempoOsmd = {
      cursors: [mockCursor],
      sheet: {
        HasBPMInfo: true,
        SourceMeasures: [
          { TempoInBPM: 60, Duration: { RealValue: 1 } },   // Measure 1: 60 BPM
          { TempoInBPM: 120, Duration: { RealValue: 1 } },  // Measure 2: 120 BPM
        ],
      },
    } as any;

    const analyzer = new ScoreAnalyzer();
    analyzer.analyze(multiTempoOsmd);

    expect(analyzer.getDefaultTempo()).toBe(60);

    const tempoMap = analyzer.getTempoMap();
    expect(tempoMap.length).toBe(2);
    expect(tempoMap[0].bpm).toBe(60);
    expect(tempoMap[1].bpm).toBe(120);

    // First note at beat 0 → 0 seconds
    const t = analyzer.getTimeline();
    expect(t[0].timestamp).toBe(0);
    // Second note at beat 1 → should be 1 second (at 60 BPM, 1 beat = 1 second)
    expect(t[1].timestamp).toBeCloseTo(1, 1);
  });

  it('handles song with no BPM info (default tempo)', () => {
    let cursorPos = 0;
    const mockOsmd = {
      cursors: [{
        reset: () => { cursorPos = 0; },
        next: () => { cursorPos++; },
        Iterator: {
          get EndReached() { return cursorPos >= 1; },
          get currentTimeStamp() { return { RealValue: 0 }; },
          get CurrentMeasureIndex() { return 0; },
          get CurrentVoiceEntries() {
            if (cursorPos >= 1) return [];
            return [{
              Notes: [{
                isRest: () => false,
                halfTone: 48,
                Length: { RealValue: 0.25 },
                ParentStaffEntry: { ParentStaff: { idInMusicSheet: 0 } },
                NoteTie: undefined,
              }],
              ParentVoice: { VoiceId: 1 },
            }];
          },
        },
      }],
      sheet: {
        HasBPMInfo: false,
        SourceMeasures: [
          { TempoInBPM: 0, Duration: { RealValue: 1 } },
        ],
      },
    } as any;

    const analyzer = new ScoreAnalyzer();
    analyzer.analyze(mockOsmd);

    // Should fall back to default 120 BPM
    expect(analyzer.getDefaultTempo()).toBe(120);
    expect(analyzer.getTempoMap()).toHaveLength(1);
    expect(analyzer.getTempoMap()[0].bpm).toBe(120);
  });

  it('getTotalDuration returns 0 for empty timeline', () => {
    const analyzer = new ScoreAnalyzer();
    expect(analyzer.getTotalDuration()).toBe(0);
  });

  it('getTotalDuration handles empty notes array', () => {
    const osmd = createMockOSMD([
      [{ midi: 60, staff: 1, beats: 1, measure: 0 }],
    ]);
    const analyzer = new ScoreAnalyzer();
    analyzer.analyze(osmd);
    // Should not throw
    expect(analyzer.getTotalDuration()).toBeGreaterThan(0);
  });
});
