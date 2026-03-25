import type { PianoApp } from '../api';
import type { AppMode, HandSelection } from '../types';

export class Toolbar {
  private app: PianoApp;
  private container: HTMLElement;
  private onShowLibrary: (() => void) | null = null;
  private onPlay: (() => void) | null = null;
  private onShowSettings: (() => void) | null = null;

  // Element references
  private playBtn!: HTMLButtonElement;
  private stopBtn!: HTMLButtonElement;
  private modeToggle!: HTMLElement;
  private handBtns!: HTMLButtonElement[];
  private tempoSlider!: HTMLInputElement;
  private accompToggle!: HTMLInputElement;
  private accompRow!: HTMLElement;
  private metronomeBtn!: HTMLButtonElement;
  private statsDisplay!: HTMLElement;
  private songTitle!: HTMLElement;
  private progressBar!: HTMLElement;
  private midiStatus!: HTMLElement;
  private loopRow!: HTMLElement;
  private loopToggle!: HTMLInputElement;
  private loopStartInput!: HTMLInputElement;
  private loopEndInput!: HTMLInputElement;

  constructor(app: PianoApp, container: HTMLElement) {
    this.app = app;
    this.container = container;
  }

  render(): void {
    this.container.innerHTML = '';
    this.container.className = 'toolbar';

    this.container.innerHTML = `
      <div class="tb-row tb-main">
        <button class="tb-btn tb-library-btn" title="Song Library">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>
          </svg>
        </button>
        <span class="tb-song-title">Select a song to begin</span>
        <div class="tb-spacer"></div>
        <div class="tb-mode-toggle">
          <button class="tb-mode-btn active" data-mode="play">Play</button>
          <button class="tb-mode-btn" data-mode="practice">Practice</button>
        </div>
      </div>

      <div class="tb-row tb-controls">
        <div class="tb-transport">
          <button class="tb-btn tb-play-btn" title="Play / Pause">
            <svg class="icon-play" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            <svg class="icon-pause" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" style="display:none"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
          </button>
          <button class="tb-btn tb-stop-btn" title="Stop">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
          </button>
          <button class="tb-btn tb-metronome-btn" title="Metronome">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 2L8 22h8L12 2z"/><line x1="12" y1="8" x2="16" y2="4"/>
            </svg>
          </button>
        </div>

        <div class="tb-hands">
          <button class="tb-hand-btn active" data-hand="both">Both</button>
          <button class="tb-hand-btn" data-hand="right">R</button>
          <button class="tb-hand-btn" data-hand="left">L</button>
        </div>

        <div class="tb-accomp-row" style="display:none">
          <label class="tb-toggle-label">
            <input type="checkbox" class="tb-accomp-toggle" />
            <span>Accompaniment</span>
          </label>
        </div>

        <div class="tb-loop" style="display:none">
          <label class="tb-toggle-label">
            <input type="checkbox" class="tb-loop-toggle" />
            <span>Loop</span>
          </label>
          <input type="number" class="tb-loop-start" min="1" value="1" title="Start measure" />
          <span class="tb-loop-dash">-</span>
          <input type="number" class="tb-loop-end" min="1" value="4" title="End measure" />
        </div>

        <div class="tb-tempo">
          <span class="tb-bpm-display" title="Beats per minute"></span>
          <div class="tb-tempo-presets">
            <button class="tb-tempo-preset" data-speed="50">50%</button>
            <button class="tb-tempo-preset" data-speed="75">75%</button>
            <button class="tb-tempo-preset active" data-speed="100">100%</button>
          </div>
          <label>
            <input type="range" class="tb-tempo-slider" min="25" max="200" value="100" step="5" />
          </label>
        </div>

        <button class="tb-btn tb-settings-btn" title="Settings">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>

        <div class="tb-midi-status" title="MIDI Status">
          <span class="tb-midi-dot"></span>
          <span class="tb-midi-text">No MIDI</span>
        </div>
      </div>

      <div class="tb-row tb-stats" style="display:none">
        <span class="tb-stat tb-accuracy">Accuracy: —</span>
        <span class="tb-stat tb-streak">Streak: 0</span>
        <span class="tb-stat tb-progress-text">0 / 0</span>
      </div>

      <div class="tb-progress-bar"><div class="tb-progress-fill"></div></div>
    `;

    this.bindElements();
    this.bindEvents();
  }

