import { DialogFocus } from './DialogFocus';

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
  showNoteNamesOnScore: boolean;
  showAllAccidentals: boolean;
  showFingering: boolean;
  showChords: boolean;
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
  showNoteNamesOnScore: false,
  showAllAccidentals: false,
  showFingering: false,
  showChords: false,
};

type BooleanSettingKey = {
  [K in keyof AppSettings]: AppSettings[K] extends boolean ? K : never;
}[keyof AppSettings];

const BOOLEAN_SETTING_KEYS: readonly BooleanSettingKey[] = [
  'showNoteNames',
  'showNextNote',
  'showVirtualKeyboard',
  'countIn',
  'accompaniment',
  'autoScrollKeyboard',
  'wrongNoteLabels',
  'highlightExpectedKeys',
  'autoAdvance',
  'showNoteNamesOnScore',
  'showAllAccidentals',
  'showFingering',
  'showChords',
];

function normalizeSettings(value: unknown): AppSettings {
  const settings = { ...DEFAULTS };
  if (typeof value !== 'object' || value === null) return settings;

  const candidate = value as Record<string, unknown>;
  for (const key of BOOLEAN_SETTING_KEYS) {
    if (typeof candidate[key] === 'boolean') settings[key] = candidate[key];
  }

  if (typeof candidate.countInBeats === 'number' && Number.isFinite(candidate.countInBeats)) {
    settings.countInBeats = Math.max(1, Math.min(8, Math.trunc(candidate.countInBeats)));
  }
  if (typeof candidate.autoAdvanceSeconds === 'number' && Number.isFinite(candidate.autoAdvanceSeconds)) {
    settings.autoAdvanceSeconds = Math.max(1, Math.min(60, candidate.autoAdvanceSeconds));
  }
  return settings;
}

function isBooleanSettingKey(key: string | undefined): key is BooleanSettingKey {
  return key !== undefined && (BOOLEAN_SETTING_KEYS as readonly string[]).includes(key);
}

export function loadSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return normalizeSettings(JSON.parse(raw));
    }
  } catch (err) {
    console.warn('Failed to load settings:', err);
  }
  return { ...DEFAULTS };
}

export function saveSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizeSettings(settings)));
  } catch (err) {
    console.warn('Failed to save settings:', err);
  }
}

export class SettingsPanel {
  private container: HTMLElement;
  private overlay: HTMLElement | null = null;
  private settings: AppSettings;
  private onChange: ((settings: AppSettings) => void) | null = null;
  private dialogFocus: DialogFocus | null = null;

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
      <div class="settings-panel" role="dialog" aria-modal="true" aria-labelledby="settings-title" tabindex="-1">
        <div class="sp-header">
          <h2 id="settings-title">Settings</h2>
          <button type="button" class="sp-close" aria-label="Close settings">&times;</button>
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
          <label class="sp-toggle">
            <input type="checkbox" data-setting="showNoteNamesOnScore" ${this.settings.showNoteNamesOnScore ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Note Names on Score</span>
              <span class="sp-toggle-desc">Display letter names (C, D, E...) on each note in the sheet music</span>
            </div>
          </label>
          <label class="sp-toggle">
            <input type="checkbox" data-setting="showAllAccidentals" ${this.settings.showAllAccidentals ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Show All Accidentals</span>
              <span class="sp-toggle-desc">Always show ♯/♭ symbols on altered notes, even when implied by the key signature</span>
            </div>
          </label>
          <label class="sp-toggle">
            <input type="checkbox" data-setting="showFingering" ${this.settings.showFingering ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Suggested Fingering</span>
              <span class="sp-toggle-desc">Show optimal finger numbers (1-5) for each note, computed automatically</span>
            </div>
          </label>
          <label class="sp-toggle">
            <input type="checkbox" data-setting="showChords" ${this.settings.showChords ? 'checked' : ''} />
            <div class="sp-toggle-info">
              <span class="sp-toggle-label">Chord Symbols</span>
              <span class="sp-toggle-desc">Show detected chord names (C, Dm7, G7...) above the staff</span>
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
        const element = input as HTMLInputElement;
        const key = element.dataset.setting;
        if (!isBooleanSettingKey(key)) return;
        this.settings[key] = element.checked;
        saveSettings(this.settings);
        this.onChange?.({ ...this.settings });
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
    const panel = this.overlay.querySelector('.settings-panel') as HTMLElement;
    const close = this.overlay.querySelector('.sp-close') as HTMLElement;
    this.dialogFocus = new DialogFocus(this.overlay, panel, () => this.hide(), close);
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
          showNoteNamesOnScore: true,
          showAllAccidentals: true,
          showFingering: true,
          showChords: true,
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
          showNoteNamesOnScore: false,
          showAllAccidentals: true,
          showFingering: false,
          showChords: true,
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
          showNoteNamesOnScore: false,
          showAllAccidentals: false,
          showFingering: false,
          showChords: false,
        };
        break;
    }
    saveSettings(this.settings);
    this.onChange?.({ ...this.settings });
  }

  hide(): void {
    this.dialogFocus?.destroy();
    this.dialogFocus = null;
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
