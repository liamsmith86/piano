import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock localStorage before importing module
const store = new Map<string, string>();
const mockLocalStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
  removeItem: vi.fn((key: string) => { store.delete(key); }),
  clear: vi.fn(() => store.clear()),
  get length() { return store.size; },
  key: vi.fn((i: number) => [...store.keys()][i] ?? null),
};

Object.defineProperty(globalThis, 'localStorage', {
  value: mockLocalStorage,
  writable: true,
  configurable: true,
});

import {
  getHistory,
  addSession,
  getSessionsForSong,
  getBestAccuracyForSong,
  getRecentSessions,
  getTotalPracticeTime,
  getTotalNotesPlayed,
  clearHistory,
} from '../../src/progress';
import type { PracticeSession } from '../../src/progress';

function makeSession(overrides: Partial<PracticeSession> = {}): PracticeSession {
  return {
    songId: 'test-song',
    songTitle: 'Test Song',
    date: new Date().toISOString(),
    accuracy: 85,
    correctCount: 17,
    wrongCount: 3,
    bestStreak: 10,
    elapsedSeconds: 120,
    hand: 'both',
    completed: true,
    ...overrides,
  };
}

describe('Progress Tracking', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('starts with empty history', () => {
    expect(getHistory()).toEqual([]);
  });

  it('adds a session', () => {
    addSession(makeSession());
    expect(getHistory()).toHaveLength(1);
  });

  it('adds multiple sessions', () => {
    addSession(makeSession({ accuracy: 80 }));
    addSession(makeSession({ accuracy: 90 }));
    addSession(makeSession({ accuracy: 95 }));
    expect(getHistory()).toHaveLength(3);
  });

  it('getSessionsForSong filters correctly', () => {
    addSession(makeSession({ songId: 'song-a' }));
    addSession(makeSession({ songId: 'song-b' }));
    addSession(makeSession({ songId: 'song-a' }));

    expect(getSessionsForSong('song-a')).toHaveLength(2);
    expect(getSessionsForSong('song-b')).toHaveLength(1);
    expect(getSessionsForSong('song-c')).toHaveLength(0);
  });

  it('getBestAccuracyForSong returns highest accuracy', () => {
    addSession(makeSession({ songId: 'song-a', accuracy: 70 }));
    addSession(makeSession({ songId: 'song-a', accuracy: 95 }));
    addSession(makeSession({ songId: 'song-a', accuracy: 80 }));

    expect(getBestAccuracyForSong('song-a')).toBe(95);
  });

  it('getBestAccuracyForSong returns null for no sessions', () => {
    expect(getBestAccuracyForSong('unknown')).toBeNull();
  });

  it('getRecentSessions returns most recent first', () => {
    addSession(makeSession({ accuracy: 70 }));
    addSession(makeSession({ accuracy: 80 }));
    addSession(makeSession({ accuracy: 90 }));

    const recent = getRecentSessions(2);
    expect(recent).toHaveLength(2);
    expect(recent[0].accuracy).toBe(90);
    expect(recent[1].accuracy).toBe(80);
  });

  it('getTotalPracticeTime sums elapsed seconds', () => {
    addSession(makeSession({ elapsedSeconds: 60 }));
    addSession(makeSession({ elapsedSeconds: 120 }));
    addSession(makeSession({ elapsedSeconds: 30 }));

    expect(getTotalPracticeTime()).toBe(210);
  });

  it('getTotalNotesPlayed sums correct + wrong', () => {
    addSession(makeSession({ correctCount: 10, wrongCount: 2 }));
    addSession(makeSession({ correctCount: 20, wrongCount: 5 }));

    expect(getTotalNotesPlayed()).toBe(37);
  });

  it('clearHistory empties everything', () => {
    addSession(makeSession());
    addSession(makeSession());
    clearHistory();
    expect(getHistory()).toEqual([]);
  });

  it('handles corrupt localStorage gracefully', () => {
    store.set('piano-practice-history', '{invalid json');
    expect(getHistory()).toEqual([]);
  });
});
