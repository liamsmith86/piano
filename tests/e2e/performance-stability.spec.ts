import { expect, test } from '@playwright/test';

async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

async function loadSong(
  page: import('@playwright/test').Page,
  url = '/songs/MozartPianoSonata.mxl',
) {
  await page.evaluate(songUrl => window.pianoApp.loadSong(songUrl), url);
  await page.waitForSelector('#score-container svg', { timeout: 15000 });
}

test.describe('Performance and long-session stability', () => {
  test('keeps the score renderer out of the initial library bundle', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const resources = await page.evaluate(() => performance.getEntriesByType('resource')
      .map(entry => entry.name.toLowerCase()));
    expect(resources.some(name => name.includes('opensheetmusicdisplay'))).toBe(false);
    expect(await page.locator('#score-container svg').count()).toBe(0);
    expect(await page.locator('.vk-key').count()).toBe(0);
  });

  test('survives rapid and repeated song switches without stale renderers', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(async () => {
      const burst = [
        '/songs/MozartPianoSonata.mxl',
        '/songs/BeetAnGeSample.mxl',
        '/songs/MozartTrio.mxl',
      ];
      await Promise.all(burst.map(url => window.pianoApp.loadSong(url)));

      for (let index = 0; index < 8; index++) {
        const url = index % 2 === 0
          ? '/songs/MozartPianoSonata.mxl'
          : '/songs/BeetAnGeSample.mxl';
        await window.pianoApp.loadSong(url);
      }
    });

    const state = await page.evaluate(() => ({
      song: window.pianoApp.getLoadedSong(),
      diagnostics: window.pianoApp.getDiagnostics(),
      pages: document.querySelectorAll('#score-container svg[id^="osmdSvgPage"]').length,
    }));
    expect(state.song?.id).toBe('beethoven-an-die-geliebte');
    expect(state.pages).toBeGreaterThan(0);
    expect(state.diagnostics.renderer.scorePages).toBe(state.pages);
    expect(state.diagnostics.renderer.pendingTimers).toBe(0);
    expect(state.diagnostics.renderer.overlayGroups).toBeLessThanOrEqual(state.pages);
  });

  test('deduplicates overlay work and coalesces a zoom gesture', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    const result = await page.evaluate(async () => {
      const settings = {
        showNoteNamesOnScore: true,
        showAllAccidentals: false,
        showFingering: false,
        showChords: false,
      };
      window.pianoApp.updateOverlays(settings);
      const before = window.pianoApp.getDiagnostics();
      for (let index = 0; index < 12; index++) window.pianoApp.updateOverlays(settings);
      const afterOverlays = window.pianoApp.getDiagnostics();

      const slider = document.querySelector('.tb-zoom-slider') as HTMLInputElement;
      for (const value of ['160', '170', '180', '190', '200']) {
        slider.value = value;
        slider.dispatchEvent(new Event('input', { bubbles: true }));
      }
      slider.dispatchEvent(new Event('change', { bubbles: true }));
      await new Promise(resolve => setTimeout(resolve, 150));
      return { before, afterOverlays, after: window.pianoApp.getDiagnostics() };
    });

    expect(result.afterOverlays.renderer.overlayGroups)
      .toBe(result.before.renderer.overlayGroups);
    expect(result.afterOverlays.renderer.overlayRenderCount)
      .toBe(result.before.renderer.overlayRenderCount);
    expect(result.after.renderer.renderCount - result.before.renderer.renderCount).toBe(1);
    expect(result.after.renderer.pendingTimers).toBe(0);
  });

  test('cleans every audio schedule after repeated play and stop cycles', async ({ page }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/BeetAnGeSample.mxl');

    // A real click supplies the browser activation required by Web Audio.
    await page.locator('.tb-settings-btn').click();
    await page.locator('.sp-close').click();
    await page.waitForFunction(() => window.pianoApp.audio.ready, { timeout: 30000 });

    const result = await page.evaluate(async () => {
      const listenersBefore = window.pianoApp.getDiagnostics().eventListeners;
      window.pianoApp.setTempoScale(2);
      for (let index = 0; index < 15; index++) {
        await window.pianoApp.play();
        await new Promise(resolve => setTimeout(resolve, 25));
        window.pianoApp.stop();
      }
      return {
        listenersBefore,
        diagnostics: window.pianoApp.getDiagnostics(),
      };
    });

    expect(result.diagnostics.eventListeners).toBe(result.listenersBefore);
    expect(result.diagnostics.audio.scheduledPlaybackEvents).toBe(0);
    expect(result.diagnostics.audio.playbackActive).toBe(false);
    expect(result.diagnostics.audio.metronomeScheduled).toBe(false);
    expect(pageErrors).toEqual([]);
  });
});
