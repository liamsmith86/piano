import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';

export type PracticeHand = 1 | 2;
export type PracticeStaffMap = ReadonlyMap<object, PracticeHand>;

interface OsmdStaff {
  idInMusicSheet?: number;
}

interface OsmdInstrument {
  Name?: string;
  Staves?: OsmdStaff[];
}

interface OsmdSheetInternals {
  Instruments?: OsmdInstrument[];
}

interface OsmdInternals {
  sheet?: OsmdSheetInternals;
}

interface SourceNoteLike {
  ParentStaffEntry?: {
    ParentStaff?: OsmdStaff;
  };
}

const PIANO_NAME_PATTERN = /piano|pianoforte|klavier|keyboard|\bpno\b/i;
const sourceNoteIds = new WeakMap<object, number>();
let nextSourceNoteId = 1;

export function getSourceNoteId(sourceNote: object): number {
  let id = sourceNoteIds.get(sourceNote);
  if (id === undefined) {
    id = nextSourceNoteId++;
    sourceNoteIds.set(sourceNote, id);
  }
  return id;
}

/**
 * Select the score part that should drive piano playback and practice.
 *
 * Vocal MusicXML commonly contains a vocal staff before a two-staff piano
 * accompaniment. Global staff indexes therefore cannot be treated as hand
 * indexes. Prefer an explicitly named piano/keyboard part, then a grand-staff
 * instrument, and finally the first available instrument for single-staff
 * scores.
 */
export function buildPracticeStaffMap(
  osmd: OpenSheetMusicDisplay,
): PracticeStaffMap {
  // OSMD intentionally keeps `sheet` protected even though consumers need its
  // parsed score model for analysis. Keep the unsupported access isolated here.
  const sheet = (osmd as unknown as OsmdInternals).sheet;
  const instruments = sheet?.Instruments?.filter(instrument =>
    Array.isArray(instrument.Staves) && instrument.Staves.length > 0
  ) ?? [];

  const target = instruments.find(instrument => PIANO_NAME_PATTERN.test(instrument.Name ?? ''))
    ?? instruments.find(instrument => (instrument.Staves?.length ?? 0) >= 2)
    ?? instruments[0];

  const staffHands = new Map<object, PracticeHand>();
  target?.Staves?.forEach((staff, index) => {
    staffHands.set(staff, index === 0 ? 1 : 2);
  });
  return staffHands;
}

/** Return the selected piano hand for a source note, or null for another part. */
export function getPracticeHand(
  sourceNote: SourceNoteLike,
  staffHands: PracticeStaffMap,
): PracticeHand | null {
  const staff = sourceNote.ParentStaffEntry?.ParentStaff;
  if (!staff) return null;

  const mappedHand = staffHands.get(staff);
  if (mappedHand) return mappedHand;

  if (staffHands.size > 0) {
    // A target part was identified, so notes from every other part are ignored.
    return null;
  }

  // Structural test doubles and a few unusual OSMD documents do not expose the
  // instrument list. Retain the conventional two-staff fallback for them.
  return (staff.idInMusicSheet ?? 0) === 0 ? 1 : 2;
}
