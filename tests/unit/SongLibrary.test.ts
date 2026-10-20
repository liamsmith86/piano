import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PianoApp } from '../../src/api';
import type { SongInfo } from '../../src/types';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: vi.fn((key: string) => store.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
  },
  writable: true,
  configurable: true,
});

import { addSession } from '../../src/progress';
import { recordSongActivity } from '../../src/songActivity';
import { SongLibrary } from '../../src/ui/SongLibrary';

const songs: SongInfo[] = [
  { id: 'first', title: 'First', url: '/first.mxl', source: 'preloaded' },
  { id: 'second', title: 'Second', url: '/second.mxl', source: 'preloaded' },
  { id: 'third', title: 'Third', url: '/third.mxl', source: 'preloaded' },
];

function makeApp(): PianoApp {
  return {
    discoverSongs: vi.fn().mockResolvedValue(undefined),
    loadUploadedSongsFromStorage: vi.fn().mockResolvedValue(undefined),
    getSongList: vi.fn(() => songs),
    getLoadedSong: vi.fn(() => null),
  } as unknown as PianoApp;
}

describe('SongLibrary', () => {
  beforeEach(() => {
    store.clear();
    store.set('piano-welcomed', '1');
  });

  it('sorts recently opened songs ahead of untouched songs', async () => {
    recordSongActivity('second', 100);
    recordSongActivity('third', 200);
    const container = document.createElement('div');

    await new SongLibrary(makeApp(), container).render();

    expect([...container.querySelectorAll<HTMLElement>('.sl-card')].map(card => card.dataset.songId))
      .toEqual(['third', 'second', 'first']);
  });

  it('uses completed practice dates when no newer open is recorded', async () => {
    addSession({
      songId: 'second',
      songTitle: 'Second',
      date: '2026-08-01T00:00:00.000Z',
      accuracy: 85,
      correctCount: 17,
      wrongCount: 3,
      bestStreak: 10,
      elapsedSeconds: 120,
      hand: 'both',
      completed: true,
    });
    const container = document.createElement('div');

    await new SongLibrary(makeApp(), container).render();

    expect(container.querySelector<HTMLElement>('.sl-card')?.dataset.songId).toBe('second');
    expect(container.querySelector('.sl-card-accuracy')?.textContent).toContain('85% best');
  });
});
