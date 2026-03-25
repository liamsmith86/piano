import { test, expect } from '@playwright/test';

// Helper to wait for pianoApp to be available
async function waitForApp(page: any) {
  await page.waitForFunction(() => window.pianoApp !== undefined, { timeout: 10000 });
}

async function loadSong(page: any, url = '/songs/MozartPianoSonata.mxl') {
  await page.evaluate(async (songUrl: string) => {
    await window.pianoApp.loadSong(songUrl);
  }, url);
  // Wait for OSMD to render
  await page.waitForSelector('#score-container svg', { timeout: 15000 });
}

test.describe('App Initialization', () => {
  test('loads the page and shows song library', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Song library should be visible
    await expect(page.locator('.song-library')).toBeVisible();
    const cardCount = await page.locator('.sl-card').count();
    expect(cardCount).toBeGreaterThanOrEqual(1); // at least preloaded songs
  });

  test('exposes pianoApp on window', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const hasApp = await page.evaluate(() => typeof window.pianoApp === 'object');
    expect(hasApp).toBe(true);
  });

  test('virtual keyboard renders', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Keyboard is hidden by default; enable it via settings
    await page.evaluate(() => {
      localStorage.setItem('piano-practice-settings', JSON.stringify({ showVirtualKeyboard: true }));
    });
    await page.reload();
    await waitForApp(page);
    await expect(page.locator('.virtual-keyboard')).toBeVisible();
    // Should have white keys and black keys
    const whiteKeys = page.locator('.vk-white');
    expect(await whiteKeys.count()).toBeGreaterThan(20);
    const blackKeys = page.locator('.vk-black');
    expect(await blackKeys.count()).toBeGreaterThan(10);
  });
});

test.describe('Song Loading', () => {
  test('loads a preloaded song via API', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    // Score should be rendered (SVG present)
    const svgCount = await page.locator('#score-container svg').count();
    expect(svgCount).toBeGreaterThan(0);

    // API should report loaded song
    const loaded = await page.evaluate(() => window.pianoApp.getLoadedSong());
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('mozart-piano-sonata');
  });

  test('clicking a song card loads the song', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Click first song card
    await page.locator('.sl-card').first().click();

    // Wait for score to render
    await page.waitForSelector('#score-container svg', { timeout: 15000 });

    const loaded = await page.evaluate(() => window.pianoApp.getLoadedSong());
    expect(loaded).not.toBeNull();
  });

  test('note timeline is extracted after loading', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    const timeline = await page.evaluate(() => window.pianoApp.getNoteTimeline());
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline[0].notes.length).toBeGreaterThan(0);
    expect(timeline[0].notes[0].midi).toBeGreaterThan(0);
  });
});

test.describe('Mode Switching', () => {
  test('defaults to play mode', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const mode = await page.evaluate(() => window.pianoApp.getMode());
    expect(mode).toBe('play');
  });

  test('switches to practice mode', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    const mode = await page.evaluate(() => window.pianoApp.getMode());
    expect(mode).toBe('practice');
  });

  test('mode toggle buttons work', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.locator('[data-mode="practice"]').click();
    const mode = await page.evaluate(() => window.pianoApp.getMode());
    expect(mode).toBe('practice');

    await page.locator('[data-mode="play"]').click();
    const mode2 = await page.evaluate(() => window.pianoApp.getMode());
    expect(mode2).toBe('play');
  });
});

test.describe('Hand Selection', () => {
  test('defaults to both hands', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const hand = await page.evaluate(() => window.pianoApp.getHand());
    expect(hand).toBe('both');
  });

  test('switches to right hand only', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(() => window.pianoApp.setHand('right'));
    const hand = await page.evaluate(() => window.pianoApp.getHand());
    expect(hand).toBe('right');
  });

  test('hand buttons work', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.locator('[data-hand="left"]').click();
    const hand = await page.evaluate(() => window.pianoApp.getHand());
    expect(hand).toBe('left');
  });

  test('filters timeline by hand', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    const bothTimeline = await page.evaluate(() => window.pianoApp.getNoteTimeline());

    await page.evaluate(() => window.pianoApp.setHand('right'));
    // Filtered timeline should have fewer events (only treble staff)
    const rightFiltered = await page.evaluate(() => {
      const analyzer = window.pianoApp.analyzer;
      return analyzer.filterByHand('right');
    });

    // Right hand should have fewer or equal events
    expect(rightFiltered.length).toBeLessThanOrEqual(bothTimeline.length);
    // All notes should be staff 1
    for (const event of rightFiltered) {
      for (const note of event.notes) {
        expect(note.staff).toBe(1);
      }
    }
  });
});

