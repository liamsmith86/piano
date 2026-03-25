import type { NoteEvent, NoteInfo } from '../types';

export type FingerNumber = 1 | 2 | 3 | 4 | 5;

/**
 * Comfortable semitone spans between finger pairs (right hand, ascending).
 * [fromFinger][toFinger] = { min, max } comfortable interval.
 * Left hand uses the mirror: swap finger indices (1↔5, 2↔4).
 */
const COMFORT_SPAN: Record<number, Record<number, { min: number; max: number }>> = {
  1: { 1: { min: 0, max: 0 }, 2: { min: 1, max: 4 }, 3: { min: 2, max: 6 }, 4: { min: 3, max: 8 }, 5: { min: 5, max: 10 } },
  2: { 1: { min: 1, max: 4 }, 2: { min: 0, max: 0 }, 3: { min: 1, max: 3 }, 4: { min: 2, max: 5 }, 5: { min: 3, max: 7 } },
  3: { 1: { min: 2, max: 6 }, 2: { min: 1, max: 3 }, 3: { min: 0, max: 0 }, 4: { min: 1, max: 3 }, 5: { min: 2, max: 5 } },
  4: { 1: { min: 3, max: 8 }, 2: { min: 2, max: 5 }, 3: { min: 1, max: 3 }, 4: { min: 0, max: 0 }, 5: { min: 1, max: 3 } },
  5: { 1: { min: 5, max: 10 }, 2: { min: 3, max: 7 }, 3: { min: 2, max: 5 }, 4: { min: 1, max: 3 }, 5: { min: 0, max: 0 } },
};

export class FingeringComputer {
  private maxSpan = 18; // semitones (intermediate default)

  setMaxSpan(semitones: number): void {
    this.maxSpan = semitones;
  }

  /**
   * Compute optimal fingering for a single-hand note sequence.
   * Writes `finger` property directly onto each NoteInfo.
   */
  compute(events: NoteEvent[], hand: 'left' | 'right'): void {
    if (events.length === 0) return;

    // Flatten to sequential positions, handling chords
    const positions: { notes: NoteInfo[]; midis: number[] }[] = [];
    for (const event of events) {
      const notes = event.notes.filter(n => !n.tied);
      if (notes.length === 0) continue;
      const midis = notes.map(n => n.midi).sort((a, b) =>
        hand === 'right' ? a - b : b - a
      );
      positions.push({ notes, midis });
    }

    if (positions.length === 0) return;

    // Assign chords greedily, single notes via DP
    for (let i = 0; i < positions.length; i++) {
      const pos = positions[i];
      if (pos.notes.length > 1) {
        this.assignChord(pos.notes, hand);
      }
    }

    // DP for single-note transitions
    this.dpAssign(positions, hand);
  }

  private assignChord(notes: NoteInfo[], hand: 'left' | 'right'): void {
    // Sort by pitch: ascending for right, descending for left
    const sorted = [...notes].sort((a, b) =>
      hand === 'right' ? a.midi - b.midi : b.midi - a.midi
    );

    const count = Math.min(sorted.length, 5);

    if (count === 1) {
      sorted[0].finger = 3; // default single note in chord context
      return;
    }

    if (count === 2) {
      sorted[0].finger = 1;
      sorted[1].finger = 5;
      return;
    }

    if (count === 3) {
      sorted[0].finger = 1;
      sorted[1].finger = 3;
      sorted[2].finger = 5;
      return;
    }

    if (count === 4) {
      sorted[0].finger = 1;
      sorted[1].finger = 2;
      sorted[2].finger = 3;
      sorted[3].finger = 5;
      return;
    }

    // 5 notes
    for (let i = 0; i < count; i++) {
      sorted[i].finger = (i + 1) as FingerNumber;
    }
  }

