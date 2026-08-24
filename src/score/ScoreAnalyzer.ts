import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { NoteEvent, NoteInfo, TempoChange } from '../types';
import { midiToNoteName } from '../types';
import { buildPracticeStaffMap, getPracticeHand, getSourceNoteId } from './PracticePart';

const DEFAULT_TEMPO = 120;

export class ScoreAnalyzer {
  private timeline: NoteEvent[] = [];
  private tempoMap: TempoChange[] = [];
  private sourceTempoMap: TempoChange[] = [];
  private defaultTempo = DEFAULT_TEMPO;

  analyze(osmd: OpenSheetMusicDisplay): NoteEvent[] {
    this.timeline = [];
    this.tempoMap = [];
    this.sourceTempoMap = [];
    this.defaultTempo = DEFAULT_TEMPO;
    this.extractTempo(osmd);

    const cursor = osmd.cursors[0];
    if (!cursor) return [];

    const practiceStaffHands = buildPracticeStaffMap(osmd);

    cursor.reset();
    let cursorStep = 0; // counts ALL cursor positions (including rests)
    let previousSourceBeats = 0;
    let previousEnrolledBeats = 0;
    let fallbackRepeatOffset = 0;
    let elapsedSeconds = 0;
    let activeBpm = this.validTempo(cursor.Iterator.CurrentBpm)
      ?? this.tempoAtSourceBeat(0);

    this.defaultTempo = activeBpm;
    this.tempoMap.push({ timestampBeats: 0, bpm: activeBpm });

    while (!cursor.Iterator.EndReached) {
      const notes: NoteInfo[] = [];
      const iterator = cursor.Iterator;
      const sourceBeats = iterator.currentTimeStamp.RealValue * 4;
      const measureNumber = iterator.CurrentMeasureIndex + 1;

      // CurrentEnrolledTimestamp is OSMD's unfolded playback position and
      // already accounts for repeats. The fallback supports lightweight test
      // doubles and older OSMD structures that only expose source timestamps.
      if (sourceBeats < previousSourceBeats - 0.01) {
        fallbackRepeatOffset += previousSourceBeats - sourceBeats;
      }
      const enrolledTimestamp = iterator.CurrentEnrolledTimestamp?.RealValue;
      const timestampBeats = Number.isFinite(enrolledTimestamp)
        ? enrolledTimestamp * 4
        : sourceBeats + fallbackRepeatOffset;

      const beatDelta = Math.max(0, timestampBeats - previousEnrolledBeats);
      elapsedSeconds += (beatDelta / activeBpm) * 60;

      const eventBpm = this.validTempo(iterator.CurrentBpm)
        ?? this.tempoAtSourceBeat(sourceBeats);
      if (eventBpm !== activeBpm) {
        activeBpm = eventBpm;
        this.tempoMap.push({ timestampBeats, bpm: activeBpm });
      }

      previousSourceBeats = sourceBeats;
      previousEnrolledBeats = timestampBeats;

      // Get current voice entries at this cursor position
      const entries = iterator.CurrentVoiceEntries;
      if (entries) {
        for (const voiceEntry of entries) {
          for (const note of voiceEntry.Notes) {
            if (note.isRest()) continue;

            const staff = getPracticeHand(note, practiceStaffHands);
            if (!staff) continue;

            const halfTone = note.halfTone;
            // OSMD halfTone is semitones from C0, add 12 to get MIDI
            const midiNumber = halfTone + 12;

            const isTiedContinuation = note.NoteTie !== undefined && note.NoteTie !== null
              && note.NoteTie.StartNote !== note;
            const durationBeats = note.NoteTie && !isTiedContinuation
              ? note.NoteTie.Duration.RealValue * 4
              : note.Length.RealValue * 4;

            const noteInfo: NoteInfo = {
              midi: midiNumber,
              name: midiToNoteName(midiNumber),
              // Filled from the complete unfolded tempo map after iteration.
              duration: 0,
              durationBeats,
              velocity: 0.8,
              staff,
              voice: voiceEntry.ParentVoice?.VoiceId ?? 1,
              tied: isTiedContinuation,
              sourceNoteId: getSourceNoteId(note),
            };

            // Skip notes that are tied continuations (not the start of the tie)
            if (!noteInfo.tied) {
              notes.push(noteInfo);
            }
          }
        }
      }

      if (notes.length > 0) {
        this.timeline.push({
          index: cursorStep, // use absolute cursor position for cursor sync
          timestamp: elapsedSeconds,
          timestampBeats,
          notes,
          measureNumber,
        });
      }
      cursorStep++;

      cursor.next();
    }

    // Reset cursor after analysis
    cursor.reset();

    // Tempo changes later in the piece are only known after cursor traversal.
    // Compute durations now so notes spanning a tempo change remain accurate.
    for (const event of this.timeline) {
      for (const note of event.notes) {
        note.duration = this.secondsBetweenBeats(
          event.timestampBeats,
          event.timestampBeats + note.durationBeats,
        );
      }
    }
    return this.timeline;
  }

