import { test, expect } from '@playwright/test';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
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
    expect(await toggles.count()).toBeGreaterThanOrEqual(7);

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
