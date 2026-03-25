import { test, expect } from '@playwright/test';
import { PRELOADED_SONGS } from '../../src/types';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

// Test every preloaded song loads and produces a valid timeline
for (const song of PRELOADED_SONGS) {
  test(`loads and analyzes: ${song.title}`, async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Load the song
    await page.evaluate(async (url: string) => {
      await window.pianoApp.loadSong(url);
    }, song.url);

    // Wait for OSMD to render
    await page.waitForSelector('#score-container svg', { timeout: 20000 });

    // Verify timeline has notes
    const timelineInfo = await page.evaluate(() => {
      const timeline = window.pianoApp.getNoteTimeline();
      return {
        eventCount: timeline.length,
        firstNoteMidi: timeline[0]?.notes[0]?.midi ?? -1,
        firstNoteStaff: timeline[0]?.notes[0]?.staff ?? -1,
        hasRightHand: timeline.some(e => e.notes.some(n => n.staff === 1)),
        hasLeftHand: timeline.some(e => e.notes.some(n => n.staff === 2)),
        totalMeasures: window.pianoApp.getTotalMeasures(),
      };
    });

    expect(timelineInfo.eventCount).toBeGreaterThan(0);
    expect(timelineInfo.firstNoteMidi).toBeGreaterThan(0);
    expect(timelineInfo.totalMeasures).toBeGreaterThan(0);

    // Verify the song has at least one hand
    expect(timelineInfo.hasRightHand || timelineInfo.hasLeftHand).toBe(true);

    // Verify practice mode works with this song
    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const practiceState = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(practiceState.expectedNotes.length).toBeGreaterThan(0);
    expect(practiceState.totalNotes).toBeGreaterThan(0);

    // Play ALL expected notes to verify input works (handles chords)
    for (const midi of practiceState.expectedNotes) {
      await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
    }

    const afterInput = await page.evaluate(() => window.pianoApp.getPracticeState());
    // Should have advanced past the first position
    expect(afterInput.cursorIndex).toBeGreaterThanOrEqual(1);

    // Stop practice
    await page.evaluate(() => window.pianoApp.stopPractice());

    // Verify hand filtering works
    if (timelineInfo.hasRightHand) {
      const rightOnly = await page.evaluate(() => {
        const a = window.pianoApp.analyzer;
        return a.filterByHand('right').length;
      });
      expect(rightOnly).toBeGreaterThan(0);
      expect(rightOnly).toBeLessThanOrEqual(timelineInfo.eventCount);
    }

    if (timelineInfo.hasLeftHand) {
      const leftOnly = await page.evaluate(() => {
        const a = window.pianoApp.analyzer;
        return a.filterByHand('left').length;
      });
      expect(leftOnly).toBeGreaterThan(0);
      expect(leftOnly).toBeLessThanOrEqual(timelineInfo.eventCount);
    }
  });
}
