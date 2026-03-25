import { test, expect } from '@playwright/test';
import { discoverAllSongs } from './song-discovery';

const allSongs = discoverAllSongs();

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

async function loadSong(page: any, url: string) {
  await page.evaluate(async (u: string) => await window.pianoApp.loadSong(u), url);
  await page.waitForSelector('#score-container svg', { timeout: 15000 });
}

interface FingeringReport {
  totalNotes: number;
  fingeredNotes: number;
  rightHandNotes: number;
  leftHandNotes: number;
  violations: string[];
  fingerDistribution: Record<number, number>;
  samplePassages: { midi: number; finger: number; staff: number }[][];
}

/**
 * Analyze the fingering quality for a loaded song.
 * Returns a report with violations and statistics.
 */
async function analyzeFingeringSong(page: any): Promise<FingeringReport> {
  return page.evaluate(() => {
    // Enable fingering computation
    const app = window.pianoApp;
    const timeline = app.getNoteTimeline();
    const fc = app.fingeringComputer;

    // Compute fingering for both hands
    const rightEvents = timeline.filter((e: any) => e.notes.some((n: any) => n.staff === 1));
    const leftEvents = timeline.filter((e: any) => e.notes.some((n: any) => n.staff === 2));

    // Create hand-specific events with only that hand's notes
    const rhOnly = rightEvents.map((e: any) => ({
      ...e,
      notes: e.notes.filter((n: any) => n.staff === 1),
    })).filter((e: any) => e.notes.length > 0);

    const lhOnly = leftEvents.map((e: any) => ({
      ...e,
      notes: e.notes.filter((n: any) => n.staff === 2),
    })).filter((e: any) => e.notes.length > 0);

    fc.compute(rhOnly, 'right');
    fc.compute(lhOnly, 'left');

    // Collect all fingered notes
    const allNotes: { midi: number; finger: number | undefined; staff: number; index: number }[] = [];
    for (const event of timeline) {
      for (const note of event.notes) {
        allNotes.push({ midi: note.midi, finger: note.finger, staff: note.staff, index: event.index });
      }
    }

    const fingered = allNotes.filter(n => n.finger !== undefined);
    const violations: string[] = [];
    const fingerDist: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    for (const n of fingered) {
      fingerDist[n.finger!] = (fingerDist[n.finger!] || 0) + 1;
      if (n.finger! < 1 || n.finger! > 5) {
        violations.push(`Invalid finger ${n.finger} at MIDI ${n.midi}`);
      }
    }

    // Check for same-finger-on-different-note violations in sequences
    const checkSequence = (events: any[], label: string) => {
      let prevFinger: number | undefined;
      let prevMidi: number | undefined;
      for (const event of events) {
        for (const note of event.notes) {
          if (note.finger === undefined) continue;
          if (event.notes.length > 1) { prevFinger = undefined; prevMidi = undefined; continue; }
          if (prevFinger !== undefined && prevMidi !== undefined) {
            const jump = Math.abs(note.midi - prevMidi);
            // Only flag same-finger on small intervals (not position resets)
            if (note.finger === prevFinger && note.midi !== prevMidi && jump <= 7) {
              violations.push(`${label}: same finger ${note.finger} on consecutive different notes MIDI ${prevMidi}→${note.midi} (${jump} semitones)`);
            }
          }
          prevFinger = note.finger;
          prevMidi = note.midi;
        }
      }
    };
    checkSequence(rhOnly, 'RH');
    checkSequence(lhOnly, 'LH');

    // Check finger order matches pitch order for stepwise passages (non-crossing)
    const checkStepwise = (events: any[], handType: 'right' | 'left', label: string) => {
      let prev: { midi: number; finger: number } | null = null;
      for (const event of events) {
        if (event.notes.length !== 1) { prev = null; continue; }
        const note = event.notes[0];
        if (note.finger === undefined) { prev = null; continue; }
        if (prev) {
          const interval = Math.abs(note.midi - prev.midi);
          const fingerDelta = note.finger - prev.finger;
          const pitchDir = Math.sign(note.midi - prev.midi);
          const expectedFingerDir = handType === 'right' ? pitchDir : -pitchDir;

          const isThumbCross = (prev.finger === 1 && note.finger > 1) ||
                               (prev.finger > 1 && note.finger === 1);

          if (interval <= 2 && interval > 0 && !isThumbCross) {
            if (expectedFingerDir > 0 && fingerDelta <= 0) {
              violations.push(`${label}: wrong finger direction at MIDI ${prev.midi}(f${prev.finger})→${note.midi}(f${note.finger}), interval=${interval}`);
            }
            if (expectedFingerDir < 0 && fingerDelta >= 0) {
              violations.push(`${label}: wrong finger direction at MIDI ${prev.midi}(f${prev.finger})→${note.midi}(f${note.finger}), interval=${interval}`);
            }
          }
        }
        prev = { midi: note.midi, finger: note.finger };
      }
    };
    checkStepwise(rhOnly, 'right', 'RH');
    checkStepwise(lhOnly, 'left', 'LH');

    // Sample first 3 passages of single notes for inspection
    const samplePassages: { midi: number; finger: number; staff: number }[][] = [];
    let currentPassage: { midi: number; finger: number; staff: number }[] = [];
    for (const event of rhOnly.slice(0, 30)) {
      if (event.notes.length === 1 && event.notes[0].finger) {
        currentPassage.push({ midi: event.notes[0].midi, finger: event.notes[0].finger, staff: 1 });
      } else {
        if (currentPassage.length >= 3) samplePassages.push(currentPassage);
        currentPassage = [];
      }
      if (samplePassages.length >= 3) break;
    }
    if (currentPassage.length >= 3) samplePassages.push(currentPassage);

    return {
      totalNotes: allNotes.length,
      fingeredNotes: fingered.length,
      rightHandNotes: rhOnly.reduce((sum: number, e: any) => sum + e.notes.length, 0),
      leftHandNotes: lhOnly.reduce((sum: number, e: any) => sum + e.notes.length, 0),
      violations,
      fingerDistribution: fingerDist,
      samplePassages,
    };
  });
}

