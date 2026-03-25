import type { NoteEvent, NoteInfo } from '../types';

export type FingerNumber = 1 | 2 | 3 | 4 | 5;

/**
 * Comfortable semitone spans between finger pairs.
 * [lowerFinger][higherFinger] = { min, max } comfortable interval in semitones.
 * These are symmetric (physical stretch is the same in either direction).
 */
const COMFORT: Record<number, Record<number, { min: number; max: number }>> = {
  1: { 2: { min: 1, max: 5 },  3: { min: 3, max: 7 },  4: { min: 4, max: 9 },  5: { min: 5, max: 11 } },
  2: { 3: { min: 1, max: 3 },  4: { min: 2, max: 5 },  5: { min: 3, max: 7 } },
  3: { 4: { min: 1, max: 3 },  5: { min: 2, max: 5 } },
  4: { 5: { min: 1, max: 3 } },
};

/** Get comfort span for any finger pair (order-independent). */
function getComfort(f1: number, f2: number): { min: number; max: number } | null {
  const lo = Math.min(f1, f2);
  const hi = Math.max(f1, f2);
  if (lo === hi) return { min: 0, max: 0 };
  return COMFORT[lo]?.[hi] ?? null;
}

/**
 * DP-based piano fingering algorithm inspired by Parncutt (1997).
 *
 * Cost function considers:
 * 1. Stretch — penalty for intervals outside the comfortable span
 * 2. Finger order — ascending pitch should use ascending finger numbers
 * 3. Thumb crossing — specific costs for thumb-under and finger-over
 * 4. Sequential preference — prefer adjacent fingers (1→2, 2→3) for stepwise motion
 * 5. Weak finger — small penalty for ring/pinky on wide intervals
 * 6. Position change — penalize unnecessary hand shifts
 * 7. Same finger — heavy penalty for reusing the same finger on different notes
 */
export class FingeringComputer {
  private maxSpan = 18;

  setMaxSpan(semitones: number): void {
    this.maxSpan = semitones;
  }

  compute(events: NoteEvent[], hand: 'left' | 'right'): void {
    if (events.length === 0) return;

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

    for (const pos of positions) {
      if (pos.notes.length > 1) {
        this.assignChord(pos.notes, hand);
      }
    }

    this.dpAssign(positions, hand);
  }

  private assignChord(notes: NoteInfo[], hand: 'left' | 'right'): void {
    const sorted = [...notes].sort((a, b) =>
      hand === 'right' ? a.midi - b.midi : b.midi - a.midi
    );
    const count = Math.min(sorted.length, 5);

    if (count === 1) { sorted[0].finger = 3; return; }
    if (count === 2) { sorted[0].finger = 1; sorted[1].finger = 5; return; }
    if (count === 3) { sorted[0].finger = 1; sorted[1].finger = 3; sorted[2].finger = 5; return; }
    if (count === 4) { sorted[0].finger = 1; sorted[1].finger = 2; sorted[2].finger = 3; sorted[3].finger = 5; return; }
    for (let i = 0; i < count; i++) sorted[i].finger = (i + 1) as FingerNumber;
  }

  private dpAssign(
    positions: { notes: NoteInfo[]; midis: number[] }[],
    hand: 'left' | 'right',
  ): void {
    const repMidis: number[] = positions.map(p => p.midis[0]);
    const n = positions.length;
    const INF = 1e9;

    let dp = new Float64Array(5).fill(INF);
    let parent = new Int8Array(5).fill(-1);
    const allParents: Int8Array[] = [];

    if (positions[0].notes.length > 1) {
      const f = (positions[0].notes.find(n => n.midi === repMidis[0])?.finger ?? 1) as number;
      dp[f - 1] = 0;
    } else {
      for (let f = 0; f < 5; f++) dp[f] = 0;
    }
    allParents.push(new Int8Array(parent));

    for (let i = 1; i < n; i++) {
      const newDp = new Float64Array(5).fill(INF);
      const newParent = new Int8Array(5).fill(-1);
      const interval = repMidis[i] - repMidis[i - 1];
      const isChord = positions[i].notes.length > 1;

      if (isChord) {
        const chordFinger = (positions[i].notes.find(n => n.midi === repMidis[i])?.finger ?? 1) as number;
        const cf = chordFinger - 1;
        for (let pf = 0; pf < 5; pf++) {
          if (dp[pf] >= INF) continue;
          const cost = dp[pf] + this.transitionCost(pf + 1, chordFinger, interval, hand);
          if (cost < newDp[cf]) { newDp[cf] = cost; newParent[cf] = pf; }
        }
      } else {
        for (let cf = 0; cf < 5; cf++) {
          for (let pf = 0; pf < 5; pf++) {
            if (dp[pf] >= INF) continue;
            const cost = dp[pf] + this.transitionCost(pf + 1, cf + 1, interval, hand);
            if (cost < newDp[cf]) { newDp[cf] = cost; newParent[cf] = pf; }
          }
        }
      }

      dp = newDp;
      parent = newParent;
      allParents.push(new Int8Array(parent));
    }

    let bestFinger = 0;
    let bestCost = INF;
    for (let f = 0; f < 5; f++) {
      if (dp[f] < bestCost) { bestCost = dp[f]; bestFinger = f; }
    }

    const fingers: number[] = new Array(n);
    fingers[n - 1] = bestFinger;
    for (let i = n - 1; i > 0; i--) fingers[i - 1] = allParents[i][fingers[i]];

    for (let i = 0; i < n; i++) {
      if (positions[i].notes.length === 1) {
        positions[i].notes[0].finger = (fingers[i] + 1) as FingerNumber;
      }
    }
  }

