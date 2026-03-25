export interface AppSettings {
  showNoteNames: boolean;
  showNextNote: boolean;
  showVirtualKeyboard: boolean;
  countIn: boolean;
  countInBeats: number;
  accompaniment: boolean;
  autoScrollKeyboard: boolean;
  wrongNoteLabels: boolean;
  highlightExpectedKeys: boolean;
  autoAdvance: boolean;
  autoAdvanceSeconds: number;
}

const SETTINGS_KEY = 'piano-practice-settings';

const DEFAULTS: AppSettings = {
  showNoteNames: true,
  showNextNote: true,
  showVirtualKeyboard: false,
  countIn: true,
  countInBeats: 4,
  accompaniment: false,
  autoScrollKeyboard: true,
  wrongNoteLabels: true,
  highlightExpectedKeys: true,
  autoAdvance: false,
  autoAdvanceSeconds: 5,
};

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return { ...DEFAULTS, ...JSON.parse(raw) };
    }
  } catch (err) {
    console.warn('Failed to load settings:', err);
  }
  return { ...DEFAULTS };
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Failed to save settings:', err);
  }
}

export class SettingsPanel {
  private container: HTMLElement;
  private overlay: HTMLElement | null = null;
  private settings: AppSettings;
  private onChange: ((settings: AppSettings) => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    this.settings = loadSettings();
  }

  getSettings(): AppSettings {
    return { ...this.settings };
  }

  show(): void {
    this.hide();

    this.overlay = document.createElement('div');
    this.overlay.className = 'settings-overlay';
    this.overlay.innerHTML = `
      <div class="settings-panel">
        <div class="sp-header">
          <h2>Settings</h2>
          <button class="sp-close">&times;</button>
        </div>

        <div class="sp-section">
          <h3>Display</h3>
          <label class="sp-toggle">
            <input type="checkbox" data-setting="showVirtualKeyboard" ${this.settings.showVirtualKeyboard ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Virtual Keyboard</span>
              <span class="sp-toggle-desc">Show the on-screen piano keyboard (auto-shows in practice mode)</span>
            </div>
          </label>
          <label class="sp-toggle">
            <input type="checkbox" data-setting="showNoteNames" ${this.settings.showNoteNames ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Note Names on Keys</span>
              <span class="sp-toggle-desc">Show note names (C4, D4...) on the virtual keyboard</span>
            </div>
          </label>
          <label class="sp-toggle">
            <input type="checkbox" data-setting="showNextNote" ${this.settings.showNextNote ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Next Note Preview</span>
              <span class="sp-toggle-desc">Show the expected note name between the score and keyboard</span>
            </div>
          </label>
          <label class="sp-toggle">
            <input type="checkbox" data-setting="highlightExpectedKeys" ${this.settings.highlightExpectedKeys ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Highlight Expected Keys</span>
              <span class="sp-toggle-desc">Highlight the correct keys on the virtual keyboard in practice mode</span>
            </div>
          </label>
          <label class="sp-toggle">
            <input type="checkbox" data-setting="wrongNoteLabels" ${this.settings.wrongNoteLabels ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Wrong Note Labels</span>
              <span class="sp-toggle-desc">Show the note name when you play a wrong note on the score</span>
            </div>
          </label>
        </div>

        <div class="sp-section">
          <h3>Practice</h3>
          <label class="sp-toggle">
            <input type="checkbox" data-setting="countIn" ${this.settings.countIn ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Count-In</span>
              <span class="sp-toggle-desc">Play a 4-beat metronome count before starting</span>
            </div>
          </label>
          <label class="sp-toggle">
            <input type="checkbox" data-setting="accompaniment" ${this.settings.accompaniment ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Accompaniment</span>
              <span class="sp-toggle-desc">Auto-play the other hand when practicing one hand only</span>
            </div>
          </label>
          <label class="sp-toggle">
            <input type="checkbox" data-setting="autoScrollKeyboard" ${this.settings.autoScrollKeyboard ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Auto-Scroll Keyboard</span>
              <span class="sp-toggle-desc">Automatically scroll the keyboard to show the expected notes</span>
            </div>
          </label>
          <label class="sp-toggle">
            <input type="checkbox" data-setting="autoAdvance" ${this.settings.autoAdvance ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Auto-Advance (${this.settings.autoAdvanceSeconds}s)</span>
              <span class="sp-toggle-desc">Automatically show the answer and move on after ${this.settings.autoAdvanceSeconds} seconds if you haven't played the right note</span>
            </div>
          </label>
        </div>

        <div class="sp-section sp-skill-presets">
          <h3>Skill Presets</h3>
          <div class="sp-presets">
            <button class="sp-preset-btn" data-preset="beginner">Beginner</button>
            <button class="sp-preset-btn" data-preset="intermediate">Intermediate</button>
            <button class="sp-preset-btn" data-preset="advanced">Advanced</button>
          </div>
        </div>
      </div>
    `;

    // Close button
    this.overlay.querySelector('.sp-close')!.addEventListener('click', () => this.hide());
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.hide();
    });

    // Toggle handlers
    this.overlay.querySelectorAll('[data-setting]').forEach(input => {
      (input as HTMLInputElement).addEventListener('change', () => {
        const key = (input as HTMLInputElement).dataset.setting as keyof AppSettings;
        (this.settings as any)[key] = (input as HTMLInputElement).checked;
        saveSettings(this.settings);
        this.onChange?.(this.settings);
      });
    });

    // Preset handlers
    this.overlay.querySelectorAll('[data-preset]').forEach(btn => {
      btn.addEventListener('click', () => {
        const preset = (btn as HTMLButtonElement).dataset.preset;
        this.applyPreset(preset!);
        this.hide();
        this.show(); // re-render to update checkboxes
      });
    });

    this.container.appendChild(this.overlay);
  }

  private applyPreset(preset: string): void {
    switch (preset) {
      case 'beginner':
        this.settings = {
          ...this.settings,
          showNoteNames: true,
          showNextNote: true,
          showVirtualKeyboard: true,
          highlightExpectedKeys: true,
          wrongNoteLabels: true,
          countIn: true,
          autoScrollKeyboard: true,
        };
        break;
      case 'intermediate':
        this.settings = {
          ...this.settings,
          showNoteNames: true,
          showNextNote: false,
          showVirtualKeyboard: false,
          highlightExpectedKeys: true,
          wrongNoteLabels: true,
          countIn: true,
          autoScrollKeyboard: true,
        };
        break;
      case 'advanced':
        this.settings = {
          ...this.settings,
          showNoteNames: false,
          showNextNote: false,
          showVirtualKeyboard: false,
          highlightExpectedKeys: false,
          wrongNoteLabels: false,
          countIn: false,
          autoScrollKeyboard: false,
        };
        break;
    }
    saveSettings(this.settings);
    this.onChange?.(this.settings);
  }

  hide(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  isVisible(): boolean {
    return this.overlay !== null;
  }

  setOnChange(cb: (settings: AppSettings) => void): void {
    this.onChange = cb;
  }
}
