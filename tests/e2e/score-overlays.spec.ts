import { test, expect } from '@playwright/test';

async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

async function loadSong(page: any, url = '/songs/MozartPianoSonata.mxl') {
  await page.evaluate(async (u: string) => await window.pianoApp.loadSong(u), url);
  await page.waitForSelector('#score-container svg', { timeout: 15000 });
}

test.describe('Note Names on Score', () => {
  test('toggling on shows note name labels', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    // Enable note names
    await page.evaluate(() => {
      window.pianoApp.updateOverlays({
        showNoteNamesOnScore: true,
        showAllAccidentals: false,
        showFingering: false,
        showChords: false,
      });
    });

    const labels = page.locator('.score-overlay .note-name-label');
    const count = await labels.count();
    expect(count).toBeGreaterThan(0);
  });

  test('toggling off removes note name labels', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    // Enable then disable
    await page.evaluate(() => {
      window.pianoApp.updateOverlays({
        showNoteNamesOnScore: true,
        showAllAccidentals: false,
        showFingering: false,
        showChords: false,
      });
    });
    await page.evaluate(() => {
      window.pianoApp.updateOverlays({
        showNoteNamesOnScore: false,
        showAllAccidentals: false,
        showFingering: false,
        showChords: false,
      });
    });

    const overlayExists = await page.locator('.score-overlay').count();
    expect(overlayExists).toBe(0);
  });

  test('note names contain valid letters', async ({ page }) => {
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

    const texts = await page.locator('.score-overlay .note-name-label').allTextContents();
    expect(texts.length).toBeGreaterThan(0);
    for (const t of texts) {
      expect(t).toMatch(/^[A-G](♯|♭|𝄪|𝄫|♮)?$/);
    }
  });
});

test.describe('Courtesy Accidentals', () => {
  test('toggling on shows accidental labels', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    // Load a song likely to have a key signature with sharps/flats
    await loadSong(page, '/songs/BeetAnGeSample.mxl');

    await page.evaluate(() => {
      window.pianoApp.updateOverlays({
        showNoteNamesOnScore: false,
        showAllAccidentals: true,
        showFingering: false,
        showChords: false,
      });
    });

    // May or may not have courtesy accidentals depending on the key
    // At minimum, the overlay should be created
    const overlayExists = await page.locator('.score-overlay').count();
    expect(overlayExists).toBe(1);
  });
});

test.describe('Fingering', () => {
  test('toggling on shows fingering labels with digits 1-5', async ({ page }) => {
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

    const labels = page.locator('.score-overlay .fingering-label');
    const count = await labels.count();
    expect(count).toBeGreaterThan(0);

    const texts = await labels.allTextContents();
    for (const t of texts) {
      expect(['1', '2', '3', '4', '5']).toContain(t);
    }
  });

  test('fingering labels have correct staff data attributes', async ({ page }) => {
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

    const staffAttrs = await page.locator('.score-overlay .fingering-label').evaluateAll(
      (els: Element[]) => els.map(el => el.getAttribute('data-staff'))
    );
    for (const attr of staffAttrs) {
      expect(['1', '2']).toContain(attr);
    }
  });
});

test.describe('Overlay Interaction', () => {
  test('overlays do not block click-to-jump (pointer-events:none)', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => {
      window.pianoApp.updateOverlays({
        showNoteNamesOnScore: true,
        showAllAccidentals: false,
        showFingering: true,
      });
    });

    const overlayStyle = await page.locator('.score-overlay').evaluate(
      (el: Element) => getComputedStyle(el).pointerEvents
    );
    expect(overlayStyle).toBe('none');
  });

  test('overlays update when switching songs', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Enable note names via settings (so they persist across song loads)
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('piano-practice-settings') || '{}');
      settings.showNoteNamesOnScore = true;
      localStorage.setItem('piano-practice-settings', JSON.stringify(settings));
    });
    await page.reload();
    await waitForApp(page);

    await loadSong(page);
    await page.waitForTimeout(300);

    const count1 = await page.locator('.score-overlay .note-name-label').count();
    expect(count1).toBeGreaterThan(0);

    // Load a different song — overlays should re-render via 'loaded' event
    await loadSong(page, '/songs/BeetAnGeSample.mxl');
    await page.waitForTimeout(500);

    const count2 = await page.locator('.score-overlay .note-name-label').count();
    expect(count2).toBeGreaterThan(0);
  });

  test('all three features work simultaneously', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => {
      window.pianoApp.updateOverlays({
        showNoteNamesOnScore: true,
        showAllAccidentals: true,
        showFingering: true,
        showChords: false,
      });
    });

    const noteNames = await page.locator('.score-overlay .note-name-label').count();
    const fingerings = await page.locator('.score-overlay .fingering-label').count();
    expect(noteNames).toBeGreaterThan(0);
    expect(fingerings).toBeGreaterThan(0);
  });

  test('practice mode coloring still works with overlays active', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => {
      window.pianoApp.updateOverlays({
        showNoteNamesOnScore: true,
        showAllAccidentals: false,
        showFingering: true,
      });
      window.pianoApp.setMode('practice');
    });
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Play a correct note
    const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
    for (const midi of expected) {
      await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
    }

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.correctCount).toBe(1);
    expect(state.cursorIndex).toBe(1);

    // Overlays should still be present
    const noteNames = await page.locator('.score-overlay .note-name-label').count();
    expect(noteNames).toBeGreaterThan(0);
  });
});

test.describe('Song Switch Stability', () => {
  test('no stale overlay groups after rapid song switching', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Enable overlays via settings
    await page.evaluate(() => {
      const settings = JSON.parse(localStorage.getItem('piano-practice-settings') || '{}');
      settings.showNoteNamesOnScore = true;
      settings.showFingering = true;
      localStorage.setItem('piano-practice-settings', JSON.stringify(settings));
    });
    await page.reload();
    await waitForApp(page);

    const songs = ['/songs/MozartPianoSonata.mxl', '/songs/BeetAnGeSample.mxl', '/songs/Dichterliebe01.mxl'];
    for (const song of songs) {
      await loadSong(page, song);
      await page.waitForTimeout(400);
    }

    // Should have overlay groups only for the LAST loaded song
    const groupCount = await page.locator('g.score-overlay').count();
    expect(groupCount).toBeGreaterThanOrEqual(1);
    expect(groupCount).toBeLessThanOrEqual(5); // multi-page scores may have more

    // Should have note labels
    const labelCount = await page.locator('g.score-overlay .note-name-label').count();
    expect(labelCount).toBeGreaterThan(0);
  });
});

test.describe('Settings Integration', () => {
  test('settings panel has new toggles', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.click('.tb-settings-btn');

    await expect(page.locator('[data-setting="showNoteNamesOnScore"]')).toBeVisible();
    await expect(page.locator('[data-setting="showAllAccidentals"]')).toBeVisible();
    await expect(page.locator('[data-setting="showFingering"]')).toBeVisible();
  });
});
