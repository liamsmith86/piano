import { test, expect } from '@playwright/test';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

test.describe('State Reset Between Song Changes', () => {
  test('loop is cleared when switching songs', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Load first song and set a loop
    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/bella-ciaoeasy-version.mxl');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    await page.evaluate(() => window.pianoApp.setLoop(14, 26));
    const loop1 = await page.evaluate(() => window.pianoApp.getLoopRange());
    expect(loop1).toEqual({ start: 14, end: 26 });

    // Load a different song
    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/roaring-tides.mxl');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    // Loop should be cleared
    const loop2 = await page.evaluate(() => window.pianoApp.getLoopRange());
    expect(loop2).toBeNull();

    // Playing should start from beginning, not from old loop
    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    // Should have ALL notes, not just measures 14-26 from old song
    const fullTimeline = await page.evaluate(() => window.pianoApp.getNoteTimeline().length);
    expect(state.totalNotes).toBe(fullTimeline);
  });

  test('practice state is fully reset between songs', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Load first song and play some practice notes
    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/bella-ciaoeasy-version.mxl');
      window.pianoApp.setMode('practice');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Play 5 notes
    for (let i = 0; i < 5; i++) {
      const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
      for (const midi of expected) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    // Load second song
    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/roaring-tides.mxl');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    // Start practice on second song
    await page.evaluate(async () => await window.pianoApp.startPractice());
    const state = await page.evaluate(() => window.pianoApp.getPracticeState());

    // Should be at beginning with clean stats
    expect(state.cursorIndex).toBe(0);
    expect(state.correctCount).toBe(0);
    expect(state.wrongCount).toBe(0);
  });

  test('selection visual is cleared between songs', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/bella-ciaoeasy-version.mxl');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    // Create a selection
    await page.evaluate(() => window.pianoApp.setLoop(5, 10));

    // Load second song
    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/roaring-tides.mxl');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    // No selection rects should exist
    const rects = await page.locator('.score-selection-rect').count();
    expect(rects).toBe(0);
  });

  test('hand selection persists across songs (intentional)', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/bella-ciaoeasy-version.mxl');
      window.pianoApp.setHand('right');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/roaring-tides.mxl');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    // Hand selection SHOULD persist (user preference, not song-specific)
    const hand = await page.evaluate(() => window.pianoApp.getHand());
    expect(hand).toBe('right');
  });

  test('rapid song switching does not corrupt state', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Load songs rapidly
    const songs = [
      '/songs/bella-ciaoeasy-version.mxl',
      '/songs/roaring-tides.mxl',
      '/songs/runaway-kanye-west.mxl',
    ];

    for (const url of songs) {
      await page.evaluate(async (u: string) => {
        await window.pianoApp.loadSong(u);
      }, url);
      await page.waitForSelector('#score-container svg', { timeout: 15000 });
    }

    // Final song should be fully functional
    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.totalNotes).toBeGreaterThan(0);
    expect(state.cursorIndex).toBe(0);
    expect(state.expectedNotes.length).toBeGreaterThan(0);

    // Play one correct note
    for (const midi of state.expectedNotes) {
      await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
    }
    const after = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(after.correctCount).toBe(1);
    expect(after.wrongCount).toBe(0);
  });
});
