export interface PracticeSession {
  songId: string;
  songTitle: string;
  date: string;       // ISO date string
  accuracy: number;   // 0-100
  correctCount: number;
  wrongCount: number;
  bestStreak: number;
  elapsedSeconds: number;
  hand: 'both' | 'left' | 'right';
  completed: boolean; // did they finish the whole piece?
}

const STORAGE_KEY = 'piano-practice-history';

export function getHistory(): PracticeSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addSession(session: PracticeSession): void {
  const history = getHistory();
  history.push(session);
  // Keep max 500 sessions
  const trimmed = history.slice(-500);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full — clear old entries
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed.slice(-100)));
  }
}

export function getSessionsForSong(songId: string): PracticeSession[] {
  return getHistory().filter(s => s.songId === songId);
}

export function getBestAccuracyForSong(songId: string): number | null {
  const sessions = getSessionsForSong(songId);
  if (sessions.length === 0) return null;
  return Math.max(...sessions.map(s => s.accuracy));
}

export function getRecentSessions(limit: number = 10): PracticeSession[] {
  return getHistory().slice(-limit).reverse();
}

export function getTotalPracticeTime(): number {
  return getHistory().reduce((sum, s) => sum + s.elapsedSeconds, 0);
}

export function getTotalNotesPlayed(): number {
  return getHistory().reduce((sum, s) => sum + s.correctCount + s.wrongCount, 0);
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Fallback: set to empty array
    localStorage.setItem(STORAGE_KEY, '[]');
  }
}
