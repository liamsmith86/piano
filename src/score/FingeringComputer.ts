import type { NoteEvent, NoteInfo } from '../types';

export type FingerNumber = 1 | 2 | 3 | 4 | 5;
type Hand = 'left' | 'right';

interface FingerSpan {
  minPractical: number;
  minComfortable: number;
  minRelaxed: number;
  maxRelaxed: number;
  maxComfortable: number;
  maxPractical: number;
}

interface FingeringCandidate {
  /** Fingers aligned with a position's ascending, unique pitches. */
  fingers: FingerNumber[];
  intrinsicCost: number;
  handAnchor: number;
}

interface FingeringPosition {
  event: NoteEvent;
  pitches: number[];
  notesByPitch: Map<number, NoteInfo[]>;
  candidates: FingeringCandidate[];
}

/**
 * Practical, comfortable, and relaxed spans from Parncutt et al. (1997).
 *
 * The table is directional: its keys are increasing right-hand finger pairs,
 * and negative intervals describe thumb crossings. Left-hand motion and
 * decreasing finger pairs are mirrored before consulting it.
 */
const FINGER_SPANS: Record<string, FingerSpan> = {
  '1-2': { minPractical: -5, minComfortable: -3, minRelaxed: 1, maxRelaxed: 5, maxComfortable: 8, maxPractical: 10 },
  '1-3': { minPractical: -4, minComfortable: -2, minRelaxed: 3, maxRelaxed: 7, maxComfortable: 10, maxPractical: 12 },
  '1-4': { minPractical: -3, minComfortable: -1, minRelaxed: 5, maxRelaxed: 9, maxComfortable: 12, maxPractical: 14 },
  '1-5': { minPractical: -1, minComfortable: 1, minRelaxed: 7, maxRelaxed: 10, maxComfortable: 13, maxPractical: 15 },
  '2-3': { minPractical: 1, minComfortable: 1, minRelaxed: 1, maxRelaxed: 2, maxComfortable: 3, maxPractical: 5 },
  '2-4': { minPractical: 1, minComfortable: 1, minRelaxed: 3, maxRelaxed: 4, maxComfortable: 5, maxPractical: 7 },
  '2-5': { minPractical: 2, minComfortable: 2, minRelaxed: 5, maxRelaxed: 6, maxComfortable: 8, maxPractical: 10 },
  '3-4': { minPractical: 1, minComfortable: 1, minRelaxed: 1, maxRelaxed: 2, maxComfortable: 2, maxPractical: 4 },
  '3-5': { minPractical: 1, minComfortable: 1, minRelaxed: 3, maxRelaxed: 4, maxComfortable: 5, maxPractical: 7 },
  '4-5': { minPractical: 1, minComfortable: 1, minRelaxed: 1, maxRelaxed: 2, maxComfortable: 3, maxPractical: 5 },
};

const FINGERS: FingerNumber[] = [1, 2, 3, 4, 5];
const NATURAL_FINGER_OFFSETS = [0, 0, 2, 4, 5, 7];
const PITCH_CLASS_TO_DIATONIC = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
const BLACK_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
const INFINITY = Number.POSITIVE_INFINITY;

/**
 * Sequence-aware ergonomic piano fingering suggestions.
 *
 * Each onset becomes a trellis layer containing every non-crossing fingering
 * for that note or chord. Dynamic programming then chooses the lowest-cost
 * path through the whole passage. Costs account for:
 *
 * - directional practical/comfortable/relaxed finger spans;
 * - simultaneous chord shape (vertical cost);
 * - motion between every note in adjacent positions (horizontal cost);
 * - stable fingers on repeated pitches and repeated chords;
 * - thumb crossings, black-key geometry, and unnecessary hand shifts.
 *
 * This follows the ergonomic trellis approach described by Parncutt et al.
 * (1997) and its polyphonic extension by Al Kasimi, Nichols, and Raphael
 * (2007). It intentionally remains a suggestion: phrasing, articulation,
 * hand shape, and a player's interpretation can all justify alternatives.
 */
export class FingeringComputer {
  private maxSpan = 15;

