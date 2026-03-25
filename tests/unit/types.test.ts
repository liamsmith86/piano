import { describe, it, expect } from 'vitest';
import {
  midiToNoteName,
  noteNameToMidi,
  midiToFrequency,
  midiToPitchClass,
  isSameNote,
  isSamePitchClass,
  midiToStaffPosition,
  filenameToTitle,
} from '../../src/types';

describe('midiToNoteName', () => {
  it('converts middle C correctly', () => {
    expect(midiToNoteName(60)).toBe('C4');
  });

  it('converts A4 (concert pitch) correctly', () => {
    expect(midiToNoteName(69)).toBe('A4');
  });

  it('converts sharps correctly', () => {
    expect(midiToNoteName(61)).toBe('C#4');
    expect(midiToNoteName(66)).toBe('F#4');
  });

  it('converts flats when requested', () => {
    expect(midiToNoteName(61, true)).toBe('Db4');
    expect(midiToNoteName(63, true)).toBe('Eb4');
    expect(midiToNoteName(66, true)).toBe('Gb4');
  });

  it('handles extreme low notes', () => {
    expect(midiToNoteName(21)).toBe('A0');  // lowest piano key
    expect(midiToNoteName(0)).toBe('C-1');
  });

  it('handles extreme high notes', () => {
    expect(midiToNoteName(108)).toBe('C8');  // highest piano key
    expect(midiToNoteName(127)).toBe('G9');
  });

  it('handles all 12 pitch classes in octave 4', () => {
    const expected = ['C4', 'C#4', 'D4', 'D#4', 'E4', 'F4', 'F#4', 'G4', 'G#4', 'A4', 'A#4', 'B4'];
    for (let i = 0; i < 12; i++) {
      expect(midiToNoteName(60 + i)).toBe(expected[i]);
    }
  });
});

describe('noteNameToMidi', () => {
  it('converts middle C correctly', () => {
    expect(noteNameToMidi('C4')).toBe(60);
  });

  it('converts A4 correctly', () => {
    expect(noteNameToMidi('A4')).toBe(69);
  });

  it('handles sharps', () => {
    expect(noteNameToMidi('C#4')).toBe(61);
    expect(noteNameToMidi('F#4')).toBe(66);
  });

  it('handles flats', () => {
    expect(noteNameToMidi('Db4')).toBe(61);
    expect(noteNameToMidi('Eb4')).toBe(63);
    expect(noteNameToMidi('Bb3')).toBe(58);
  });

  it('handles double sharps', () => {
    expect(noteNameToMidi('C##4')).toBe(62); // = D4
  });

  it('handles double flats', () => {
    expect(noteNameToMidi('Dbb4')).toBe(60); // = C4
  });

  it('returns -1 for invalid input', () => {
    expect(noteNameToMidi('X4')).toBe(-1);
    expect(noteNameToMidi('')).toBe(-1);
    expect(noteNameToMidi('C')).toBe(-1);
  });

  it('handles negative octaves', () => {
    expect(noteNameToMidi('C-1')).toBe(0);
  });

  it('is inverse of midiToNoteName for natural notes', () => {
    for (let midi = 21; midi <= 108; midi++) {
      const name = midiToNoteName(midi);
      expect(noteNameToMidi(name)).toBe(midi);
    }
  });
});

describe('midiToFrequency', () => {
  it('returns 440 Hz for A4', () => {
    expect(midiToFrequency(69)).toBeCloseTo(440, 2);
  });

  it('returns ~261.63 Hz for middle C', () => {
    expect(midiToFrequency(60)).toBeCloseTo(261.63, 1);
  });

  it('returns ~880 Hz for A5 (octave above A4)', () => {
    expect(midiToFrequency(81)).toBeCloseTo(880, 1);
  });

  it('doubles frequency for each octave', () => {
    const freqA4 = midiToFrequency(69);
    const freqA5 = midiToFrequency(81);
    expect(freqA5 / freqA4).toBeCloseTo(2, 5);
  });
});

describe('midiToPitchClass', () => {
  it('returns 0 for all C notes', () => {
    expect(midiToPitchClass(24)).toBe(0);  // C1
    expect(midiToPitchClass(60)).toBe(0);  // C4
    expect(midiToPitchClass(96)).toBe(0);  // C7
  });

  it('returns 9 for all A notes', () => {
    expect(midiToPitchClass(69)).toBe(9);  // A4
    expect(midiToPitchClass(57)).toBe(9);  // A3
  });
});

describe('isSameNote / isSamePitchClass', () => {
  it('isSameNote returns true for identical MIDI numbers', () => {
    expect(isSameNote(60, 60)).toBe(true);
  });

  it('isSameNote returns false for different MIDI numbers', () => {
    expect(isSameNote(60, 72)).toBe(false);
  });

  it('isSamePitchClass returns true for same note different octaves', () => {
    expect(isSamePitchClass(60, 72)).toBe(true);  // C4 and C5
    expect(isSamePitchClass(69, 57)).toBe(true);  // A4 and A3
  });

  it('isSamePitchClass returns false for different notes', () => {
    expect(isSamePitchClass(60, 62)).toBe(false);  // C4 and D4
  });
});

describe('midiToStaffPosition', () => {
  it('returns 0 for reference note on treble clef (B4 = 71)', () => {
    expect(midiToStaffPosition(71, 1)).toBe(0);
  });

  it('returns 0 for reference note on bass clef (D3 = 50)', () => {
    expect(midiToStaffPosition(50, 2)).toBe(0);
  });

  it('returns positive for notes above reference', () => {
    expect(midiToStaffPosition(72, 1)).toBeGreaterThan(0); // C5 above B4
  });

  it('returns negative for notes below reference', () => {
    expect(midiToStaffPosition(69, 1)).toBeLessThan(0); // A4 below B4
  });

  it('returns 7 for one octave above', () => {
    expect(midiToStaffPosition(83, 1)).toBe(7); // B5, one octave above B4
  });
});

describe('filenameToTitle', () => {
  it('removes file extension', () => {
    expect(filenameToTitle('bella-ciao.mxl')).toBe('Bella Ciao');
  });

  it('replaces hyphens with spaces and capitalizes', () => {
    expect(filenameToTitle('heat-waves-easy-piano.mxl')).toBe('Heat Waves Easy Piano');
  });

  it('replaces underscores with spaces', () => {
    expect(filenameToTitle('my_song_file.musicxml')).toBe('My Song File');
  });

  it('handles .xml extension', () => {
    expect(filenameToTitle('test.xml')).toBe('Test');
  });

  it('handles already clean names', () => {
    expect(filenameToTitle('Song.mxl')).toBe('Song');
  });
});
