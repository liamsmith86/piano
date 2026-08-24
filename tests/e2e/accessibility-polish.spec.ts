import { expect, test } from '@playwright/test';

async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

test.describe('Accessibility polish', () => {
  test('labels toolbar controls and reports progress semantically', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await expect(page.getByRole('toolbar', { name: 'Piano practice controls' })).toBeVisible();
    await expect(page.getByRole('slider', { name: 'Playback speed' }))
      .toHaveAttribute('aria-valuetext', '100 percent');
    await expect(page.getByRole('slider', { name: 'Piano volume' }))
      .toHaveAttribute('aria-valuetext', '50 percent');
    await expect(page.getByRole('slider', { name: 'Score zoom' })).toBeVisible();
    await expect(page.getByRole('progressbar', { name: 'Song progress' }))
      .toHaveAttribute('aria-valuenow', '0');
    await expect(page.getByRole('button', { name: 'Play or pause' })).toBeDisabled();
  });

  test('traps settings focus, closes with Escape, and restores the opener', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const opener = page.getByRole('button', { name: 'Open settings' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await expect(dialog).toBeVisible();
    await expect(page.getByRole('button', { name: 'Close settings' })).toBeFocused();

    await page.keyboard.press('Shift+Tab');
    await expect(dialog.locator('[data-preset="advanced"]')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('button', { name: 'Close settings' })).toBeFocused();

    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('supports a roving, keyboard-operated virtual piano', async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.setItem('piano-practice-settings', JSON.stringify({
        showVirtualKeyboard: true,
      }));
    });
    await page.goto('/');
    await waitForApp(page);

    const initial = page.locator('.vk-key[tabindex="0"]');
    await initial.focus();
    const initialMidi = Number(await initial.getAttribute('data-midi'));
    await page.keyboard.press('ArrowRight');

    const next = page.locator(`.vk-key[data-midi="${initialMidi + 1}"]`);
    await expect(next).toBeFocused();
    await page.keyboard.down('Space');
    await expect(next).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.up('Space');
    await expect(next).toHaveAttribute('aria-pressed', 'false');
  });
});
