import { test, expect } from '@playwright/test';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

async function loadSong(page: any, url = '/songs/MozartPianoSonata.mxl') {
  await page.evaluate(async (u: string) => await window.pianoApp.loadSong(u), url);
  await page.waitForSelector('#score-container svg', { timeout: 15000 });
  await page.waitForTimeout(500);
}

/** Get viewport coordinates for the center of a measure */
async function getMeasureCenter(page: any, measureNum: number) {
  return page.evaluate((m: number) => {
    const si = window.pianoApp.scoreInteraction as any;
    const region = si.measureRegions.find((r: any) => r.measureNumber === m);
    if (!region) return null;
    const container = document.getElementById('score-container')!;
    const rect = container.getBoundingClientRect();
    return {
      x: rect.left + (region.left + region.right) / 2 - container.scrollLeft,
      y: rect.top + (region.top + region.bottom) / 2 - container.scrollTop,
    };
  }, measureNum);
}

test.describe('Score Interaction: Click-to-Jump', () => {
  test('clicking on a measure jumps the cursor there', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    const pos = await getMeasureCenter(page, 3);
    if (!pos) { test.skip(); return; }

    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(200);

    const measure = await page.evaluate(() =>
      window.pianoApp.renderer.getCurrentMeasureNumber()
    );
    expect(measure).toBeGreaterThanOrEqual(3);
  });

  test('clicking clears any existing selection', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    // Drag to create selection first
    const m1 = await getMeasureCenter(page, 1);
    const m3 = await getMeasureCenter(page, 3);
    if (!m1 || !m3) { test.skip(); return; }

    await page.mouse.move(m1.x, m1.y);
    await page.mouse.down();
    await page.mouse.move(m3.x, m3.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(100);

    // Should have a selection
    let rects = await page.locator('.score-selection-rect').count();
    expect(rects).toBeGreaterThan(0);

    // Click outside the selection to clear it.
    // At higher zoom, we need to click a measure that's clearly outside the
    // selected range (1-3). Use measure 4 which is immediately adjacent.
    const m4 = await getMeasureCenter(page, 4);
    if (m4) {
      // Scroll the container to make the target visible before clicking
      await page.evaluate((my: number) => {
        const c = document.getElementById('score-container')!;
        const containerRect = c.getBoundingClientRect();
        const targetRelY = my - containerRect.top;
        if (targetRelY > c.clientHeight || targetRelY < 0) {
          c.scrollTop += targetRelY - c.clientHeight / 2;
        }
      }, m4.y);
      await page.waitForTimeout(100);
      // Re-get coordinates after scroll
      const m4After = await getMeasureCenter(page, 4);
      if (m4After) {
        await page.mouse.click(m4After.x, m4After.y);
        await page.waitForTimeout(300);
      }
    }
    rects = await page.locator('.score-selection-rect:visible').count();
    expect(rects).toBe(0);
  });
});

test.describe('Score Interaction: Drag-to-Select', () => {
  test('dragging across measures creates a loop', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    const m1 = await getMeasureCenter(page, 1);
    const m4 = await getMeasureCenter(page, 4);
    if (!m1 || !m4) { test.skip(); return; }

    await page.mouse.move(m1.x, m1.y);
    await page.mouse.down();
    await page.mouse.move(m4.x, m4.y, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const loop = await page.evaluate(() => window.pianoApp.getLoopRange());
    expect(loop).not.toBeNull();
    expect(loop!.start).toBeGreaterThanOrEqual(1);
    expect(loop!.end).toBeGreaterThanOrEqual(3);
  });

  test('selection visual appears during drag', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    const m2 = await getMeasureCenter(page, 2);
    const m5 = await getMeasureCenter(page, 5);
    if (!m2 || !m5) { test.skip(); return; }

    await page.mouse.move(m2.x, m2.y);
    await page.mouse.down();
    await page.mouse.move(m5.x, m5.y, { steps: 5 });
    await page.waitForTimeout(100);

    const rects = await page.locator('.score-selection-rect').count();
    expect(rects).toBeGreaterThan(0);

    await page.mouse.up();
  });

  test('selection label shows measure range', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    const m1 = await getMeasureCenter(page, 1);
    const m5 = await getMeasureCenter(page, 5);
    if (!m1 || !m5) { test.skip(); return; }

    await page.mouse.move(m1.x, m1.y);
    await page.mouse.down();
    await page.mouse.move(m5.x, m5.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    const label = page.locator('.score-selection-label');
    await expect(label).toBeVisible();
    const text = await label.textContent();
    expect(text).toMatch(/Measures/);
  });
});

test.describe('Score Interaction: Practice with Selection', () => {
  test('selecting measures and starting practice uses the loop', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    const m1 = await getMeasureCenter(page, 1);
    const m3 = await getMeasureCenter(page, 3);
    if (!m1 || !m3) { test.skip(); return; }

    await page.mouse.move(m1.x, m1.y);
    await page.mouse.down();
    await page.mouse.move(m3.x, m3.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    const fullLength = await page.evaluate(() => window.pianoApp.getNoteTimeline().length);
    expect(state.totalNotes).toBeLessThan(fullLength);
    expect(state.totalNotes).toBeGreaterThan(0);
  });
});
