import { beforeEach, describe, expect, it } from 'vitest';
import { loadSettings, saveSettings, type AppSettings } from '../../src/ui/Settings';

const SETTINGS_KEY = 'piano-practice-settings';

describe('settings persistence', () => {
  beforeEach(() => localStorage.clear());

  it('accepts valid partial settings without discarding defaults', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      showNextNote: false,
      countInBeats: 3,
    }));

    const settings = loadSettings();

    expect(settings.showNextNote).toBe(false);
    expect(settings.countInBeats).toBe(3);
    expect(settings.showNoteNames).toBe(true);
  });

  it('rejects wrong types and bounds numeric settings', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      showNextNote: 'false',
      countInBeats: 99,
      autoAdvanceSeconds: -5,
      accompaniment: { enabled: true },
    }));

    const settings = loadSettings();

    expect(settings.showNextNote).toBe(true);
    expect(settings.accompaniment).toBe(false);
    expect(settings.countInBeats).toBe(8);
    expect(settings.autoAdvanceSeconds).toBe(1);
  });

  it('saves a normalized settings object', () => {
    const settings = loadSettings();
    settings.countInBeats = Number.NaN;
    settings.autoAdvanceSeconds = Infinity;

    saveSettings(settings as AppSettings);

    expect(loadSettings().countInBeats).toBe(4);
    expect(loadSettings().autoAdvanceSeconds).toBe(5);
  });
});