  private dpAssign(
    positions: { notes: NoteInfo[]; midis: number[] }[],
    hand: 'left' | 'right',
  ): void {
    // For DP, we track the "representative" MIDI of each position
    // For single notes that's the only note; for chords, use the outermost (thumb-side)
    const repMidis: number[] = positions.map(p => p.midis[0]);
    const n = positions.length;

    // dp[f] = min cost to reach current position with finger f
    const INF = 1e9;
    let dp = new Float64Array(5).fill(INF);
    let parent = new Int8Array(5).fill(-1);
    const allParents: Int8Array[] = [];

    // Initialize first position
    if (positions[0].notes.length > 1) {
      // Chord already assigned — only one valid finger state (the thumb/outermost)
      const f = (positions[0].notes.find(
        n => n.midi === repMidis[0]
      )?.finger ?? 1) as number;
      dp[f - 1] = 0;
    } else {
      // Single note — try all fingers
      for (let f = 0; f < 5; f++) {
        dp[f] = this.startCost(f + 1);
      }
    }
    allParents.push(new Int8Array(parent));

    // Fill DP
    for (let i = 1; i < n; i++) {
      const newDp = new Float64Array(5).fill(INF);
      const newParent = new Int8Array(5).fill(-1);

      const interval = repMidis[i] - repMidis[i - 1];
      const isChord = positions[i].notes.length > 1;

      if (isChord) {
        // Chord already has fingers assigned — find which finger is on the rep note
        const chordFinger = (positions[i].notes.find(
          n => n.midi === repMidis[i]
        )?.finger ?? 1) as number;
        const cf = chordFinger - 1;

        for (let pf = 0; pf < 5; pf++) {
          if (dp[pf] >= INF) continue;
          const cost = dp[pf] + this.transitionCost(pf + 1, chordFinger, interval, hand);
          if (cost < newDp[cf]) {
            newDp[cf] = cost;
            newParent[cf] = pf;
          }
        }
      } else {
        // Single note — try all 5 fingers
        for (let cf = 0; cf < 5; cf++) {
          for (let pf = 0; pf < 5; pf++) {
            if (dp[pf] >= INF) continue;
            const cost = dp[pf] + this.transitionCost(pf + 1, cf + 1, interval, hand);
            if (cost < newDp[cf]) {
              newDp[cf] = cost;
              newParent[cf] = pf;
            }
          }
        }
      }

      dp = newDp;
      parent = newParent;
      allParents.push(new Int8Array(parent));
    }

    // Backtrack to find optimal finger sequence
    let bestFinger = 0;
    let bestCost = INF;
    for (let f = 0; f < 5; f++) {
      if (dp[f] < bestCost) {
        bestCost = dp[f];
        bestFinger = f;
      }
    }

    // Assign fingers via backtracking
    const fingers: number[] = new Array(n);
    fingers[n - 1] = bestFinger;
    for (let i = n - 1; i > 0; i--) {
      fingers[i - 1] = allParents[i][fingers[i]];
    }

    // Write finger assignments for single notes (chords already assigned)
    for (let i = 0; i < n; i++) {
      if (positions[i].notes.length === 1) {
        positions[i].notes[0].finger = (fingers[i] + 1) as FingerNumber;
      }
    }
  }

  private startCost(finger: number): number {
    // Prefer starting with thumb(1), index(2), or middle(3)
    if (finger === 1 || finger === 2 || finger === 3) return 0;
    if (finger === 4) return 1;
    return 2; // finger 5
  }

  private transitionCost(
    prevFinger: number,
    currFinger: number,
    interval: number, // positive = ascending, negative = descending
    hand: 'left' | 'right',
  ): number {
    // For left hand, mirror the interval direction relative to fingers
    // Left hand thumb (1) is on the higher-pitch side
    const effectiveInterval = hand === 'right' ? interval : -interval;
    const absInterval = Math.abs(interval);

    // Same finger on different note: heavy penalty
    if (prevFinger === currFinger && absInterval > 0) {
      return 20;
    }

    // Same position, same finger: fine
    if (absInterval === 0) {
      return prevFinger === currFinger ? 0 : 3;
    }

    // Get comfort range
    const comfort = COMFORT_SPAN[prevFinger]?.[currFinger];
    if (!comfort) return 10;

    let cost = 0;

    // Stretch penalty: how far outside comfort zone
    if (absInterval > comfort.max) {
      cost += (absInterval - comfort.max) * 2;
    } else if (absInterval < comfort.min && absInterval > 0) {
      cost += (comfort.min - absInterval) * 1.5;
    }

    // Direction penalty: ascending pitch should use ascending fingers (right hand)
    // effectiveInterval > 0 means "ascending in finger-number space"
    const fingerDelta = currFinger - prevFinger;
    if (effectiveInterval > 0 && fingerDelta < 0 && !(prevFinger > 1 && currFinger === 1)) {
      // Going up in pitch but down in fingers (not a thumb-under) — penalize
      cost += 4;
    }
    if (effectiveInterval < 0 && fingerDelta > 0 && !(prevFinger === 1 && currFinger > 1)) {
      // Going down in pitch but up in fingers (not a finger-over-thumb) — penalize
      cost += 4;
    }

    // Thumb-under/over patterns: reward standard crossings
    if (effectiveInterval > 0 && prevFinger > 1 && currFinger === 1) {
      // Thumb under — common and good for ascending right hand
      cost += absInterval > this.maxSpan ? 8 : 1;
    }
    if (effectiveInterval < 0 && prevFinger === 1 && currFinger > 1) {
      // Finger over thumb — common for descending right hand
      cost += absInterval > this.maxSpan ? 8 : 1;
    }

    // Weak finger penalty for wide intervals
    if (absInterval > 5 && (currFinger === 4 || currFinger === 5)) {
      cost += 2;
    }

    // Beyond max hand span
    if (absInterval > this.maxSpan) {
      cost += (absInterval - this.maxSpan) * 3;
    }

    return cost;
  }
}
