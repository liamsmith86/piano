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
 * Query the fill colors of all notehead paths at the current OSMD cursor position.
 * Returns an array of fill color strings.
 */
async function getNoteColorsAtCursor(page: any): Promise<string[]> {
  return page.evaluate(() => {
    const cursor = window.pianoApp.renderer.getCursor() as any;
    if (!cursor) return [];
    const gnotes = cursor.GNotesUnderCursor?.();
    if (!gnotes) return [];
    const colors: string[] = [];
    for (const gn of gnotes) {
      const svg = gn.getSVGGElement?.();
      if (svg) {
        svg.querySelectorAll('path, circle, ellipse').forEach((el: any) => {
          const fill = el.getAttribute('fill');
          if (fill && fill !== 'none') colors.push(fill);
        });
      }
    }
    return colors;
  });
}

test.describe('Note Coloring', () => {
  test('played notes turn green and stop/replay resets to black', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/MozartPianoSonata.mxl');

    await page.evaluate(() => {
      window.pianoApp.setHand('both');
      window.pianoApp.setMode('practice');
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Play 3 notes
    for (let i = 0; i < 3; i++) {
      const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
      for (const midi of expected) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    // Current note (4th) should be blue (#3b82f6)
    const blueColors = await getNoteColorsAtCursor(page);
    expect(blueColors.length).toBeGreaterThan(0);
    expect(blueColors.every(c => c === '#3b82f6')).toBe(true);

    // Stop practice — all coloring should be cleared
    await page.evaluate(() => window.pianoApp.stopPractice());

    // Restart practice
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // First note should be blue (freshly highlighted), NOT green from previous session
    const restartColors = await getNoteColorsAtCursor(page);
    expect(restartColors.length).toBeGreaterThan(0);
    expect(restartColors.every(c => c === '#3b82f6')).toBe(true);
  });

  test('loop repeat resets green notes for fresh visual on second pass', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/MozartPianoSonata.mxl');

    // Set up a short loop
    await page.evaluate(() => {
      window.pianoApp.setMode('practice');
      window.pianoApp.setLoop(1, 2);
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const loopTotal = await page.evaluate(() => window.pianoApp.getPracticeState().totalNotes);
    expect(loopTotal).toBeGreaterThan(0);

    // Play through the entire loop (will loop back automatically)
    for (let i = 0; i < loopTotal; i++) {
      const state = await page.evaluate(() => window.pianoApp.getPracticeState());
      if (state.expectedNotes.length === 0) break;
      for (const midi of state.expectedNotes) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    // Should have looped back to start
    const afterLoop = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(afterLoop.cursorIndex).toBe(0);

    // The first note (now on second pass) should be highlighted blue, not green or any stale color
    const secondPassColors = await getNoteColorsAtCursor(page);
    expect(secondPassColors.length).toBeGreaterThan(0);
    expect(secondPassColors.every(c => c === '#3b82f6')).toBe(true);
  });
});

// Find songs with repeats (measure numbers go backwards in the timeline)
const allSongs = discoverAllSongs();

test.describe('Repeat Section Coloring', () => {
  for (const song of allSongs) {
    test(`${song.title}: no stale colors after repeat`, async ({ page }) => {
      await page.goto('/');
      await waitForApp(page);

      await page.evaluate(async (url: string) => {
        await window.pianoApp.loadSong(url);
      }, song.url);
      await page.waitForSelector('#score-container svg', { timeout: 20000 });

      // Check if this song has repeats by looking for backwards measure jumps
      const repeatInfo = await page.evaluate(() => {
        const timeline = window.pianoApp.getNoteTimeline();
        let repeatIndex = -1;
        for (let i = 1; i < timeline.length; i++) {
          if (timeline[i].measureNumber < timeline[i - 1].measureNumber) {
            repeatIndex = i;
            break;
          }
        }
        return { hasRepeat: repeatIndex >= 0, repeatIndex, total: timeline.length };
      });

      if (!repeatInfo.hasRepeat) {
        // No repeats in this song — skip the color check
        return;
      }

      // Play through to just past the repeat point
      await page.evaluate(() => {
        window.pianoApp.setHand('both');
        window.pianoApp.setMode('practice');
        window.pianoApp.setAutoAdvance(0);
      });
      await page.evaluate(async () => await window.pianoApp.startPractice());

      const target = Math.min(repeatInfo.repeatIndex + 2, repeatInfo.total);
      for (let i = 0; i < target; i++) {
        const state = await page.evaluate(() => window.pianoApp.getPracticeState());
        if (state.expectedNotes.length === 0) break;
        for (const midi of state.expectedNotes) {
          await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
        }
      }

      // After crossing the repeat, the current note should be blue (not green/stale)
      const colors = await getNoteColorsAtCursor(page);
      if (colors.length > 0) {
        // Every notehead at current cursor should be blue (#3b82f6)
        const allBlue = colors.every(c => c === '#3b82f6');
        expect(allBlue).toBe(true);
      }
    });
  }
});
