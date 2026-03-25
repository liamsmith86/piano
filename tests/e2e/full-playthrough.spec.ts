import { test, expect } from '@playwright/test';
import { discoverAllSongs } from './song-discovery';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

const allSongs = discoverAllSongs();

// Test EVERY discovered song: full playthrough with zero wrong notes
for (const song of allSongs) {
  test(`full playthrough: ${song.title}`, async ({ page }) => {
    test.setTimeout(120000); // some songs are very long
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(async (url: string) => {
      await window.pianoApp.loadSong(url);
    }, song.url);
    await page.waitForSelector('#score-container svg', { timeout: 20000 });

    await page.evaluate(() => {
      window.pianoApp.setHand('both');
      window.pianoApp.clearLoop();
      window.pianoApp.setAutoAdvance(0);
      window.pianoApp.setMode('practice');
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const total = await page.evaluate(() => window.pianoApp.getPracticeState().totalNotes);
    expect(total).toBeGreaterThan(0);

    // Play through every note
    for (let i = 0; i < total; i++) {
      const state = await page.evaluate(() => window.pianoApp.getPracticeState());
      if (state.expectedNotes.length === 0) break;
      for (const midi of state.expectedNotes) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    const final = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(final.correctCount).toBe(total);
    expect(final.wrongCount).toBe(0);
  });
}