for (const song of allSongs) {
  test(`fingering audit: ${song.title}`, async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, song.url);

    const report = await analyzeFingeringSong(page);

    // Log the report
    console.log(`\n=== ${song.title} ===`);
    console.log(`  Notes: ${report.totalNotes} total, ${report.fingeredNotes} fingered (RH: ${report.rightHandNotes}, LH: ${report.leftHandNotes})`);
    console.log(`  Finger distribution:`, report.fingerDistribution);
    if (report.violations.length > 0) {
      console.log(`  VIOLATIONS (${report.violations.length}):`);
      for (const v of report.violations.slice(0, 10)) console.log(`    - ${v}`);
      if (report.violations.length > 10) console.log(`    ... and ${report.violations.length - 10} more`);
    } else {
      console.log(`  No violations`);
    }
    for (let i = 0; i < report.samplePassages.length; i++) {
      const p = report.samplePassages[i];
      const midis = p.map(n => n.midi).join(',');
      const fingers = p.map(n => n.finger).join(',');
      console.log(`  Passage ${i + 1}: MIDI [${midis}] → Fingers [${fingers}]`);
    }

    // Assertions
    expect(report.fingeredNotes).toBeGreaterThan(0);

    // All 5 fingers should be used (at least in songs with enough notes)
    if (report.fingeredNotes > 20) {
      const usedFingers = Object.entries(report.fingerDistribution)
        .filter(([, count]) => count > 0)
        .map(([f]) => Number(f));
      expect(usedFingers.length).toBeGreaterThanOrEqual(3); // at least 3 distinct fingers
    }

    // No invalid finger values
    const invalidFingers = report.violations.filter(v => v.includes('Invalid finger'));
    expect(invalidFingers).toHaveLength(0);

    // Same-finger-on-different-note should be rare (< 2% of notes)
    const sameFingerViolations = report.violations.filter(v => v.includes('same finger'));
    const maxSameFinger = Math.max(3, Math.floor(report.fingeredNotes * 0.02));
    expect(sameFingerViolations.length).toBeLessThan(maxSameFinger);

    // Direction violations should be rare (< 10% of notes)
    const dirViolations = report.violations.filter(v => v.includes('wrong finger direction'));
    const maxAllowed = Math.max(5, Math.floor(report.fingeredNotes * 0.1));
    expect(dirViolations.length).toBeLessThan(maxAllowed);
  });
}