  setMaxSpan(semitones: number): void {
    if (!Number.isFinite(semitones) || semitones <= 0) {
      throw new RangeError('Maximum hand span must be a positive number');
    }
    this.maxSpan = semitones;
  }

  compute(events: NoteEvent[], hand: Hand): void {
    for (const event of events) {
      for (const note of event.notes) note.finger = undefined;
    }

    const positions = events
      .map(event => this.createPosition(event, hand))
      .filter((position): position is FingeringPosition => position !== null);

    if (positions.length === 0) return;

    // A six-note attack cannot have a truthful one-hand fingering. Treat it as
    // a boundary rather than inventing duplicate fingers or silently dropping
    // notes, then optimise each playable passage independently.
    let passageStart = 0;
    for (let i = 0; i <= positions.length; i++) {
      const isBoundary = i === positions.length || positions[i].candidates.length === 0;
      if (!isBoundary) continue;

      if (i > passageStart) this.assignPassage(positions.slice(passageStart, i), hand);
      passageStart = i + 1;
    }
  }

  private createPosition(event: NoteEvent, hand: Hand): FingeringPosition | null {
    const notesByPitch = new Map<number, NoteInfo[]>();
    for (const note of event.notes) {
      if (note.tied) continue;
      const notes = notesByPitch.get(note.midi) ?? [];
      notes.push(note);
      notesByPitch.set(note.midi, notes);
    }
    if (notesByPitch.size === 0) return null;

    const pitches = [...notesByPitch.keys()].sort((a, b) => a - b);
    const fingerings = pitches.length <= FINGERS.length
      ? this.orderedFingerings(pitches.length, hand)
      : [];
    const candidates = fingerings.map(fingers => ({
      fingers,
      intrinsicCost: this.verticalCost(pitches, fingers, hand),
      handAnchor: this.handAnchor(pitches, fingers, hand),
    }));

    return { event, pitches, notesByPitch, candidates };
  }

  private orderedFingerings(noteCount: number, hand: Hand): FingerNumber[][] {
    const combinations: FingerNumber[][] = [];

    const choose = (start: number, selected: FingerNumber[]): void => {
      if (selected.length === noteCount) {
        combinations.push(hand === 'right' ? selected : [...selected].reverse());
        return;
      }
      const remaining = noteCount - selected.length;
      for (let i = start; i <= FINGERS.length - remaining; i++) {
        choose(i + 1, [...selected, FINGERS[i]]);
      }
    };

    choose(0, []);
    return combinations;
  }

  private assignPassage(positions: FingeringPosition[], hand: Hand): void {
    const costs: Float64Array[] = [];
    const parents: Int16Array[] = [];

    const firstCosts = new Float64Array(positions[0].candidates.length);
    const firstParents = new Int16Array(positions[0].candidates.length).fill(-1);
    positions[0].candidates.forEach((candidate, index) => {
      firstCosts[index] = candidate.intrinsicCost + this.entryCost(candidate);
    });
    costs.push(firstCosts);
    parents.push(firstParents);

    for (let i = 1; i < positions.length; i++) {
      const previous = positions[i - 1];
      const current = positions[i];
      const currentCosts = new Float64Array(current.candidates.length).fill(INFINITY);
      const currentParents = new Int16Array(current.candidates.length).fill(-1);

      current.candidates.forEach((candidate, candidateIndex) => {
        previous.candidates.forEach((previousCandidate, previousIndex) => {
          const cost = costs[i - 1][previousIndex]
            + candidate.intrinsicCost
            + this.horizontalCost(previous, previousCandidate, current, candidate, hand);
          if (cost < currentCosts[candidateIndex]) {
            currentCosts[candidateIndex] = cost;
            currentParents[candidateIndex] = previousIndex;
          }
        });
      });

      costs.push(currentCosts);
      parents.push(currentParents);
    }

    const finalCosts = costs[costs.length - 1];
    let candidateIndex = 0;
    for (let i = 1; i < finalCosts.length; i++) {
      if (finalCosts[i] < finalCosts[candidateIndex]) candidateIndex = i;
    }

    for (let i = positions.length - 1; i >= 0; i--) {
      this.applyCandidate(positions[i], positions[i].candidates[candidateIndex]);
      candidateIndex = parents[i][candidateIndex];
    }
  }

