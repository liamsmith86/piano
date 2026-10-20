import { test, expect, type Page } from '@playwright/test';

async function waitForApp(page: Page) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

async function startPractice(page: Page) {
  await page.evaluate(async () => {
    window.pianoApp.setMode('practice');
    await window.pianoApp.startPractice();
  });
  expect(await page.evaluate(() => window.pianoApp.practiceMode.isActive())).toBe(true);
}

test.describe('Settings Panel', () => {
  test('opens and closes settings', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Click settings button
    await page.click('.tb-settings-btn');
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Close with X button
    await page.click('.sp-close');
    await expect(page.locator('.settings-panel')).not.toBeVisible();
  });

  test('settings panel has all toggles', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.click('.tb-settings-btn');

    const toggles = page.locator('[data-setting]');
    expect(await toggles.count()).toBeGreaterThanOrEqual(8);

    // Check specific settings exist
    await expect(page.locator('[data-setting="showNoteNames"]')).toBeVisible();
    await expect(page.locator('[data-setting="showNextNote"]')).toBeVisible();
    await expect(page.locator('[data-setting="highlightExpectedKeys"]')).toBeVisible();
    await expect(page.locator('[data-setting="countIn"]')).toBeVisible();
    await expect(page.locator('[data-setting="accompaniment"]')).toBeVisible();
    await expect(page.locator('[data-setting="autoAdvance"]')).toBeVisible();
  });

  test('skill presets are available', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.click('.tb-settings-btn');

    await expect(page.locator('[data-preset="beginner"]')).toBeVisible();
    await expect(page.locator('[data-preset="intermediate"]')).toBeVisible();
    await expect(page.locator('[data-preset="advanced"]')).toBeVisible();
  });

  test('toggling a setting persists', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Open settings and uncheck showNextNote
    await page.click('.tb-settings-btn');
    const toggle = page.locator('[data-setting="showNextNote"]');
    await toggle.uncheck();
    await page.click('.sp-close');

    // Reopen and verify it's unchecked
    await page.click('.tb-settings-btn');
    expect(await page.locator('[data-setting="showNextNote"]').isChecked()).toBe(false);
  });

  test('closes by clicking overlay background', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.click('.tb-settings-btn');
    await expect(page.locator('.settings-panel')).toBeVisible();

    // Click the overlay background (outside the panel)
    await page.click('.settings-overlay', { position: { x: 10, y: 10 } });
    await expect(page.locator('.settings-panel')).not.toBeVisible();
  });
});

test.describe('Virtual keyboard visibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await page.evaluate(() => window.pianoApp.loadSong('/songs/MozartPianoSonata.mxl'));
  });

  test('stays hidden by default when practice starts and restarts', async ({ page }) => {
    const keyboard = page.locator('#keyboard-container');
    await page.getByRole('button', { name: 'Open settings' }).click();
    await expect(page.locator('[data-setting="showVirtualKeyboard"]')).not.toBeChecked();
    await page.getByRole('button', { name: 'Close settings' }).click();

    await startPractice(page);
    await expect(keyboard).toBeHidden();

    // Hiding the visual input must not prevent hardware/programmatic practice.
    await page.evaluate(() => {
      const app = window.pianoApp;
      for (const midi of app.getPracticeState().expectedNotes) {
        app.simulateNoteInput(midi);
        app.simulateNoteRelease(midi);
      }
    });
    expect(await page.evaluate(() => window.pianoApp.getPracticeState().cursorIndex)).toBe(1);
    await expect(keyboard).toBeHidden();

    await page.evaluate(() => window.pianoApp.stopPractice());
    await expect(keyboard).toBeHidden();
    await startPractice(page);
    await expect(keyboard).toBeHidden();

    await page.evaluate(() => window.pianoApp.setMode('play'));
    await expect(keyboard).toBeHidden();
    await page.evaluate(() => window.pianoApp.loadSong('/songs/BeetAnGeSample.mxl'));
    await startPractice(page);
    await expect(keyboard).toBeHidden();
  });

  test('can hide and show the keyboard without interrupting active practice', async ({ page }) => {
    await startPractice(page);
    const keyboard = page.locator('#keyboard-container');
    const before = await page.evaluate(() => window.pianoApp.getPracticeState());
    await page.getByRole('button', { name: 'Open settings' }).click();
    const toggle = page.locator('[data-setting="showVirtualKeyboard"]');

    for (const visible of [true, false, true]) {
      await toggle.setChecked(visible);
      await expect(keyboard).toBeVisible({ visible });
      expect(await page.evaluate(() => window.pianoApp.practiceMode.isActive())).toBe(true);
      const state = await page.evaluate(() => window.pianoApp.getPracticeState());
      expect(state.cursorIndex).toBe(before.cursorIndex);
      expect(state.expectedNotes).toEqual(before.expectedNotes);
    }

    expect(await keyboard.locator('.vk-highlight, .vk-highlight-left').count()).toBeGreaterThan(0);
  });

  for (const visible of [false, true]) {
    test(`preserves the ${visible ? 'shown' : 'hidden'} keyboard preference after reload`, async ({ page }) => {
      await startPractice(page);
      await page.getByRole('button', { name: 'Open settings' }).click();
      const toggle = page.locator('[data-setting="showVirtualKeyboard"]');
      // Exercise saving both values, including an explicit opt-out.
      await toggle.setChecked(!visible);
      await toggle.setChecked(visible);
      await page.reload();
      await waitForApp(page);
      await page.evaluate(() => window.pianoApp.loadSong('/songs/MozartPianoSonata.mxl'));
      await expect(page.locator('#keyboard-container')).toBeVisible({ visible });

      await startPractice(page);
      await expect(page.locator('#keyboard-container')).toBeVisible({ visible });
      await page.getByRole('button', { name: 'Open settings' }).click();
      await expect(toggle).toBeChecked({ checked: visible });
    });
  }
});

test.describe('Keyboard Shortcuts Help', () => {
  test('opens with ? key', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.keyboard.press('?');
    await expect(page.locator('.shortcuts-panel')).toBeVisible();
  });

  test('closes with ? key toggle', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.keyboard.press('?');
    await expect(page.locator('.shortcuts-panel')).toBeVisible();

    await page.click('.sh-close');
    await expect(page.locator('.shortcuts-panel')).not.toBeVisible();
  });

  test('displays keyboard shortcut info', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.keyboard.press('?');
    const panel = page.locator('.shortcuts-panel');
    await expect(panel).toBeVisible();

    // Should mention Space and Escape
    await expect(panel.locator('text=Space')).toBeVisible();
    await expect(panel.locator('text=Escape')).toBeVisible();
  });
});
