import { test, expect } from '@playwright/test';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

async function loadSong(page: any, url: string) {
  await page.evaluate(async (songUrl: string) => {
    await window.pianoApp.loadSong(songUrl);
  }, url);
  await page.waitForSelector('#score-container svg', { timeout: 15000 });
}

test.describe('Deep Practice Mode Testing', () => {
  test('plays through entire Bella Ciao (Easy) correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/bella-ciaoeasy-version.mxl');

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const totalNotes = await page.evaluate(() => window.pianoApp.getPracticeState().totalNotes);
    expect(totalNotes).toBeGreaterThan(0);

    // Step through every note
    let noteCount = 0;
    const maxNotes = totalNotes; // go through ALL notes
    while (noteCount < maxNotes) {
      const state = await page.evaluate(() => window.pianoApp.getPracticeState());
      if (state.expectedNotes.length === 0) break;

      // Play all expected notes (handles chords)
      for (const midi of state.expectedNotes) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
      noteCount++;
    }

    // Verify we completed the piece
    const finalState = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(finalState.correctCount).toBe(totalNotes);
    expect(finalState.wrongCount).toBe(0);
    const accuracy = await page.evaluate(() => window.pianoApp.practiceMode.getAccuracy());
    expect(accuracy).toBe(100);
  });

  test('verifies notes are valid MIDI range throughout song', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/bella-ciaoeasy-version.mxl');

    const timeline = await page.evaluate(() => {
      const events = window.pianoApp.getNoteTimeline();
      return events.map(e => ({
        index: e.index,
        measure: e.measureNumber,
        notes: e.notes.map(n => ({ midi: n.midi, staff: n.staff, name: n.name })),
        timestamp: e.timestamp,
      }));
    });

    // All notes should be in valid piano range (21-108)
    for (const event of timeline) {
      for (const note of event.notes) {
        expect(note.midi).toBeGreaterThanOrEqual(21);
        expect(note.midi).toBeLessThanOrEqual(108);
        expect(note.staff === 1 || note.staff === 2).toBe(true);
        expect(note.name.length).toBeGreaterThan(0);
      }
      // Timestamps should be monotonically increasing
      expect(event.timestamp).toBeGreaterThanOrEqual(0);
    }

    // Check timestamps are ordered
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].timestamp).toBeGreaterThanOrEqual(timeline[i - 1].timestamp);
    }
  });

  test('hand filtering preserves correct staff assignment', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/bella-ciaoeasy-version.mxl');

    const result = await page.evaluate(() => {
      const analyzer = window.pianoApp.analyzer;
      const allEvents = analyzer.getTimeline();
      const rightEvents = analyzer.filterByHand('right');
      const leftEvents = analyzer.filterByHand('left');

      return {
        total: allEvents.length,
        right: rightEvents.length,
        left: leftEvents.length,
        rightAllStaff1: rightEvents.every(e => e.notes.every(n => n.staff === 1)),
        leftAllStaff2: leftEvents.every(e => e.notes.every(n => n.staff === 2)),
      };
    });

    expect(result.total).toBeGreaterThan(0);
    expect(result.right + result.left).toBeLessThanOrEqual(result.total * 2); // some events may have both
    expect(result.rightAllStaff1).toBe(true);
    expect(result.leftAllStaff2).toBe(true);
  });

  test('plays through with right hand only', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/bella-ciaoeasy-version.mxl');

    await page.evaluate(() => {
      window.pianoApp.setHand('right');
      window.pianoApp.setMode('practice');
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.totalNotes).toBeGreaterThan(0);

    // All expected notes should be from staff 1
    const firstExpected = await page.evaluate(() => {
      const timeline = window.pianoApp.analyzer.filterByHand('right');
      return timeline[0]?.notes.map(n => n.staff) ?? [];
    });
    expect(firstExpected.every((s: number) => s === 1)).toBe(true);

    // Play first 10 notes correctly
    for (let i = 0; i < 10; i++) {
      const s = await page.evaluate(() => window.pianoApp.getPracticeState());
      if (s.expectedNotes.length === 0) break;
      for (const midi of s.expectedNotes) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    const after = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(after.correctCount).toBeGreaterThanOrEqual(10);
    expect(after.wrongCount).toBe(0);
  });

  test('loop mode repeats the section', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/bella-ciaoeasy-version.mxl');

    // Set up loop on measures 1-2
    await page.evaluate(() => {
      window.pianoApp.setMode('practice');
      window.pianoApp.setLoop(1, 2);
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const loopState = await page.evaluate(() => window.pianoApp.getPracticeState());
    const notesInLoop = loopState.totalNotes;
    expect(notesInLoop).toBeGreaterThan(0);
    expect(notesInLoop).toBeLessThan(
      await page.evaluate(() => window.pianoApp.getNoteTimeline().length)
    );

    // Play through the loop
    for (let i = 0; i < notesInLoop; i++) {
      const s = await page.evaluate(() => window.pianoApp.getPracticeState());
      if (s.expectedNotes.length === 0) break;
      for (const midi of s.expectedNotes) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    // Should have looped back to the beginning, not ended
    const afterLoop = await page.evaluate(() => ({
      active: window.pianoApp.practiceMode.isActive(),
      cursorIndex: window.pianoApp.getPracticeState().cursorIndex,
    }));
    expect(afterLoop.active).toBe(true);
    expect(afterLoop.cursorIndex).toBe(0); // looped back
  });

  test('wrong notes tracked correctly across multiple attempts', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/bella-ciaoeasy-version.mxl');

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Press wrong notes first
    await page.evaluate(() => window.pianoApp.simulateNoteInput(1)); // very wrong
    await page.evaluate(() => window.pianoApp.simulateNoteInput(2)); // very wrong
    await page.evaluate(() => window.pianoApp.simulateNoteInput(3)); // very wrong

    let state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.wrongCount).toBe(3);
    expect(state.cursorIndex).toBe(0); // didn't advance

    // Now play correct
    for (const midi of state.expectedNotes) {
      await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
    }

    state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.cursorIndex).toBe(1); // advanced
    expect(state.correctCount).toBe(1);
    expect(state.wrongCount).toBe(3);
    // Accuracy: 1 correct / (1+3) total = 25%
    const accuracy = await page.evaluate(() => window.pianoApp.practiceMode.getAccuracy());
    expect(accuracy).toBe(25);
  });
});

