import { test, expect } from '@playwright/test';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

async function loadSong(page: any, url = '/songs/MozartPianoSonata.mxl') {
  await page.evaluate(async (songUrl: string) => {
    await window.pianoApp.loadSong(songUrl);
  }, url);
  await page.waitForSelector('#score-container svg', { timeout: 15000 });
  // Small delay for OSMD rendering to stabilize
  await page.waitForTimeout(500);
}

test.describe('Visual Regression: Score Rendering', () => {
  test('score renders consistently after loading', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    const score = page.locator('#score-container');
    await expect(score).toHaveScreenshot('score-mozart-loaded.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('score renders different song consistently', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page, '/songs/BeetAnGeSample.mxl');

    const score = page.locator('#score-container');
    await expect(score).toHaveScreenshot('score-beethoven-loaded.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe('Visual Regression: Note Coloring', () => {
  test('blue highlight on current notes in practice mode', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());
    await page.waitForTimeout(300);

    const score = page.locator('#score-container');
    await expect(score).toHaveScreenshot('practice-blue-highlight.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('green notes after correct input', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Play 3 notes correctly
    for (let i = 0; i < 3; i++) {
      const expected = await page.evaluate(() =>
        window.pianoApp.getPracticeState().expectedNotes
      );
      for (const midi of expected) {
        await page.evaluate((m) => window.pianoApp.simulateNoteInput(m), midi);
      }
      await page.waitForTimeout(100);
    }

    const score = page.locator('#score-container');
    await expect(score).toHaveScreenshot('practice-green-notes.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe('Visual Regression: Overlays', () => {
  test('note names overlay on score', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => {
      window.pianoApp.updateOverlays({
        showNoteNamesOnScore: true,
        showAllAccidentals: false,
        showFingering: false,
        showChords: false,
      });
    });
    await page.waitForTimeout(300);

    const score = page.locator('#score-container');
    await expect(score).toHaveScreenshot('overlay-note-names.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('fingering overlay on score', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => {
      window.pianoApp.updateOverlays({
        showNoteNamesOnScore: false,
        showAllAccidentals: false,
        showFingering: true,
        showChords: false,
      });
    });
    await page.waitForTimeout(300);

    const score = page.locator('#score-container');
    await expect(score).toHaveScreenshot('overlay-fingering.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('chord symbols overlay on score', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => {
      window.pianoApp.updateOverlays({
        showNoteNamesOnScore: false,
        showAllAccidentals: false,
        showFingering: false,
        showChords: true,
      });
    });
    await page.waitForTimeout(300);

    const score = page.locator('#score-container');
    await expect(score).toHaveScreenshot('overlay-chord-symbols.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('all overlays combined', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => {
      window.pianoApp.updateOverlays({
        showNoteNamesOnScore: true,
        showAllAccidentals: true,
        showFingering: true,
        showChords: true,
      });
    });
    await page.waitForTimeout(300);

    const score = page.locator('#score-container');
    await expect(score).toHaveScreenshot('overlay-all-combined.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe('Visual Regression: Virtual Keyboard', () => {
  test('virtual keyboard with highlighted keys', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Enable virtual keyboard via settings before loading song
    await page.evaluate(() => {
      localStorage.setItem('piano-practice-settings', JSON.stringify({ showVirtualKeyboard: true, highlightExpectedKeys: true }));
    });
    await page.reload();
    await waitForApp(page);

    await loadSong(page);

    // Start practice mode which auto-shows keyboard
    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());
    await page.waitForTimeout(500);

    const keyboard = page.locator('#keyboard-container');
    await expect(keyboard).toHaveScreenshot('keyboard-highlighted.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe('Visual Regression: Song Library', () => {
  test('song library grid layout', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await page.waitForTimeout(300);

    const library = page.locator('#library-container');
    await expect(library).toHaveScreenshot('song-library.png', {
      maxDiffPixelRatio: 0.02,
    });
  });
});

test.describe('Visual Regression: Wrong Note Marker', () => {
  test('wrong note marker appears on staff', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Play a wrong note
    await page.evaluate(() => window.pianoApp.simulateNoteInput(30));
    await page.waitForTimeout(200);

    const score = page.locator('#score-container');
    await expect(score).toHaveScreenshot('wrong-note-marker.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});

test.describe('Visual Regression: Hand Selection', () => {
  test('right hand dimmed when left hand selected', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => window.pianoApp.setHand('left'));
    await page.waitForTimeout(300);

    const score = page.locator('#score-container');
    await expect(score).toHaveScreenshot('hand-left-selected.png', {
      maxDiffPixelRatio: 0.01,
    });
  });

  test('left hand dimmed when right hand selected', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => window.pianoApp.setHand('right'));
    await page.waitForTimeout(300);

    const score = page.locator('#score-container');
    await expect(score).toHaveScreenshot('hand-right-selected.png', {
      maxDiffPixelRatio: 0.01,
    });
  });
});
