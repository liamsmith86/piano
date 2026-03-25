import { test, expect } from '@playwright/test';

test.describe('Full User Journey', () => {
  test('complete practice session from start to finish', async ({ page }) => {
    // 1. Open app
    await page.goto('/');
    await page.waitForFunction(() => window.pianoApp !== undefined);

    // 2. See welcome banner (clear localStorage first)
    await page.evaluate(() => localStorage.removeItem('piano-welcomed'));
    await page.reload();
    await page.waitForSelector('.song-library');
    await expect(page.locator('.sl-welcome')).toBeVisible();

    // 3. Dismiss welcome
    await page.click('.sl-welcome-dismiss');
    await expect(page.locator('.sl-welcome')).not.toBeVisible();

    // 4. See song library with all songs
    const songCount = await page.locator('.sl-card').count();
    expect(songCount).toBeGreaterThanOrEqual(1);

    // 5. Click a song to load it
    await page.locator('.sl-card').first().click();
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    // 6. Verify score is visible
    await expect(page.locator('#score-container')).toBeVisible();
    await expect(page.locator('#library-container')).not.toBeVisible();

    // 7. Song title appears in toolbar
    const title = await page.locator('.tb-song-title').textContent();
    expect(title!.length).toBeGreaterThan(0);

    // 8. Switch to practice mode via UI
    await page.click('[data-mode="practice"]');
    const mode = await page.evaluate(() => window.pianoApp.getMode());
    expect(mode).toBe('practice');

    // 9. See practice stats bar
    await expect(page.locator('.tb-stats')).toBeVisible();

    // 10. Start practice (via API to skip count-in in test)
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // 11. Play some wrong notes then correct ones
    await page.evaluate(() => window.pianoApp.simulateNoteInput(30)); // wrong

    let state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.wrongCount).toBe(1);
    expect(state.cursorIndex).toBe(0); // didn't advance

    // 12. Play correct notes to advance
    for (let i = 0; i < 5; i++) {
      const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
      if (expected.length === 0) break;
      for (const midi of expected) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.correctCount).toBe(5);
    expect(state.cursorIndex).toBe(5);

    // 13. Check accuracy in toolbar shows correctly
    const accuracyText = await page.locator('.tb-accuracy').textContent();
    expect(accuracyText).toContain('%');

    // 14. Stop practice
    await page.evaluate(() => window.pianoApp.stopPractice());

    // 15. Switch to right hand only
    await page.click('[data-hand="right"]');
    const hand = await page.evaluate(() => window.pianoApp.getHand());
    expect(hand).toBe('right');

    // 16. Verify CSS class for hand dimming
    await expect(page.locator('#score-container')).toHaveClass(/hand-right/);

    // 17. Change tempo
    await page.click('[data-speed="50"]');
    const sliderVal = await page.locator('.tb-tempo-slider').inputValue();
    expect(sliderVal).toBe('50');

    // 18. Open settings
    await page.click('.tb-settings-btn');
    await expect(page.locator('.settings-panel')).toBeVisible();

    // 19. Toggle a setting
    const toggle = page.locator('[data-setting="showNextNote"]');
    const wasChecked = await toggle.isChecked();
    await toggle.click();
    expect(await toggle.isChecked()).toBe(!wasChecked);

    // 20. Close settings
    await page.click('.sp-close');
    await expect(page.locator('.settings-panel')).not.toBeVisible();

    // 21. Open shortcuts help
    await page.keyboard.press('?');
    await expect(page.locator('.shortcuts-panel')).toBeVisible();
    await page.click('.sh-close');

    // 22. Go back to library
    await page.click('.tb-library-btn');
    await expect(page.locator('#library-container')).toBeVisible();

    // 23. Library should still have songs
    expect(await page.locator('.sl-card').count()).toBeGreaterThanOrEqual(1);
  });

  test('switch between play and practice mode seamlessly', async ({ page }) => {
    await page.goto('/');
    await page.waitForFunction(() => window.pianoApp !== undefined);

    // Load song
    await page.evaluate(async () => {
      await window.pianoApp.loadSong('/songs/MozartPianoSonata.mxl');
    });
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    // Start in play mode
    const playState = await page.evaluate(() => window.pianoApp.getPlaybackState());
    expect(playState).toBe('stopped');

    // Switch to practice
    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Play a few notes
    for (let i = 0; i < 3; i++) {
      const expected = await page.evaluate(() => window.pianoApp.getPracticeState().expectedNotes);
      for (const midi of expected) {
        await page.evaluate((m: number) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    // Stop and switch back to play mode
    await page.evaluate(() => {
      window.pianoApp.stopPractice();
      window.pianoApp.setMode('play');
    });

    const mode = await page.evaluate(() => window.pianoApp.getMode());
    expect(mode).toBe('play');
  });
});
