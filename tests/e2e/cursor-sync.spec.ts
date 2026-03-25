import { test, expect } from '@playwright/test';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

async function loadSong(page: any, url: string) {
  await page.evaluate(async (u: string) => await window.pianoApp.loadSong(u), url);
  await page.waitForSelector('#score-container svg', { timeout: 15000 });
}

test.describe('Cursor Sync Integrity', () => {
  test('right-hand practice advances cursor correctly through the full piece', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/MozartPianoSonata.mxl');

    await page.evaluate(() => {
      window.pianoApp.setHand('right');
      window.pianoApp.setMode('practice');
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const totalNotes = await page.evaluate(() => window.pianoApp.getPracticeState().totalNotes);
    expect(totalNotes).toBeGreaterThan(0);

    // Play through all right-hand notes
    for (let i = 0; i < totalNotes; i++) {
      const state = await page.evaluate(() => window.pianoApp.getPracticeState());
      if (state.expectedNotes.length === 0) break;
      for (const midi of state.expectedNotes) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    // Should have completed with 100% accuracy
    const finalState = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(finalState.correctCount).toBe(totalNotes);
    expect(finalState.wrongCount).toBe(0);
  });

  test('left-hand practice advances cursor correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/MozartPianoSonata.mxl');

    await page.evaluate(() => {
      window.pianoApp.setHand('left');
      window.pianoApp.setMode('practice');
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const totalNotes = await page.evaluate(() => window.pianoApp.getPracticeState().totalNotes);
    expect(totalNotes).toBeGreaterThan(0);

    // Play through first 10 left-hand notes
    const limit = Math.min(10, totalNotes);
    for (let i = 0; i < limit; i++) {
      const state = await page.evaluate(() => window.pianoApp.getPracticeState());
      if (state.expectedNotes.length === 0) break;
      for (const midi of state.expectedNotes) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    const finalState = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(finalState.correctCount).toBe(limit);
    expect(finalState.wrongCount).toBe(0);
  });

  test('Schubert Ave Maria: full playthrough preserves timing', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/SchbAvMaSample.mxl');

    // Verify timestamps are monotonic (the repeat bug fix)
    const monotonic = await page.evaluate(() => {
      const timeline = window.pianoApp.getNoteTimeline();
      for (let i = 1; i < timeline.length; i++) {
        if (timeline[i].timestamp < timeline[i-1].timestamp - 0.001) {
          return { ok: false, issue: `Event ${i}: ${timeline[i].timestamp} < ${timeline[i-1].timestamp}` };
        }
      }
      return { ok: true, issue: '' };
    });
    expect(monotonic.ok).toBe(true);

    // Practice first 30 notes including repeat section
    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    for (let i = 0; i < 30; i++) {
      const state = await page.evaluate(() => window.pianoApp.getPracticeState());
      if (state.expectedNotes.length === 0) break;
      for (const midi of state.expectedNotes) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    const finalState = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(finalState.correctCount).toBe(30);
    expect(finalState.wrongCount).toBe(0);
  });

  test('switching hands mid-practice resets correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/MozartPianoSonata.mxl');

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Play 3 notes
    for (let i = 0; i < 3; i++) {
      const state = await page.evaluate(() => window.pianoApp.getPracticeState());
      for (const midi of state.expectedNotes) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    // Switch to right hand
    await page.evaluate(() => window.pianoApp.setHand('right'));

    // Cursor should reset to 0
    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.cursorIndex).toBe(0);

    // Should still be able to play
    expect(state.expectedNotes.length).toBeGreaterThan(0);
    for (const midi of state.expectedNotes) {
      await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
    }
    const after = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(after.cursorIndex).toBe(1);
  });
});
