import type { OpenSheetMusicDisplay } from 'opensheetmusicdisplay';
import type { NoteEvent, NoteInfo } from '../types';
import { midiToNoteName } from '../types';

export class ScoreAnalyzer {
  private timeline: NoteEvent[] = [];
  private tempoMap: { timestamp: number; bpm: number }[] = [];
  private defaultTempo = 120;

  analyze(osmd: OpenSheetMusicDisplay): NoteEvent[] {
    this.timeline = [];
    this.tempoMap = [];
    this.extractTempo(osmd);

    const cursor = osmd.cursors[0];
    if (!cursor) return [];

    cursor.reset();
    let cursorStep = 0; // counts ALL cursor positions (including rests)

    // Track cumulative time to handle repeats (where beat position jumps backwards)
    let prevRawBeats = 0;
    let cumulativeBeatsOffset = 0;

    while (!cursor.Iterator.EndReached) {
      const notes: NoteInfo[] = [];
      const iterator = cursor.Iterator;
      const rawBeats = iterator.currentTimeStamp.RealValue * 4;
      const measureNumber = iterator.CurrentMeasureIndex + 1;

      // Detect repeat jump: if raw beats go backwards, bridge the gap
      // by adding only the difference (not the full absolute position)
      if (rawBeats < prevRawBeats - 0.01) {
        cumulativeBeatsOffset += (prevRawBeats - rawBeats);
      }
      prevRawBeats = rawBeats;

      const timestampBeats = rawBeats + cumulativeBeatsOffset;
      const timestamp = this.beatsToSeconds(timestampBeats);

      // Get current voice entries at this cursor position
      const entries = iterator.CurrentVoiceEntries;
      if (entries) {
        for (const voiceEntry of entries) {
          for (const note of voiceEntry.Notes) {
            if (note.isRest()) continue;

            const halfTone = note.halfTone;
            // OSMD halfTone is semitones from C0, add 12 to get MIDI
            const midiNumber = halfTone + 12;

            const staffEntry = note.ParentStaffEntry;
            const staffId = staffEntry?.ParentStaff?.idInMusicSheet ?? 0;
            const staff = (staffId === 0 ? 1 : 2) as 1 | 2;

            const durationBeats = note.Length.RealValue * 4;
            const duration = this.durationAtBeat(durationBeats, timestampBeats);

            const noteInfo: NoteInfo = {
              midi: midiNumber,
              name: midiToNoteName(midiNumber),
              duration,
              durationBeats,
              velocity: 0.8,
              staff,
              voice: voiceEntry.ParentVoice?.VoiceId ?? 1,
              tied: note.NoteTie !== undefined && note.NoteTie !== null &&
                    note.NoteTie.StartNote !== note,
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
          timestamp,
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

    // Build tempo map from all measures (only when BPM actually changes)
    let currentBeat = 0;
    for (const sourceMeasure of sheet.SourceMeasures) {
      if (sourceMeasure.TempoInBPM > 0 &&
          (this.tempoMap.length === 0 || this.tempoMap[this.tempoMap.length - 1].bpm !== sourceMeasure.TempoInBPM)) {
        this.tempoMap.push({
          timestamp: currentBeat,
          bpm: sourceMeasure.TempoInBPM,
        });
      }
      currentBeat += sourceMeasure.Duration.RealValue * 4;
    }

    if (this.tempoMap.length === 0) {
      this.tempoMap.push({ timestamp: 0, bpm: this.defaultTempo });
    }
  }

  private beatsToSeconds(beats: number): number {
    // Simple conversion using the primary tempo
    // For multi-tempo pieces, this would need to integrate the tempo map
    let seconds = 0;
    let remainingBeats = beats;
    let currentBpm = this.tempoMap[0]?.bpm ?? this.defaultTempo;
    let lastBeatMark = 0;

    for (let i = 1; i < this.tempoMap.length; i++) {
      const nextChange = this.tempoMap[i].timestamp;
      if (nextChange >= beats) break;

      const segmentBeats = nextChange - lastBeatMark;
      if (segmentBeats > 0) {
        seconds += (segmentBeats / currentBpm) * 60;
        remainingBeats -= segmentBeats;
      }
      currentBpm = this.tempoMap[i].bpm;
      lastBeatMark = nextChange;
    }

    seconds += (remainingBeats / currentBpm) * 60;
    return seconds;
  }

  /** Convert a duration in beats to seconds using the tempo active at a specific beat position */
  private durationAtBeat(durationBeats: number, atBeat: number): number {
    let currentBpm = this.tempoMap[0]?.bpm ?? this.defaultTempo;
    for (const entry of this.tempoMap) {
      if (entry.timestamp > atBeat) break;
      currentBpm = entry.bpm;
    }
    return (durationBeats / currentBpm) * 60;
  }

  getTimeline(): NoteEvent[] {
    return this.timeline;
  }

  getDefaultTempo(): number {
    return this.defaultTempo;
  }

  getTempoMap(): { timestamp: number; bpm: number }[] {
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
    return this.timeline[index] ?? null;
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