  private applyCandidate(position: FingeringPosition, candidate: FingeringCandidate): void {
    position.pitches.forEach((pitch, index) => {
      for (const note of position.notesByPitch.get(pitch) ?? []) {
        note.finger = candidate.fingers[index];
      }
    });
  }

  private entryCost(candidate: FingeringCandidate): number {
    if (candidate.fingers.length !== 1) return 0;
    // An isolated phrase normally begins near the strong central fingers, but
    // this small preference is easily outweighed by the following passage.
    return [0, 0.45, 0.12, 0, 0.35, 0.5][candidate.fingers[0]];
  }

  private verticalCost(pitches: number[], fingers: FingerNumber[], hand: Hand): number {
    let cost = 0;

    for (let i = 0; i < pitches.length; i++) {
      cost += this.keyGeometryCost(pitches[i], fingers[i]);
      if (i === 0) continue;

      const interval = pitches[i] - pitches[i - 1];
      cost += this.spanCost(fingers[i - 1], fingers[i], interval, hand);

      // In a relaxed chord, diatonic note spacing usually resembles finger
      // spacing. This resolves otherwise equivalent shapes without forcing
      // every chord into the old 1-3-5 template.
      const diatonicSteps = Math.min(4, this.diatonicDistance(pitches[i - 1], pitches[i]));
      const fingerSteps = Math.abs(fingers[i] - fingers[i - 1]);
      cost += Math.abs(diatonicSteps - fingerSteps) * 0.85;
    }

    if (pitches.length > 2) {
      const last = pitches.length - 1;
      cost += this.spanCost(fingers[0], fingers[last], pitches[last] - pitches[0], hand) * 0.35;
    }

    if (pitches.length > 1) {
      const span = pitches[pitches.length - 1] - pitches[0];
      if (span > this.maxSpan) cost += 30 + (span - this.maxSpan) * 8;

      const lowOuterFinger = hand === 'right' ? fingers[0] - 1 : 5 - fingers[0];
      const highOuterFinger = hand === 'right'
        ? 5 - fingers[fingers.length - 1]
        : fingers[fingers.length - 1] - 1;
      cost += (lowOuterFinger + highOuterFinger) * 0.25;
    }

    return cost;
  }

  private horizontalCost(
    previous: FingeringPosition,
    previousCandidate: FingeringCandidate,
    current: FingeringPosition,
    candidate: FingeringCandidate,
    hand: Hand,
  ): number {
    let pairCost = 0;
    let pairCount = 0;

    for (let previousIndex = 0; previousIndex < previous.pitches.length; previousIndex++) {
      for (let currentIndex = 0; currentIndex < current.pitches.length; currentIndex++) {
        pairCost += this.noteTransitionCost(
          previous.pitches[previousIndex],
          previousCandidate.fingers[previousIndex],
          current.pitches[currentIndex],
          candidate.fingers[currentIndex],
          hand,
        );
        pairCount++;
      }
    }

    let repeatedPitchCost = 0;
    for (let previousIndex = 0; previousIndex < previous.pitches.length; previousIndex++) {
      const currentIndex = current.pitches.indexOf(previous.pitches[previousIndex]);
      if (currentIndex < 0) continue;
      if (previousCandidate.fingers[previousIndex] !== candidate.fingers[currentIndex]) {
        repeatedPitchCost += 5;
      }
    }

    const beatGap = current.event.timestampBeats - previous.event.timestampBeats;
    const motionFreedom = Math.min(1, Math.max(0, beatGap - 1) / 3);
    const anchorShift = Math.abs(candidate.handAnchor - previousCandidate.handAnchor);
    const anchorCost = Math.max(0, anchorShift - 2) * 0.08 * (1 - motionFreedom * 0.65);

    return pairCost / Math.max(1, pairCount) + repeatedPitchCost + anchorCost;
  }

