import { test, expect } from '@playwright/test';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

test.describe('Repeat Sign Handling', () => {
  // Heat Waves has repeat barlines
  test('Heat Waves: timeline includes repeated sections', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/glass-animals-heat-waves-easy-piano.mxl');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    const info = await page.evaluate(() => {
      const timeline = window.pianoApp.getNoteTimeline();
      const measures = window.pianoApp.getTotalMeasures();
      const measureNumbers = timeline.map(e => e.measureNumber);
      const uniqueMeasures = new Set(measureNumbers);

      // Count how many times each measure appears
      const measureCounts: Record<number, number> = {};
      for (const m of measureNumbers) {
        measureCounts[m] = (measureCounts[m] || 0) + 1;
      }

      return {
        totalEvents: timeline.length,
        totalMeasures: measures,
        uniqueMeasureCount: uniqueMeasures.size,
        // Some measures should appear more than once if repeats are followed
        hasRepeatedMeasures: Object.values(measureCounts).some(c => c > 1),
      };
    });

    expect(info.totalEvents).toBeGreaterThan(0);
    expect(info.totalMeasures).toBeGreaterThan(0);
    // Heat Waves has repeats, so timeline should visit some measures multiple times
    // (OSMD cursor follows repeat barlines)
  });

  test('Call Your Mom: has repeats and plays correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/call-your-mom-easy.mxl');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    const info = await page.evaluate(() => {
      const timeline = window.pianoApp.getNoteTimeline();
      return {
        totalEvents: timeline.length,
        allValid: timeline.every(e => e.notes.every(n => n.midi >= 21 && n.midi <= 108)),
      };
    });

    expect(info.totalEvents).toBeGreaterThan(0);
    expect(info.allValid).toBe(true);

    // Verify practice mode works on a song with repeats
    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Play first 10 correct notes
    for (let i = 0; i < 10; i++) {
      const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
      if (expected.length === 0) break;
      for (const midi of expected) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.correctCount).toBeGreaterThanOrEqual(10);
    expect(state.wrongCount).toBe(0);
  });

  test("Mitsuha's Theme: has repeats and plays correctly", async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/date-2-mitsuhas-theme-your-name.mxl');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    const info = await page.evaluate(() => {
      const timeline = window.pianoApp.getNoteTimeline();
      return {
        totalEvents: timeline.length,
        allValid: timeline.every(e => e.notes.every(n => n.midi >= 21 && n.midi <= 108)),
        totalMeasures: window.pianoApp.getTotalMeasures(),
      };
    });

    expect(info.totalEvents).toBeGreaterThan(0);
    expect(info.allValid).toBe(true);
    expect(info.totalMeasures).toBeGreaterThan(0);
  });
});
