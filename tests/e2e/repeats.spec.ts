import { test, expect } from '@playwright/test';
import { discoverAllSongs } from './song-discovery';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

const allSongs = discoverAllSongs();

test.describe('Timeline Integrity', () => {
  // Test every song for monotonic timestamps (catches repeat/timing bugs)
  for (const song of allSongs) {
    test(`${song.title}: timestamps are monotonic`, async ({ page }) => {
      await page.goto('/');
      await waitForApp(page);

      await page.evaluate(async (url: string) => {
        await window.pianoApp.loadSong(url);
      }, song.url);
      await page.waitForSelector('#score-container svg', { timeout: 15000 });

      const result = await page.evaluate(() => {
        const timeline = window.pianoApp.getNoteTimeline();
        for (let i = 1; i < timeline.length; i++) {
          if (timeline[i].timestamp < timeline[i - 1].timestamp - 0.001) {
            return {
              ok: false,
              issue: `Event ${i}: ${timeline[i].timestamp} < ${timeline[i - 1].timestamp}`,
            };
          }
        }
        return {
          ok: true,
          issue: '',
          totalEvents: timeline.length,
          totalMeasures: window.pianoApp.getTotalMeasures(),
          allValid: timeline.every(e => e.notes.every(n => n.midi >= 21 && n.midi <= 108)),
        };
      });

      expect(result.ok).toBe(true);
      expect(result.totalEvents).toBeGreaterThan(0);
      expect(result.totalMeasures).toBeGreaterThan(0);
    });
  }

  // Verify practice mode works on first 10 notes of every song
  for (const song of allSongs) {
    test(`${song.title}: first 10 notes play correctly`, async ({ page }) => {
      await page.goto('/');
      await waitForApp(page);

      await page.evaluate(async (url: string) => {
        await window.pianoApp.loadSong(url);
      }, song.url);
      await page.waitForSelector('#score-container svg', { timeout: 15000 });

      await page.evaluate(() => window.pianoApp.setMode('practice'));
      await page.evaluate(async () => await window.pianoApp.startPractice());

      const total = await page.evaluate(() => window.pianoApp.getPracticeState().totalNotes);
      const limit = Math.min(10, total);

      for (let i = 0; i < limit; i++) {
        const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
        if (expected.length === 0) break;
        for (const midi of expected) {
          await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
        }
      }

      const state = await page.evaluate(() => window.pianoApp.getPracticeState());
      expect(state.correctCount).toBeGreaterThanOrEqual(limit);
      expect(state.wrongCount).toBe(0);
    });
  }
});
