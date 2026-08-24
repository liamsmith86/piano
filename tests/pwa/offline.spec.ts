import { expect, test } from '@playwright/test';

test('reopens a cached score with piano audio while fully offline', async ({ page, context }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.goto('/');
  await page.waitForFunction(() => window.pianoApp !== undefined);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null);

  await page.evaluate(() => window.pianoApp.loadSong('/songs/MozartPianoSonata.mxl'));
  await expect(page.locator('#score-container svg')).toBeVisible();

  // A click provides real user activation and fills the runtime/sample caches.
  await page.locator('.tb-settings-btn').click();
  await page.locator('.sp-close').click();
  await page.waitForFunction(() => window.pianoApp.audio.ready, { timeout: 45000 });

  await context.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.pianoApp !== undefined);
  await expect(page.locator('.app-message')).toContainText('You are offline');

  await page.evaluate(() => window.pianoApp.loadSong('/songs/MozartPianoSonata.mxl'));
  await expect(page.locator('#score-container svg')).toBeVisible();
  await page.locator('.tb-settings-btn').click();
  await page.locator('.sp-close').click();
  await page.waitForFunction(() => window.pianoApp.audio.ready, { timeout: 45000 });

  expect(await page.evaluate(() => window.pianoApp.getLoadedSong()?.id))
    .toBe('mozart-piano-sonata');
  expect(pageErrors).toEqual([]);
});