  private extractTempo(osmd: OpenSheetMusicDisplay): void {
    // Access sheet via any cast since OSMD marks it protected
    const sheet = (osmd as any).sheet;
    if (!sheet) return;

    // Get tempo from first measure
    if (sheet.HasBPMInfo) {
      for (const sourceMeasure of sheet.SourceMeasures) {
        if (sourceMeasure.TempoInBPM > 0) {
          this.defaultTempo = sourceMeasure.TempoInBPM;
          break;
        }
      }
    }

    // Build a source-score tempo map as a fallback for test doubles and OSMD
    // documents whose iterator does not expose CurrentBpm.
    let currentBeat = 0;
    for (const sourceMeasure of sheet.SourceMeasures) {
      if (sourceMeasure.TempoInBPM > 0 &&
          (this.sourceTempoMap.length === 0 || this.sourceTempoMap[this.sourceTempoMap.length - 1].bpm !== sourceMeasure.TempoInBPM)) {
        this.sourceTempoMap.push({
          timestampBeats: currentBeat,
          bpm: sourceMeasure.TempoInBPM,
        });
      }
      currentBeat += sourceMeasure.Duration.RealValue * 4;
    }

    if (this.sourceTempoMap.length === 0) {
      this.sourceTempoMap.push({ timestampBeats: 0, bpm: this.defaultTempo });
    }
  }

  private secondsBetweenBeats(startBeat: number, endBeat: number): number {
    if (endBeat <= startBeat) return 0;

    let seconds = 0;
    let position = startBeat;
    let currentBpm = this.tempoAtBeat(startBeat, this.tempoMap);

    for (const change of this.tempoMap) {
      if (change.timestampBeats <= startBeat) continue;
      if (change.timestampBeats >= endBeat) break;
      seconds += ((change.timestampBeats - position) / currentBpm) * 60;
      position = change.timestampBeats;
      currentBpm = change.bpm;
    }

    seconds += ((endBeat - position) / currentBpm) * 60;
    return seconds;
  }

  private tempoAtBeat(beat: number, tempoMap: TempoChange[]): number {
    let bpm = tempoMap[0]?.bpm ?? this.defaultTempo;
    for (const entry of tempoMap) {
      if (entry.timestampBeats > beat) break;
      bpm = entry.bpm;
    }
    return bpm;
  }

  private tempoAtSourceBeat(beat: number): number {
    return this.tempoAtBeat(beat, this.sourceTempoMap);
  }

  private validTempo(value: number | undefined): number | null {
    return typeof value === 'number' && Number.isFinite(value) && value > 0
      ? value
      : null;
  }

  getTimeline(): NoteEvent[] {
    return this.timeline;
  }

  getDefaultTempo(): number {
    return this.defaultTempo;
  }

  getTempoMap(): TempoChange[] {
    return [...this.tempoMap];
  }

  getTotalDuration(): number {
    if (this.timeline.length === 0) return 0;
    const lastEvent = this.timeline[this.timeline.length - 1];
    if (lastEvent.notes.length === 0) return lastEvent.timestamp;
    const maxNoteDuration = Math.max(...lastEvent.notes.map(n => n.duration));
    return lastEvent.timestamp + maxNoteDuration;
  }

  getEventAtIndex(index: number): NoteEvent | null {
    return this.timeline.find(event => event.index === index) ?? null;
  }

  filterByHand(hand: 'both' | 'left' | 'right'): NoteEvent[] {
    if (hand === 'both') return this.timeline;

    const staffFilter = hand === 'right' ? 1 : 2;
    return this.timeline
      .map(event => ({
        ...event,
        // Preserve original index for cursor sync
        notes: event.notes.filter(n => n.staff === staffFilter),
      }))
      .filter(event => event.notes.length > 0);
  }
}
