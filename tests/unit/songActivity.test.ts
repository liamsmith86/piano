import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

import { getSongActivity, recordSongActivity } from '../../src/songActivity';

describe('Song activity', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('persists the latest successful open for each song', () => {
    recordSongActivity('song-a', 100);
    recordSongActivity('song-b', 200);
    recordSongActivity('song-a', 300);

    expect([...getSongActivity().entries()]).toEqual([
      ['song-a', 300],
      ['song-b', 200],
    ]);
  });

  it('ignores malformed storage entries and invalid activity', () => {
    store.set('piano-song-activity', JSON.stringify({
      valid: 100,
      negative: -1,
      text: 'yesterday',
    }));

    recordSongActivity('', 200);
    recordSongActivity('future', Number.NaN);

    expect([...getSongActivity().entries()]).toEqual([['valid', 100]]);
  });

  it('fails safely when browser storage is unavailable', () => {
    mockLocalStorage.getItem.mockImplementationOnce(() => { throw new Error('blocked'); });
    mockLocalStorage.setItem.mockImplementationOnce(() => { throw new Error('blocked'); });

    expect(getSongActivity()).toEqual(new Map());
    expect(() => recordSongActivity('song-a', 100)).not.toThrow();
  });
});
