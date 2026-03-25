import { PianoApp } from './api';
import { SongLibrary } from './ui/SongLibrary';
import { Toolbar } from './ui/Toolbar';
import { PracticeComplete } from './ui/PracticeComplete';
import { CountIn } from './ui/CountIn';
import { NoteDisplay } from './ui/NoteDisplay';
import { SettingsPanel } from './ui/Settings';
import { ShortcutsHelp } from './ui/ShortcutsHelp';
import type { AppSettings } from './ui/Settings';
import { addSession } from './progress';
import './style.css';

declare global {
  interface Window {
    pianoApp: PianoApp;
  }
}

async function main(): Promise<void> {
  const appEl = document.getElementById('app')!;
  const scoreContainer = document.getElementById('score-container')!;
  const keyboardContainer = document.getElementById('keyboard-container')!;
  const toolbarContainer = document.getElementById('toolbar-container')!;
  const libraryContainer = document.getElementById('library-container')!;

  const app = new PianoApp(scoreContainer, keyboardContainer);
  window.pianoApp = app;

  const toolbar = new Toolbar(app, toolbarContainer);
  toolbar.render();

  const library = new SongLibrary(app, libraryContainer);
  await library.render();
  library.show();

  const noteDisplayContainer = document.getElementById('note-display-container')!;
  const practiceComplete = new PracticeComplete(appEl);
  const countIn = new CountIn(appEl);
  const noteDisplay = new NoteDisplay(noteDisplayContainer);
  const settingsPanel = new SettingsPanel(appEl);
  const shortcutsHelp = new ShortcutsHelp(appEl);

  // Keyboard visibility: hidden by default, auto-shows in practice mode
  const updateKeyboardVisibility = () => {
    const settings = settingsPanel.getSettings();
    const inPractice = app.getMode() === 'practice' && app.practiceMode.isActive();
    const visible = settings.showVirtualKeyboard || inPractice;
    keyboardContainer.style.display = visible ? '' : 'none';
  };

  // Apply settings
  const applySettings = (settings: AppSettings) => {
    app.virtualKeyboard?.setShowNoteNames(settings.showNoteNames);
    app.setAccompaniment(settings.accompaniment);
    app.setAutoAdvance(settings.autoAdvance ? settings.autoAdvanceSeconds * 1000 : 0);
    updateKeyboardVisibility();
    app.updateOverlays({
      showNoteNamesOnScore: settings.showNoteNamesOnScore,
      showAllAccidentals: settings.showAllAccidentals,
      showFingering: settings.showFingering,
    });
  };

  settingsPanel.setOnChange(applySettings);
  applySettings(settingsPanel.getSettings());
  // Hide keyboard by default (setting defaults to false)
  updateKeyboardVisibility();

  toolbar.setOnShowSettings(() => {
    if (settingsPanel.isVisible()) {
      settingsPanel.hide();
    } else {
      settingsPanel.show();
    }
  });

  // Wrap play/practice start with count-in
  const ensureAudio = async () => {
    if (!app.audio.ready) {
      await app.init();
    }
  };

  const playWithCountIn = async () => {
    if (!app.getLoadedSong()) return;
    try {
      await ensureAudio();
      const settings = settingsPanel.getSettings();
      if (app.audio.ready && settings.countIn) {
        await app.audio.countIn(settings.countInBeats, (beat) => countIn.show(beat, settings.countInBeats));
        countIn.hide();
      }
      await app.play();
    } catch (err) {
      console.error('Playback error:', err);
      countIn.hide();
    }
  };

  const practiceWithCountIn = async () => {
    if (!app.getLoadedSong()) return;
    try {
      await ensureAudio();
      const settings = settingsPanel.getSettings();
      if (app.audio.ready && settings.countIn) {
        await app.audio.countIn(settings.countInBeats, (beat) => countIn.show(beat, settings.countInBeats));
        countIn.hide();
      }
      await app.startPractice();
      scoreContainer.classList.add('practice-active');
      updateNoteDisplay();
      updateKeyboardVisibility();
    } catch (err) {
      console.error('Practice start error:', err);
      countIn.hide();
    }
  };

  practiceComplete.setOnRetry(async () => {
    await practiceWithCountIn();
  });

  practiceComplete.setOnPracticeTroubleSpots(async (startMeasure, endMeasure) => {
    app.setLoop(startMeasure, endMeasure);
    await practiceWithCountIn();
  });

  // Score interaction: click-to-jump and drag-to-select
  app.scoreInteraction.setOnJump((measure) => {
    // Stop current playback/practice, clear loop, and jump to clicked measure
    app.stop();
    app.clearLoop();
    app.scoreInteraction.clearSelection();
    app.renderer.setCursorToMeasure(measure);
    app.renderer.cursorShow();
  });

  app.scoreInteraction.setOnSelect((selection) => {
    if (!selection) return;
    // Set loop to the selected measure range
    app.setLoop(selection.startMeasure, selection.endMeasure);
    // If in practice mode, restart with the new loop
    if (app.getMode() === 'practice') {
      app.stopPractice();
    }
  });

  toolbar.setOnShowLibrary(() => {
    if (library.isVisible()) {
      library.hide();
      if (app.getLoadedSong()) {
        scoreContainer.style.display = 'block';
      }
    } else {
      library.show();
      scoreContainer.style.display = 'none';
    }
  });

  library.setOnSongLoad((song) => {
    toolbar.setSongTitle(song.title);
    scoreContainer.style.display = 'block';
    libraryContainer.style.display = 'none';
  });

  app.on('loaded', () => {
    scoreContainer.style.display = 'block';
    libraryContainer.style.display = 'none';
    // Re-render overlays for newly loaded song
    applySettings(settingsPanel.getSettings());
  });

  // Update note display during practice mode
  const updateNoteDisplay = () => {
    const settings = settingsPanel.getSettings();
    if (app.getMode() === 'practice' && app.practiceMode.isActive()) {
      const expected = app.practiceMode.getExpectedNotes();
      if (settings.showNextNote) {
        noteDisplay.show(expected, expected.length > 1);
      } else {
        noteDisplay.hide();
      }
      // Respect highlightExpectedKeys setting
      if (!settings.highlightExpectedKeys && app.virtualKeyboard) {
        app.virtualKeyboard.highlightKeys([]);
      }
    } else {
      noteDisplay.hide();
    }
  };

  app.on('cursorAdvanced', updateNoteDisplay);
  app.on('modeChanged', ({ mode }) => {
    updateNoteDisplay();
    updateKeyboardVisibility();
    if (mode !== 'practice') {
      scoreContainer.classList.remove('practice-active');
    }
  });

  app.on('songEnd', ({ stats }) => {
    noteDisplay.hide();
    scoreContainer.classList.remove('practice-active');
    updateKeyboardVisibility();
    if (app.getMode() === 'practice') {
      practiceComplete.show(stats);

      // Save practice session
      const song = app.getLoadedSong();
      if (song) {
        const total = stats.correctCount + stats.wrongCount;
        addSession({
          songId: song.id,
          songTitle: song.title,
          date: new Date().toISOString(),
          accuracy: total === 0 ? 100 : Math.round((stats.correctCount / total) * 100),
          correctCount: stats.correctCount,
          wrongCount: stats.wrongCount,
          bestStreak: stats.bestStreak,
          elapsedSeconds: stats.startTime ? (Date.now() - stats.startTime) / 1000 : 0,
          hand: app.getHand(),
          completed: stats.cursorIndex >= stats.totalNotes,
        });
      }
    }
  });

  // Initialize audio on first user interaction (guarded against double-fire)
  let audioInitStarted = false;
  const initAudio = async () => {
    if (audioInitStarted) return;
    audioInitStarted = true;
    document.removeEventListener('click', initAudio);
    document.removeEventListener('keydown', initAudio);
    document.removeEventListener('touchstart', initAudio);
    try {
      await app.init();
    } catch (err) {
      audioInitStarted = false; // allow retry on failure
      console.warn('Audio init deferred:', err);
    }
  };
  document.addEventListener('click', initAudio);
  document.addEventListener('keydown', initAudio);
  document.addEventListener('touchstart', initAudio, { once: true });

  // Override toolbar play button to use count-in
  toolbar.setOnPlay(async () => {
    const mode = app.getMode();
    if (mode === 'play') {
      const state = app.getPlaybackState();
      if (state === 'playing') {
        app.pause();
      } else if (state === 'paused') {
        await app.play(); // resume without count-in
      } else {
        await playWithCountIn();
      }
    } else {
      if (app.practiceMode.isActive()) {
        app.stopPractice();
        updateKeyboardVisibility();
      } else {
        await practiceWithCountIn();
      }
    }
  });

  // Global keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

    switch (e.key) {
      case ' ':
        e.preventDefault();
        if (app.getMode() === 'play') {
          const state = app.getPlaybackState();
          if (state === 'playing') app.pause();
          else if (state === 'paused') app.play();
          else playWithCountIn();
        } else {
          if (app.practiceMode.isActive()) app.stopPractice();
          else practiceWithCountIn();
        }
        break;
      case 'Escape':
        app.stop();
        practiceComplete.hide();
        countIn.hide();
        break;
      case 'm':
        app.toggleMetronome();
        break;
      case '?':
        shortcutsHelp.toggle();
        break;
    }
  });

  // Cleanup on page unload
  window.addEventListener('beforeunload', () => {
    app.destroy();
  });
}

main().catch(console.error);
