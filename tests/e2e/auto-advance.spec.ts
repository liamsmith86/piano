import { test, expect } from '@playwright/test';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

async function loadSong(page: any, url: string) {
  await page.evaluate(async (u: string) => await window.pianoApp.loadSong(u), url);
  await page.waitForSelector('#score-container svg', { timeout: 15000 });
}

test.describe('Auto-Advance Timer', () => {
  test('auto-advances after timeout when no input', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/bella-ciaoeasy-version.mxl');

    // Set very short auto-advance (500ms)
    await page.evaluate(() => {
      window.pianoApp.setMode('practice');
      window.pianoApp.setAutoAdvance(500);
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Wait for auto-advance to fire
    await page.waitForTimeout(800);

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    // Should have auto-advanced at least once
    expect(state.cursorIndex).toBeGreaterThanOrEqual(1);
    // Should count as wrong (user didn't press)
    expect(state.wrongCount).toBeGreaterThanOrEqual(1);
    expect(state.correctCount).toBe(0);
  });

  test('auto-advance resets timer on correct partial input (chord)', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/bella-ciaoeasy-version.mxl');

    await page.evaluate(() => {
      window.pianoApp.setMode('practice');
      window.pianoApp.setAutoAdvance(1000);
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Immediately play the correct notes before timer fires
    const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
    for (const midi of expected) {
      await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
    }

    // Should have advanced without wrong count
    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.cursorIndex).toBe(1);
    expect(state.correctCount).toBe(1);
    expect(state.wrongCount).toBe(0);
  });

  test('disabling auto-advance stops the timer', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/bella-ciaoeasy-version.mxl');

    await page.evaluate(() => {
      window.pianoApp.setMode('practice');
      window.pianoApp.setAutoAdvance(500);
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Immediately disable
    await page.evaluate(() => window.pianoApp.setAutoAdvance(0));

    // Wait longer than the timeout
    await page.waitForTimeout(800);

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    // Should NOT have auto-advanced
    expect(state.cursorIndex).toBe(0);
    expect(state.wrongCount).toBe(0);
  });

  test('auto-advance records measure stats', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/bella-ciaoeasy-version.mxl');

    await page.evaluate(() => {
      window.pianoApp.setMode('practice');
      window.pianoApp.setAutoAdvance(300);
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Wait for 2 auto-advances
    await page.waitForTimeout(1000);

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    // Should have measure stats entries with wrong counts
    const badMeasures = state.measureStats.filter((m: any) => m.wrong > 0);
    expect(badMeasures.length).toBeGreaterThan(0);
  });
});