  private transitionCost(
    prevFinger: number,
    currFinger: number,
    interval: number,
    hand: 'left' | 'right',
  ): number {
    const absInterval = Math.abs(interval);

    // Same note repeated
    if (absInterval === 0) {
      // Same finger on repeated note is natural
      return prevFinger === currFinger ? 0 : 1;
    }

    // Same finger on different notes — very bad
    if (prevFinger === currFinger) return 25;

    // For left hand, thumb (1) is on the HIGH side, pinky (5) on the LOW side.
    // Right hand: ascending pitch → ascending finger numbers
    // Left hand: ascending pitch → descending finger numbers (invert)
    const dir = hand === 'right' ? Math.sign(interval) : -Math.sign(interval);
    const fingerDelta = currFinger - prevFinger;

    // Is this a thumb crossing?
    const isThumbUnder = (dir > 0 && prevFinger > 1 && currFinger === 1);
    const isFingerOver = (dir < 0 && prevFinger === 1 && currFinger > 1);
    const isThumbCrossing = isThumbUnder || isFingerOver;

    let cost = 0;

    if (isThumbCrossing) {
      // --- Thumb crossing: separate cost model ---
      // Don't use the normal stretch table — crossings have their own mechanics.
      if (isThumbUnder) {
        // After finger 3 is the standard and most comfortable crossing
        if (prevFinger === 3) cost += 1;
        else if (prevFinger === 2) cost += 3;
        else if (prevFinger === 4) cost += 4;
        else cost += 10; // finger 5 → thumb is very hard

        // Crossings work best with intervals of 1-5 semitones
        if (absInterval > 7) cost += (absInterval - 7) * 2;
      } else {
        // Finger over thumb: to finger 3 is standard
        if (currFinger === 3) cost += 1;
        else if (currFinger === 2) cost += 2;
        else if (currFinger === 4) cost += 5;
        else cost += 12;

        if (absInterval > 7) cost += (absInterval - 7) * 2;
      }
    } else {
      // --- Normal (non-crossing) transition ---

      // 1. Stretch penalty using comfort table
      const comfort = getComfort(prevFinger, currFinger);
      if (comfort) {
        if (absInterval > comfort.max) {
          cost += (absInterval - comfort.max) * 3;
        } else if (absInterval < comfort.min) {
          cost += (comfort.min - absInterval) * 2;
        }
      }

      // 2. Natural finger order: ascending pitch → ascending fingers
      if (dir > 0 && fingerDelta <= 0) {
        cost += 12;
      } else if (dir < 0 && fingerDelta >= 0) {
        cost += 12;
      }

      // 3. Sequential finger preference: penalize skipping fingers on small intervals
      const fingerGap = Math.abs(fingerDelta) - 1;
      if (fingerGap > 0 && absInterval <= 4) {
        cost += fingerGap * 4;
      }
    }

    // --- Weak finger penalty for wide intervals ---
    if (absInterval > 5) {
      if (currFinger === 4) cost += 1;
      if (currFinger === 5) cost += 2;
    }

    // --- Beyond max hand span ---
    if (absInterval > this.maxSpan) {
      cost += (absInterval - this.maxSpan) * 5;
    }

    return cost;
  }
}