test.describe('Multiple Song Deep Tests', () => {
  const songs = [
    { url: '/songs/roaring-tides.mxl', name: 'Roaring Tides' },
    { url: '/songs/changes-xxxtentacion.mxl', name: 'Changes' },
    { url: '/songs/runaway-kanye-west.mxl', name: 'Runaway' },
  ];

  for (const song of songs) {
    test(`${song.name}: valid timeline and first 20 notes play correctly`, async ({ page }) => {
      await page.goto('/');
      await waitForApp(page);
      await loadSong(page, song.url);

      // Verify valid timeline
      const info = await page.evaluate(() => {
        const t = window.pianoApp.getNoteTimeline();
        return {
          length: t.length,
          allValid: t.every(e => e.notes.every(n => n.midi >= 21 && n.midi <= 108)),
          hasNotes: t.every(e => e.notes.length > 0),
        };
      });
      expect(info.length).toBeGreaterThan(0);
      expect(info.allValid).toBe(true);
      expect(info.hasNotes).toBe(true);

      // Practice first 20 notes
      await page.evaluate(() => window.pianoApp.setMode('practice'));
      await page.evaluate(async () => await window.pianoApp.startPractice());

      for (let i = 0; i < 20; i++) {
        const s = await page.evaluate(() => window.pianoApp.getPracticeState());
        if (s.expectedNotes.length === 0) break;
        for (const midi of s.expectedNotes) {
          await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
        }
      }

      const finalState = await page.evaluate(() => window.pianoApp.getPracticeState());
      expect(finalState.correctCount).toBeGreaterThanOrEqual(
        Math.min(20, finalState.totalNotes)
      );
      expect(finalState.wrongCount).toBe(0);
    });
  }
});

test.describe('Measure Stats Tracking', () => {
  test('tracks errors per measure correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/bella-ciaoeasy-version.mxl');

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Play 3 wrong notes first, then the correct one
    await page.evaluate(() => window.pianoApp.simulateNoteInput(1)); // wrong
    await page.evaluate(() => window.pianoApp.simulateNoteInput(2)); // wrong

    // Now play correct
    const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
    for (const midi of expected) {
      await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
    }

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.measureStats.length).toBeGreaterThan(0);

    // First measure should have errors
    const m1 = state.measureStats.find((m: any) => m.measure === 1);
    expect(m1).toBeDefined();
    expect(m1!.wrong).toBeGreaterThanOrEqual(2);
    expect(m1!.correct).toBeGreaterThanOrEqual(1);
  });

  test('measure stats are empty with perfect practice', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/bella-ciaoeasy-version.mxl');

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Play 5 correct notes
    for (let i = 0; i < 5; i++) {
      const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
      if (expected.length === 0) break;
      for (const midi of expected) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    // All measures should have 0 wrong
    for (const m of state.measureStats) {
      expect(m.wrong).toBe(0);
    }
  });
});