  private bindElements(): void {
    this.songTitle = this.container.querySelector('.tb-song-title')!;
    this.playBtn = this.container.querySelector('.tb-play-btn')!;
    this.stopBtn = this.container.querySelector('.tb-stop-btn')!;
    this.modeToggle = this.container.querySelector('.tb-mode-toggle')!;
    this.handBtns = Array.from(this.container.querySelectorAll('.tb-hand-btn'));
    this.tempoSlider = this.container.querySelector('.tb-tempo-slider')!;
      this.accompToggle = this.container.querySelector('.tb-accomp-toggle')!;
    this.accompRow = this.container.querySelector('.tb-accomp-row')!;
    this.metronomeBtn = this.container.querySelector('.tb-metronome-btn')!;
    this.statsDisplay = this.container.querySelector('.tb-stats')!;
    this.progressBar = this.container.querySelector('.tb-progress-fill')!;
    this.loopRow = this.container.querySelector('.tb-loop')!;
    this.loopToggle = this.container.querySelector('.tb-loop-toggle')!;
    this.loopStartInput = this.container.querySelector('.tb-loop-start')!;
    this.loopEndInput = this.container.querySelector('.tb-loop-end')!;
    this.midiStatus = this.container.querySelector('.tb-midi-status')!;
  }

  private bindEvents(): void {
    // Library button
    this.container.querySelector('.tb-library-btn')!.addEventListener('click', () => {
      this.onShowLibrary?.();
    });

    // Play/Pause
    this.playBtn.addEventListener('click', async () => {
      if (this.onPlay) {
        this.onPlay();
      } else {
        const mode = this.app.getMode();
        if (mode === 'play') {
          const state = this.app.getPlaybackState();
          if (state === 'playing') {
            this.app.pause();
          } else {
            await this.app.play();
          }
        } else {
          if (this.app.practiceMode.isActive()) {
            this.app.stopPractice();
          } else {
            await this.app.startPractice();
          }
        }
      }
      this.updatePlayButton();
    });

    // Stop
    this.stopBtn.addEventListener('click', () => {
      this.app.stop();
      this.updatePlayButton();
    });

    // Mode toggle
    this.modeToggle.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.tb-mode-btn') as HTMLButtonElement;
      if (!btn) return;
      const mode = btn.dataset.mode as AppMode;
      this.app.setMode(mode);
      this.modeToggle.querySelectorAll('.tb-mode-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      this.updateModeUI();
    });

    // Hand selection
    for (const btn of this.handBtns) {
      btn.addEventListener('click', () => {
        const hand = btn.dataset.hand as HandSelection;
        this.app.setHand(hand);
        this.handBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.accompRow.style.display = hand === 'both' ? 'none' : 'flex';
      });
    }

    // Tempo slider
    const bpmDisplay = this.container.querySelector('.tb-bpm-display')!;
    const tempoPresets = this.container.querySelectorAll('.tb-tempo-preset');

    const updateTempo = (pct: number) => {
      this.tempoSlider.value = String(pct);
      this.app.setTempoScale(pct / 100);
      this.updateBpmDisplay(bpmDisplay, pct);
      tempoPresets.forEach(btn => {
        btn.classList.toggle('active', parseInt((btn as HTMLButtonElement).dataset.speed!) === pct);
      });
    };

    this.tempoSlider.addEventListener('input', () => {
      const pct = parseInt(this.tempoSlider.value);
      updateTempo(pct);
    });

    tempoPresets.forEach(btn => {
      btn.addEventListener('click', () => {
        const speed = parseInt((btn as HTMLButtonElement).dataset.speed!);
        updateTempo(speed);
      });
    });

    // Update BPM on song load
    this.app.on('loaded', () => {
      this.updateBpmDisplay(bpmDisplay, parseInt(this.tempoSlider.value));
    });

    // Accompaniment toggle
    this.accompToggle.addEventListener('change', () => {
      this.app.setAccompaniment(this.accompToggle.checked);
    });

    // Settings button
    const settingsBtn = this.container.querySelector('.tb-settings-btn')!;
    settingsBtn.addEventListener('click', () => {
      this.onShowSettings?.();
    });

    // Metronome
    this.metronomeBtn.addEventListener('click', () => {
      const enabled = this.app.toggleMetronome();
      this.metronomeBtn.classList.toggle('active', enabled);
    });

    // Loop controls
    this.loopToggle.addEventListener('change', () => {
      if (this.loopToggle.checked) {
        const start = parseInt(this.loopStartInput.value) || 1;
        const end = parseInt(this.loopEndInput.value) || 4;
        this.app.setLoop(start, end);
      } else {
        this.app.clearLoop();
      }
    });

