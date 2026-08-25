import { describe, expect, it } from 'vitest';
import { detectChord } from '../../src/score/ChordAnalyzer';

describe('detectChord', () => {
  it('recognises major triads in root position and inversion', () => {
    expect(detectChord([60, 64, 67])).toBe('C');
    expect(detectChord([64, 67, 72])).toBe('C');
  });

  it('recognises common seventh chords', () => {
    expect(detectChord([55, 59, 62, 65])).toBe('G7');
    expect(detectChord([57, 60, 64, 67])).toBe('Am7');
  });

  it('prefers a bass-root triad when a melody adds a non-chord tone', () => {
    // A-C#-E with a melodic D should be useful as A harmony, not Dsus2.
    expect(detectChord([45, 49, 52, 62])).toBe('A');
  });

  it('does not label dyads as complete chords', () => {
    expect(detectChord([60, 67])).toBeNull();
  });
});