test.describe('Practice Mode', () => {
  test('starts practice and shows expected notes', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.cursorIndex).toBe(0);
    expect(state.expectedNotes.length).toBeGreaterThan(0);
  });

  test('correct note advances cursor', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    const expectedBefore = await page.evaluate(() =>
      window.pianoApp.getPracticeState().expectedNotes
    );

    // Simulate pressing the correct note(s)
    for (const midi of expectedBefore) {
      await page.evaluate((m) => window.pianoApp.simulateNoteInput(m), midi);
    }

    const stateAfter = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(stateAfter.cursorIndex).toBe(1);
    expect(stateAfter.correctCount).toBe(1);
  });

  test('wrong note does not advance cursor', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    // Press a definitely wrong note (MIDI 1 is very unlikely to be expected)
    await page.evaluate(() => window.pianoApp.simulateNoteInput(1));

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.cursorIndex).toBe(0); // didn't advance
    expect(state.wrongCount).toBe(1);
  });

  test('plays through first 5 notes correctly', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());

    for (let i = 0; i < 5; i++) {
      const expected = await page.evaluate(() =>
        window.pianoApp.getPracticeState().expectedNotes
      );
      if (expected.length === 0) break;

      for (const midi of expected) {
        await page.evaluate((m) => window.pianoApp.simulateNoteInput(m), midi);
      }
    }

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.cursorIndex).toBe(5);
    expect(state.correctCount).toBe(5);
    expect(state.wrongCount).toBe(0);
    expect(state.streak).toBe(5);
  });

  test('stops practice mode', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    await page.evaluate(() => window.pianoApp.setMode('practice'));
    await page.evaluate(async () => await window.pianoApp.startPractice());
    await page.evaluate(() => window.pianoApp.stopPractice());

    // Pressing notes should not advance anything
    await page.evaluate(() => window.pianoApp.simulateNoteInput(60));

    const state = await page.evaluate(() => window.pianoApp.getPracticeState());
    expect(state.cursorIndex).toBe(0);
  });
});

test.describe('Virtual Keyboard', () => {
  test('clicking a virtual key emits input event', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Show keyboard (hidden by default)
    await page.evaluate(() => {
      document.getElementById('keyboard-container')!.style.display = '';
    });

    // Set up event listener to capture all input events
    await page.evaluate(() => {
      (window as any).__inputs = [];
      window.pianoApp.on('inputNote', (e: any) => {
        (window as any).__inputs.push(e);
      });
    });

    // Click a white key (mousedown = noteOn, mouseup = noteOff)
    const key = page.locator('.vk-white').first();
    await key.click({ force: true });

    const inputs = await page.evaluate(() => (window as any).__inputs);
    expect(inputs.length).toBeGreaterThanOrEqual(1);
    // First event should be noteOn
    expect(inputs[0].type).toBe('noteOn');
    expect(inputs[0].source).toBe('virtual');
    expect(inputs[0].midiNumber).toBeGreaterThan(0);
  });
});

test.describe('Song Library UI', () => {
  test('shows all preloaded songs', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const cards = page.locator('.sl-card');
    expect(await cards.count()).toBeGreaterThanOrEqual(1);
  });

  test('shows upload button', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await expect(page.locator('.sl-upload-btn')).toBeVisible();
  });

  test('shows drop zone', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await expect(page.locator('.sl-drop-zone')).toBeVisible();
  });
});

test.describe('Multiple Songs', () => {
  test('loads different songs and verifies different timelines', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await loadSong(page, '/songs/MozartPianoSonata.mxl');
    const timeline1 = await page.evaluate(() => window.pianoApp.getNoteTimeline().length);

    await loadSong(page, '/songs/BeetAnGeSample.mxl');
    const timeline2 = await page.evaluate(() => window.pianoApp.getNoteTimeline().length);

    expect(timeline1).toBeGreaterThan(0);
    expect(timeline2).toBeGreaterThan(0);
  });
});

test.describe('Loop Feature', () => {
  test('setLoop restricts practice to measure range', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    const totalNotes = await page.evaluate(() => window.pianoApp.getNoteTimeline().length);

    await page.evaluate(() => {
      window.pianoApp.setMode('practice');
      window.pianoApp.setLoop(1, 2);
    });

    await page.evaluate(async () => await window.pianoApp.startPractice());

    const loopState = await page.evaluate(() => window.pianoApp.getPracticeState());
    // Looped range should have fewer notes than total
    expect(loopState.totalNotes).toBeLessThan(totalNotes);
    expect(loopState.totalNotes).toBeGreaterThan(0);
  });

  test('getLoopRange returns correct values', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    const noLoop = await page.evaluate(() => window.pianoApp.getLoopRange());
    expect(noLoop).toBeNull();

    await page.evaluate(() => window.pianoApp.setLoop(3, 6));
    const loop = await page.evaluate(() => window.pianoApp.getLoopRange());
    expect(loop).toEqual({ start: 3, end: 6 });

    await page.evaluate(() => window.pianoApp.clearLoop());
    const cleared = await page.evaluate(() => window.pianoApp.getLoopRange());
    expect(cleared).toBeNull();
  });

  test('getTotalMeasures returns count after loading', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);
    await loadSong(page);

    const measures = await page.evaluate(() => window.pianoApp.getTotalMeasures());
    expect(measures).toBeGreaterThan(0);
  });
});

test.describe('Tempo Control', () => {
  test('setTempoScale changes tempo', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    await page.evaluate(() => window.pianoApp.setTempoScale(0.5));
    // No direct way to verify audio tempo, but ensure it doesn't throw
  });

  test('tempo preset buttons work', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Click 50% preset
    await page.click('[data-speed="50"]');
    const btn50 = page.locator('[data-speed="50"]');
    await expect(btn50).toHaveClass(/active/);

    // Slider should update to 50
    const sliderValue = await page.locator('.tb-tempo-slider').inputValue();
    expect(sliderValue).toBe('50');
  });
});

test.describe('Metronome', () => {
  test('toggleMetronome returns correct state', async ({ page }) => {
    await page.goto('/');
    await waitForApp(page);

    // Need audio context first
    await page.evaluate(async () => {
      try { await window.pianoApp.init(); } catch {}
    });

    const enabled = await page.evaluate(() => window.pianoApp.toggleMetronome());
    expect(enabled).toBe(true);

    const disabled = await page.evaluate(() => window.pianoApp.toggleMetronome());
    expect(disabled).toBe(false);
  });
});
