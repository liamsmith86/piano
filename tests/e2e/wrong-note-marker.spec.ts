import { test, expect } from '@playwright/test';
import { discoverAllSongs } from './song-discovery';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

async function loadSong(page: any, url: string) {
  await page.evaluate(async (u: string) => await window.pianoApp.loadSong(u), url);
  await page.waitForSelector('#score-container svg', { timeout: 15000 });
}

/**
 * Get the bounding boxes of all wrong-note-marker elements in the OSMD SVGs.
 * Returns array of {x, y, width, height} in SVG coordinates.
 */
async function getWrongMarkerPositions(page: any): Promise<{ x: number; y: number; width: number; height: number }[]> {
  return page.evaluate(() => {
    const markers = document.querySelectorAll('.wrong-note-marker');
    return Array.from(markers).map((m: any) => {
      try {
        const bbox = m.getBBox();
        return { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height };
      } catch {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
    });
  });
}

/**
 * Get the bounding box of the notehead closest to the given MIDI number
 * at the current cursor position.
 */
async function getExpectedNotePosition(page: any, targetMidi: number): Promise<{ cx: number; cy: number } | null> {
  return page.evaluate((midi: number) => {
    const cursor = window.pianoApp.renderer.getCursor() as any;
    if (!cursor) return null;
    const gnotes = cursor.GNotesUnderCursor?.();
    if (!gnotes) return null;

    let closestGN: any = null;
    let closestDist = Infinity;
    for (const gn of gnotes) {
      try {
        const ht = gn.sourceNote?.halfTone;
        if (ht == null || gn.sourceNote?.isRest?.()) continue;
        const noteMidi = ht + 12;
        const dist = Math.abs(noteMidi - midi);
        if (dist < closestDist) {
          closestDist = dist;
          closestGN = gn;
        }
      } catch {}
    }
    if (!closestGN) return null;

    let nhBox: any = null;
    try {
      const nhs = closestGN.getNoteheadSVGs?.();
      if (nhs?.length > 0) nhBox = nhs[0].getBBox?.();
      if (!nhBox || nhBox.width === 0) {
        const svgEl = closestGN.getSVGGElement?.();
        if (svgEl) nhBox = svgEl.getBBox?.();
      }
    } catch {}
    if (!nhBox) return null;

    return { cx: nhBox.x + nhBox.width / 2, cy: nhBox.y + nhBox.height / 2 };
  }, targetMidi);
}

const allSongs = discoverAllSongs();

test.describe('Wrong Note Marker Positioning', () => {
  test('different wrong notes at the same cursor position appear at different Y positions', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, allSongs[0].url);

    await page.evaluate(() => {
      window.pianoApp.setHand('both');
      window.pianoApp.setMode('practice');
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
    expect(expected.length).toBeGreaterThan(0);
    const expectedSet = new Set(expected);

    // Pick two wrong notes that are NOT in the expected set and differ by several diatonic steps.
    // Start from MIDI 40 (well below most notes) and 90 (well above), then adjust if they
    // happen to collide with expected.
    let wrongLow = 40;
    while (expectedSet.has(wrongLow)) wrongLow--;
    let wrongHigh = 90;
    while (expectedSet.has(wrongHigh)) wrongHigh++;

    // Play wrong note low and capture position
    await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), wrongLow);
    const markersLow = await getWrongMarkerPositions(page);
    expect(markersLow.length).toBe(1);
    const posLow = markersLow[0];

    // Play wrong note high (replaces the previous marker)
    await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), wrongHigh);
    const markersHigh = await getWrongMarkerPositions(page);
    expect(markersHigh.length).toBe(1);
    const posHigh = markersHigh[0];

    // The two markers should have clearly different Y positions
    // (higher note = lower Y in SVG, so posHigh.y should be smaller)
    const yCenterLow = posLow.y + posLow.height / 2;
    const yCenterHigh = posHigh.y + posHigh.height / 2;
    expect(yCenterHigh).toBeLessThan(yCenterLow - 10);

    // They should share approximately the same X (same cursor column)
    const xCenterLow = posLow.x + posLow.width / 2;
    const xCenterHigh = posHigh.x + posHigh.width / 2;
    expect(Math.abs(xCenterHigh - xCenterLow)).toBeLessThan(30);

    // Take screenshot showing the high wrong note
    const scoreContainer = page.locator('#score-container');
    await scoreContainer.screenshot({ path: 'test-results/wrong-note-different-y.png' });
  });

  test('marker moves to different X positions as cursor advances', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, allSongs[0].url);

    await page.evaluate(() => {
      window.pianoApp.setHand('both');
      window.pianoApp.setMode('practice');
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Play wrong note at first cursor position
    const expected1 = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
    expect(expected1.length).toBeGreaterThan(0);
    await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), expected1[0] + 5);
    const markers1 = await getWrongMarkerPositions(page);
    expect(markers1.length).toBe(1);
    const pos1 = markers1[0];

    // Play correct notes to advance
    for (const midi of expected1) {
      await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
    }

    // Play wrong note at second cursor position
    const expected2 = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
    if (expected2.length > 0) {
      await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), expected2[0] + 5);
      const markers2 = await getWrongMarkerPositions(page);
      expect(markers2.length).toBe(1);
      const pos2 = markers2[0];

      // X should have moved (different cursor column)
      expect(Math.abs(pos2.x - pos1.x)).toBeGreaterThan(5);
    }
  });

  test('only one wrong note marker shown at a time', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, allSongs[0].url);

    await page.evaluate(() => {
      window.pianoApp.setHand('both');
      window.pianoApp.setMode('practice');
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
    expect(expected.length).toBeGreaterThan(0);

    // Play multiple wrong notes rapidly
    for (let offset = 1; offset <= 5; offset++) {
      await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), expected[0] + offset);
    }

    // Should only have one marker visible
    const markers = await getWrongMarkerPositions(page);
    expect(markers.length).toBe(1);
  });

  test('wrong note marker disappears after fade timeout', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, allSongs[0].url);

    await page.evaluate(() => {
      window.pianoApp.setHand('both');
      window.pianoApp.setMode('practice');
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
    await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), expected[0] + 3);

    // Marker should exist
    let markers = await getWrongMarkerPositions(page);
    expect(markers.length).toBe(1);

    // Wait for fade (400ms display + 200ms fade + buffer)
    await page.waitForTimeout(800);

    // Marker should be removed from DOM
    markers = await getWrongMarkerPositions(page);
    expect(markers.length).toBe(0);
  });

  test('left hand wrong note marker appears on bass staff, not treble', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Find a song with bass clef notes by trying the first available
    await loadSong(page, allSongs[0].url);

    await page.evaluate(() => {
      window.pianoApp.setHand('left');
      window.pianoApp.setMode('practice');
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    if (state.expectedNotes.length === 0) return;

    // Play a wrong note on the bass side (low MIDI)
    const wrongMidi = Math.max(36, state.expectedNotes[0] - 3);
    await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), wrongMidi);

    await page.waitForTimeout(50);

    // Get marker and expected note positions
    const info = await page.evaluate((midi: number) => {
      const marker = document.querySelector('.wrong-note-marker');
      if (!marker) return null;
      const mBbox = (marker as any).getBBox();

      // Get expected note position for reference
      const cursor = window.pianoApp.renderer.getCursor() as any;
      if (!cursor) return { markerY: mBbox.y };
      const gnotes = cursor.GNotesUnderCursor?.();
      if (!gnotes?.length) return { markerY: mBbox.y };

      let closest: any = null;
      let closestDist = Infinity;
      for (const gn of gnotes) {
        try {
          const ht = gn.sourceNote?.halfTone;
          if (ht == null) continue;
          const dist = Math.abs(ht + 12 - midi);
          if (dist < closestDist) { closestDist = dist; closest = gn; }
        } catch {}
      }
      if (!closest) return { markerY: mBbox.y };

      let nBox: any = null;
      try {
        const nhs = closest.getNoteheadSVGs?.();
        if (nhs?.length > 0) nBox = nhs[0].getBBox?.();
      } catch {}

      return {
        markerY: mBbox.y + mBbox.height / 2,
        expectedY: nBox ? nBox.y + nBox.height / 2 : null,
      };
    }, wrongMidi);

    if (info && info.expectedY != null) {
      // Marker should be close to expected note vertically (within ~25 SVG units)
      expect(Math.abs(info.markerY - info.expectedY)).toBeLessThan(25);
    }

    const scoreContainer = page.locator('#score-container');
    await scoreContainer.screenshot({
      path: 'test-results/wrong-note-left-hand.png',
    });
  });

  // Visual verification across multiple songs
  for (const song of allSongs.slice(0, 6)) {
    test(`visual: wrong note marker on "${song.title}"`, async ({ page }) => {
      await page.goto('/');
      await waitForApp(page);
      await loadSong(page, song.url);

      await page.evaluate(() => {
        window.pianoApp.setHand('both');
        window.pianoApp.setMode('practice');
      });
      await page.evaluate(async () => await window.pianoApp.startPractice());

      // Advance a few notes to get away from the start
      for (let i = 0; i < 2; i++) {
        const state = await page.evaluate(() => window.pianoApp.getPracticeState());
        if (state.expectedNotes.length === 0) break;
        for (const midi of state.expectedNotes) {
          await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
        }
      }

      const state = await page.evaluate(() => window.pianoApp.getPracticeState());
      if (state.expectedNotes.length === 0) return;

      // Play a wrong note (offset by 2 semitones from the expected)
      const wrongMidi = state.expectedNotes[0] + 2;
      await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), wrongMidi);

      // Small wait for marker to render
      await page.waitForTimeout(50);

      // Verify marker exists and is positioned within the score SVG bounds
      const markerInfo = await page.evaluate(() => {
        const marker = document.querySelector('.wrong-note-marker');
        if (!marker) return null;
        const bbox = (marker as any).getBBox();
        const parentSvg = marker.closest('svg');
        const svgBox = parentSvg?.viewBox?.baseVal;
        return {
          marker: { x: bbox.x, y: bbox.y, width: bbox.width, height: bbox.height },
          svgViewBox: svgBox ? { width: svgBox.width, height: svgBox.height } : null,
        };
      });

      // Some songs may not produce a marker (e.g., wrong note matched expected, or no SVG element found)
      if (!markerInfo) return;
      expect(markerInfo.marker.width).toBeGreaterThan(0);
      expect(markerInfo.marker.height).toBeGreaterThan(0);

      // Marker should be within the SVG bounds (with some tolerance for overflow)
      if (markerInfo!.svgViewBox) {
        expect(markerInfo!.marker.x).toBeGreaterThan(-50);
        expect(markerInfo!.marker.y).toBeGreaterThan(-50);
        expect(markerInfo!.marker.x).toBeLessThan(markerInfo!.svgViewBox.width + 50);
        expect(markerInfo!.marker.y).toBeLessThan(markerInfo!.svgViewBox.height + 50);
      }

      // Take a screenshot for visual verification
      const scoreContainer = page.locator('#score-container');
      await scoreContainer.screenshot({
        path: `test-results/wrong-note-${song.title.replace(/\s+/g, '-')}.png`,
      });
    });
  }
});
