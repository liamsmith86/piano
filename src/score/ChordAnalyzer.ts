// Chord patterns are ordered from richer to simpler structures so a subset
// fallback prefers a seventh over a triad when both fit the sounding notes.
const CHORD_TYPES: ReadonlyArray<readonly [readonly number[], string]> = [
  [[0, 4, 7, 11], 'maj7'],
  [[0, 4, 7, 10], '7'],
  [[0, 3, 7, 10], 'm7'],
  [[0, 3, 6, 10], 'm7♭5'],
  [[0, 3, 6, 9], 'dim7'],
  [[0, 4, 8, 10], 'aug7'],
  [[0, 4, 7, 9], '6'],
  [[0, 3, 7, 9], 'm6'],
  [[0, 4, 7], 'maj'],
  [[0, 3, 7], 'm'],
  [[0, 3, 6], 'dim'],
  [[0, 4, 8], 'aug'],
  [[0, 5, 7], 'sus4'],
  [[0, 2, 7], 'sus2'],
];

const ROOT_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

function pitchClass(midi: number): number {
  return ((midi % 12) + 12) % 12;
}

function formatChord(root: number, type: string): string {
  return ROOT_NAMES[root] + (type === 'maj' ? '' : type);
}

/**
 * Detect a familiar tertian/suspended chord from one score onset.
 *
 * The lowest sounding pitch is tried as the root first. That makes common
 * non-chord melody tones read as, for example, A(add4 without the suffix)
 * rather than the less useful Dsus2 merely because D sorts earlier by pitch
 * class. Exact pitch-class matches still take priority over subset matches.
 */
export function detectChord(midiNotes: number[]): string | null {
  if (midiNotes.length < 3) return null;

  const pitchClasses = [...new Set(midiNotes.map(pitchClass))].sort((a, b) => a - b);
  if (pitchClasses.length < 3) return null;

  const bassRoot = pitchClass(Math.min(...midiNotes));
  const candidateRoots = [bassRoot, ...pitchClasses.filter(root => root !== bassRoot)];

  for (const root of candidateRoots) {
    const intervals = pitchClasses.map(pc => (pc - root + 12) % 12).sort((a, b) => a - b);
    for (const [pattern, type] of CHORD_TYPES) {
      if (pattern.length !== intervals.length) continue;
      if (pattern.every((value, index) => value === intervals[index])) {
        return formatChord(root, type);
      }
    }
  }

  for (const root of candidateRoots) {
    const intervals = pitchClasses.map(pc => (pc - root + 12) % 12).sort((a, b) => a - b);
    for (const [pattern, type] of CHORD_TYPES) {
      if (pattern.length >= intervals.length) continue;
      if (pattern.every(value => intervals.includes(value))) {
        return formatChord(root, type);
      }
    }
  }

  return null;
}
