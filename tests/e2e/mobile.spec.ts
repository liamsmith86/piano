import { test, expect } from '@playwright/test';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

test.describe('iPhone Viewport', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true });

  test('app loads and library is visible', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await expect(page.locator('.song-library')).toBeVisible();
    expect(await page.locator('.sl-card').count()).toBeGreaterThanOrEqual(1);
  });

  test('can load and display a song', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/MozartPianoSonata.mxl');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });
    await expect(page.locator('#score-container')).toBeVisible();
    // Keyboard hidden by default (only shows in practice mode or with setting)
    await expect(page.locator('#keyboard-container')).not.toBeVisible();
  });

  test('toolbar controls are accessible', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await expect(page.locator('[data-mode="play"]')).toBeVisible();
    await expect(page.locator('[data-mode="practice"]')).toBeVisible();
    await expect(page.locator('[data-hand="both"]')).toBeVisible();
    await expect(page.locator('[data-speed="100"]')).toBeVisible();
  });

  test('practice mode works on mobile', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/MozartPianoSonata.mxl');
      window.pianoApp.setMode('practice');
      await window.pianoApp.startPractice();
    });
    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.expectedNotes.length).toBeGreaterThan(0);
    for (const midi of state.expectedNotes) {
      await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
    }
    const after = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(after.cursorIndex).toBe(1);
  });

  test('settings panel opens on mobile', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await page.click('.tb-settings-btn');
    await expect(page.locator('.settings-panel')).toBeVisible();
    expect(await page.locator('[data-setting]').count()).toBeGreaterThanOrEqual(7);
  });
});

test.describe('iPad Viewport', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('app loads with proper layout', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await expect(page.locator('.song-library')).toBeVisible();
    // Keyboard hidden by default
    await expect(page.locator('#keyboard-container')).not.toBeVisible();
  });

  test('score renders and practice works on tablet', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/BeetAnGeSample.mxl');
      window.pianoApp.setMode('practice');
      await window.pianoApp.startPractice();
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    for (let i = 0; i < 5; i++) {
      const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
      if (expected.length === 0) break;
      for (const midi of expected) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }
    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.correctCount).toBe(5);
  });
});