    const updateLoop = () => {
      if (this.loopToggle.checked) {
        const start = parseInt(this.loopStartInput.value) || 1;
        const end = parseInt(this.loopEndInput.value) || 4;
        this.app.setLoop(Math.min(start, end), Math.max(start, end));
      }
    };
    this.loopStartInput.addEventListener('change', updateLoop);
    this.loopEndInput.addEventListener('change', updateLoop);

    // Listen for app events to update UI
    this.app.on('playbackStateChanged', () => this.updatePlayButton());
    this.app.on('cursorAdvanced', () => this.updateProgress());
    this.app.on('loaded', () => {
      const song = this.app.getLoadedSong();
      if (song) this.songTitle.textContent = song.title;
      // Update loop end to total measures
      const totalMeasures = this.app.getTotalMeasures();
      if (totalMeasures > 0) {
        this.loopEndInput.value = String(totalMeasures);
        this.loopEndInput.max = String(totalMeasures);
        this.loopStartInput.max = String(totalMeasures);
      }
    });
    this.app.on('modeChanged', ({ mode }) => {
      this.modeToggle.querySelectorAll('.tb-mode-btn').forEach(b => b.classList.remove('active'));
      this.modeToggle.querySelector(`[data-mode="${mode}"]`)?.classList.add('active');
      this.updateModeUI();
    });
    this.app.on('handChanged', ({ hand }) => {
      this.handBtns.forEach(b => b.classList.remove('active'));
      this.handBtns.find(b => b.dataset.hand === hand)?.classList.add('active');
      this.accompRow.style.display = hand === 'both' ? 'none' : 'flex';
    });
    this.app.on('noteCorrect', () => this.updatePracticeStats());
    this.app.on('noteWrong', () => this.updatePracticeStats());
    this.app.on('songEnd', () => {
      this.updatePlayButton();
      this.updatePracticeStats();
    });

    // MIDI connection status
    this.app.midiInput.setConnectionCallback((connected, name) => {
      const dot = this.midiStatus.querySelector('.tb-midi-dot')!;
      const text = this.midiStatus.querySelector('.tb-midi-text')!;
      dot.classList.toggle('connected', connected);
      text.textContent = connected ? name : 'No MIDI';
    });
  }

  private updatePlayButton(): void {
    const mode = this.app.getMode();
    const isPlaying = mode === 'play'
      ? this.app.getPlaybackState() === 'playing'
      : this.app.practiceMode.isActive();

    const playIcon = this.playBtn.querySelector('.icon-play') as HTMLElement;
    const pauseIcon = this.playBtn.querySelector('.icon-pause') as HTMLElement;
    playIcon.style.display = isPlaying ? 'none' : 'block';
    pauseIcon.style.display = isPlaying ? 'block' : 'none';
  }

  private updateModeUI(): void {
    const mode = this.app.getMode();
    this.statsDisplay.style.display = mode === 'practice' ? 'flex' : 'none';
    this.loopRow.style.display = mode === 'practice' ? 'flex' : 'none';
    this.updatePlayButton();
  }

  private updateProgress(): void {
    const mode = this.app.getMode();
    if (mode === 'play') {
      const progress = this.app.playMode.getProgress();
      this.progressBar.style.width = `${progress * 100}%`;
    }
  }

  updatePracticeStats(): void {
    const state = this.app.getPracticeState();
    const accuracy = this.container.querySelector('.tb-accuracy')!;
    const streak = this.container.querySelector('.tb-streak')!;
    const progressText = this.container.querySelector('.tb-progress-text')!;

    const total = state.correctCount + state.wrongCount;
    const pct = total === 0 ? 100 : Math.round((state.correctCount / total) * 100);
    accuracy.textContent = `Accuracy: ${pct}%`;
    streak.textContent = `Streak: ${state.streak} (Best: ${state.bestStreak})`;
    progressText.textContent = `${state.cursorIndex} / ${state.totalNotes}`;

    const progress = state.totalNotes > 0 ? state.cursorIndex / state.totalNotes : 0;
    this.progressBar.style.width = `${progress * 100}%`;
  }

  private updateBpmDisplay(el: Element, pct: number): void {
    const baseTempo = this.app.audio.getTempo();
    if (baseTempo > 0) {
      const effectiveBpm = Math.round(baseTempo * (pct / 100));
      el.textContent = `${effectiveBpm} BPM`;
    }
  }

  setOnShowLibrary(cb: () => void): void {
    this.onShowLibrary = cb;
  }

  setOnPlay(cb: () => void): void {
    this.onPlay = cb;
  }

  setOnShowSettings(cb: () => void): void {
    this.onShowSettings = cb;
  }

  setSongTitle(title: string): void {
    this.songTitle.textContent = title;
  }
}