  private noteTransitionCost(
    previousPitch: number,
    previousFinger: FingerNumber,
    currentPitch: number,
    currentFinger: FingerNumber,
    hand: Hand,
  ): number {
    const interval = currentPitch - previousPitch;
    const distance = Math.abs(interval);

    if (distance === 0) {
      return previousFinger === currentFinger ? 0 : 1.4;
    }

    if (previousFinger === currentFinger) {
      // Reusing a finger on a neighbouring key is awkward, but after a leap
      // the hand is relocating anyway and reuse can be entirely sensible.
      return 3.2 + Math.max(0, 5 - distance) * 0.75;
    }

    let cost = this.spanCost(previousFinger, currentFinger, interval, hand);
    const handInterval = hand === 'right' ? interval : -interval;
    const fingerDelta = currentFinger - previousFinger;
    const isThumbCrossover = handInterval * fingerDelta < 0
      && (previousFinger === 1 || currentFinger === 1);
    const isNonThumbCrossover = handInterval * fingerDelta < 0
      && previousFinger !== 1
      && currentFinger !== 1;

    // Horizontal motion may relocate the hand instead of holding a stretch.
    // Keep close non-thumb crossovers expensive, while allowing a clean shift
    // for leaps that cannot be connected in one position.
    const relocationCost = 4.4 + Math.min(distance, 24) * 0.1;
    cost = Math.min(cost, relocationCost);
    if (isThumbCrossover && distance <= 7) cost += 0.65;
    if (isNonThumbCrossover && distance <= 7) cost += 7;

    if (distance <= 4) {
      const diatonicSteps = this.diatonicDistance(previousPitch, currentPitch);
      const fingerSteps = Math.abs(fingerDelta);
      cost += Math.abs(Math.min(4, diatonicSteps) - fingerSteps) * 0.32;
    }

    cost += this.keyGeometryCost(currentPitch, currentFinger) * 0.45;
    return cost;
  }

  private spanCost(
    previousFinger: FingerNumber,
    currentFinger: FingerNumber,
    interval: number,
    hand: Hand,
  ): number {
    if (previousFinger === currentFinger) return interval === 0 ? 0 : 12;

    const lowerFinger = Math.min(previousFinger, currentFinger);
    const higherFinger = Math.max(previousFinger, currentFinger);
    const span = FINGER_SPANS[`${lowerFinger}-${higherFinger}`];
    if (!span) return 20;

    const handInterval = hand === 'right' ? interval : -interval;
    const orientedInterval = previousFinger < currentFinger ? handInterval : -handInterval;

    if (orientedInterval < span.minPractical) {
      return 18 + (span.minPractical - orientedInterval) * 6;
    }
    if (orientedInterval > span.maxPractical) {
      return 18 + (orientedInterval - span.maxPractical) * 6;
    }
    if (orientedInterval < span.minComfortable) {
      return 6 + (span.minComfortable - orientedInterval) * 2.5;
    }
    if (orientedInterval > span.maxComfortable) {
      return 6 + (orientedInterval - span.maxComfortable) * 2.5;
    }
    if (orientedInterval < span.minRelaxed) {
      return (span.minRelaxed - orientedInterval) * 0.75;
    }
    if (orientedInterval > span.maxRelaxed) {
      return (orientedInterval - span.maxRelaxed) * 0.75;
    }
    return 0;
  }

  private handAnchor(pitches: number[], fingers: FingerNumber[], hand: Hand): number {
    const direction = hand === 'right' ? 1 : -1;
    const total = pitches.reduce((sum, pitch, index) => (
      sum + pitch - direction * NATURAL_FINGER_OFFSETS[fingers[index]]
    ), 0);
    return total / pitches.length;
  }

  private keyGeometryCost(pitch: number, finger: FingerNumber): number {
    const isBlackKey = BLACK_PITCH_CLASSES.has(((pitch % 12) + 12) % 12);
    if (isBlackKey && finger === 1) return 1.6;
    if (isBlackKey && finger === 5) return 0.45;
    return 0;
  }

  private diatonicDistance(firstPitch: number, secondPitch: number): number {
    const ordinal = (pitch: number): number => {
      const octave = Math.floor(pitch / 12);
      const pitchClass = ((pitch % 12) + 12) % 12;
      return octave * 7 + PITCH_CLASS_TO_DIATONIC[pitchClass];
    };
    return Math.abs(ordinal(secondPitch) - ordinal(firstPitch));
  }
}
