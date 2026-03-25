export interface NoteInfo {
  midi: number;
  name: string;       // e.g. "C4", "F#5"
  duration: number;   // in seconds
  durationBeats: number;
  velocity: number;
  staff: 1 | 2;      // 1 = treble (right hand), 2 = bass (left hand)
  voice: number;
  tied: boolean;
}

export interface NoteEvent {
  index: number;
  timestamp: number;     // in seconds from start
  timestampBeats: number;
  notes: NoteInfo[];
  measureNumber: number;
}

export type HandSelection = 'both' | 'left' | 'right';
export type AppMode = 'play' | 'practice';
export type PlaybackState = 'playing' | 'paused' | 'stopped';

export interface SongInfo {
  id: string;
  title: string;
  url: string;
  source: 'preloaded' | 'uploaded';
}

export interface MeasureStats {
  measure: number;
  correct: number;
  wrong: number;
}

export interface PracticeState {
  cursorIndex: number;
  expectedNotes: number[];  // MIDI numbers
  hitNotes: number[];
  wrongNotes: number[];
  totalNotes: number;
  correctCount: number;
  wrongCount: number;
  startTime: number | null;
  streak: number;
  bestStreak: number;
  measureStats: MeasureStats[];
}

export interface InputEvent {
  type: 'noteOn' | 'noteOff';
  midiNumber: number;
  velocity: number;
  source: 'midi' | 'virtual' | 'keyboard' | 'programmatic';
}

export interface AppEventMap {
  loaded: { songId: string };
  noteCorrect: { midiNumber: number; cursorIndex: number };
  noteWrong: { midiNumber: number; expected: number[]; cursorIndex: number };
  cursorAdvanced: { from: number; to: number };
  songEnd: { stats: PracticeState };
  modeChanged: { mode: AppMode };
  handChanged: { hand: HandSelection };
  playbackStateChanged: { state: PlaybackState };
  inputNote: InputEvent;
}

export type AppEventName = keyof AppEventMap;

export const PRELOADED_SONGS: SongInfo[] = [
  { id: 'mozart-piano-sonata', title: 'Mozart - Piano Sonata', url: '/songs/MozartPianoSonata.mxl', source: 'preloaded' },
  { id: 'mozart-trio', title: 'Mozart - Trio', url: '/songs/MozartTrio.mxl', source: 'preloaded' },
  { id: 'mozart-veil', title: 'Mozart - The Veil', url: '/songs/MozaVeilSample.mxl', source: 'preloaded' },
  { id: 'beethoven-an-die-geliebte', title: 'Beethoven - An die Geliebte', url: '/songs/BeetAnGeSample.mxl', source: 'preloaded' },
  { id: 'brahms-wie-melodien', title: 'Brahms - Wie Melodien', url: '/songs/BrahWiMeSample.mxl', source: 'preloaded' },
  { id: 'schubert-ave-maria', title: 'Schubert - Ave Maria', url: '/songs/SchbAvMaSample.mxl', source: 'preloaded' },
  { id: 'debussy-mandoline', title: 'Debussy - Mandoline', url: '/songs/DebuMandSample.mxl', source: 'preloaded' },
  { id: 'faure-apres-un-reve', title: 'Fauré - Après un rêve', url: '/songs/FaurReveSample.mxl', source: 'preloaded' },
  { id: 'schumann-dichterliebe', title: 'Schumann - Dichterliebe No. 1', url: '/songs/Dichterliebe01.mxl', source: 'preloaded' },
  { id: 'mahler-fahrenden-gesellen', title: 'Mahler - Fahrenden Gesellen', url: '/songs/MahlFaGe4Sample.mxl', source: 'preloaded' },
  { id: 'actor-prelude', title: 'Actor Prelude', url: '/songs/ActorPreludeSample.mxl', source: 'preloaded' },
  { id: 'brooke-west', title: 'Brooke West', url: '/songs/BrookeWestSample.mxl', source: 'preloaded' },
  { id: 'telemann', title: 'Telemann', url: '/songs/Telemann.mxl', source: 'preloaded' },
  { id: 'saltarello', title: 'Saltarello', url: '/songs/Saltarello.mxl', source: 'preloaded' },
  { id: 'binchois', title: 'Binchois', url: '/songs/Binchois.mxl', source: 'preloaded' },
  { id: 'echigo-jishi', title: 'Echigo-Jishi', url: '/songs/Echigo-Jishi.mxl', source: 'preloaded' },
  { id: 'chant', title: 'Chant', url: '/songs/Chant.mxl', source: 'preloaded' },
];

// MIDI note number ↔ note name conversion
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

export function midiToNoteName(midi: number, useFlats = false): string {
  const octave = Math.floor(midi / 12) - 1;
  const noteIndex = midi % 12;
  const names = useFlats ? FLAT_NAMES : NOTE_NAMES;
  return `${names[noteIndex]}${octave}`;
}

export function noteNameToMidi(name: string): number {
  const match = name.match(/^([A-Ga-g])(#{0,2}|b{0,2})(-?\d+)$/);
  if (!match) return -1;
  const [, letter, accidental, octaveStr] = match;
  const baseNote = 'CDEFGAB'.indexOf(letter.toUpperCase());
  const semitones = [0, 2, 4, 5, 7, 9, 11][baseNote];
  let modifier = 0;
  for (const ch of accidental) {
    modifier += ch === '#' ? 1 : -1;
  }
  const octave = parseInt(octaveStr);
  return (octave + 1) * 12 + semitones + modifier;
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export function midiToPitchClass(midi: number): number {
  return midi % 12;
}

export function isSameNote(a: number, b: number): boolean {
  return a === b;
}

export function isSamePitchClass(a: number, b: number): boolean {
  return (a % 12) === (b % 12);
}

// Staff line position for rendering wrong note markers
// Returns a value relative to staff center (0 = middle line B4 for treble, D3 for bass)
export function midiToStaffPosition(midi: number, staff: 1 | 2): number {
  // Treble clef: middle line = B4 (MIDI 71)
  // Bass clef: middle line = D3 (MIDI 50)
  const referenceNote = staff === 1 ? 71 : 50;
  // Each staff position = one diatonic step
  // Map chromatic to diatonic
  const chromaticToDiatonic = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];

  const refOctave = Math.floor(referenceNote / 12);
  const refPitch = chromaticToDiatonic[referenceNote % 12];
  const noteOctave = Math.floor(midi / 12);
  const notePitch = chromaticToDiatonic[midi % 12];

  return (noteOctave - refOctave) * 7 + (notePitch - refPitch);
}

// Human-readable title from filename
export function filenameToTitle(filename: string): string {
  return filename
    .replace(/\.(mxl|musicxml|xml)$/i, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();
}
