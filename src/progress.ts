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

export interface SongPracticeSummary {
  bestAccuracy: number | null;
  sessionCount: number;
  lastPracticedAt: number | null;
}

const STORAGE_KEY = 'piano-practice-history';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeSession(value: unknown): PracticeSession | null {
  if (typeof value !== 'object' || value === null) return null;
  const session = value as Partial<Record<keyof PracticeSession, unknown>>;
  if (
    typeof session.songId !== 'string' ||
    typeof session.songTitle !== 'string' ||
    typeof session.date !== 'string' ||
    !isFiniteNumber(session.accuracy) ||
    !isFiniteNumber(session.correctCount) ||
    !isFiniteNumber(session.wrongCount) ||
    !isFiniteNumber(session.bestStreak) ||
    !isFiniteNumber(session.elapsedSeconds) ||
    !['both', 'left', 'right'].includes(String(session.hand)) ||
    typeof session.completed !== 'boolean'
  ) {
    return null;
  }

  return {
    songId: session.songId,
    songTitle: session.songTitle,
    date: session.date,
    accuracy: Math.max(0, Math.min(100, session.accuracy)),
    correctCount: Math.max(0, Math.trunc(session.correctCount)),
    wrongCount: Math.max(0, Math.trunc(session.wrongCount)),
    bestStreak: Math.max(0, Math.trunc(session.bestStreak)),
    elapsedSeconds: Math.max(0, session.elapsedSeconds),
    hand: session.hand as PracticeSession['hand'],
    completed: session.completed,
  };
}

export function getHistory(): PracticeSession[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map(normalizeSession).filter((session): session is PracticeSession => session !== null)
      : [];
  } catch {
    return [];
  }
}

export function addSession(session: PracticeSession): void {
  const normalized = normalizeSession(session);
  if (!normalized) return;
  const history = getHistory();
  history.push(normalized);
  // Keep max 500 sessions
  const trimmed = history.slice(-500);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Storage full — clear old entries
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed.slice(-100)));
    } catch {
      // Storage may be entirely unavailable (for example in private mode).
    }
  }
}

/** Build per-song library metadata with a single history read. */
export function getSongPracticeSummaries(): Map<string, SongPracticeSummary> {
  const summaries = new Map<string, SongPracticeSummary>();

  for (const session of getHistory()) {
    const existing = summaries.get(session.songId) ?? {
      bestAccuracy: null,
      sessionCount: 0,
      lastPracticedAt: null,
    };
    const practicedAt = Date.parse(session.date);

    existing.bestAccuracy = existing.bestAccuracy === null
      ? session.accuracy
      : Math.max(existing.bestAccuracy, session.accuracy);
    existing.sessionCount++;
    if (Number.isFinite(practicedAt)) {
      existing.lastPracticedAt = existing.lastPracticedAt === null
        ? practicedAt
        : Math.max(existing.lastPracticedAt, practicedAt);
    }
    summaries.set(session.songId, existing);
  }

  return summaries;
}

export function getRecentSessions(limit: number = 10): PracticeSession[] {
  const normalizedLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 10;
  if (normalizedLimit === 0) return [];
  return getHistory().slice(-normalizedLimit).reverse();
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
    try {
      localStorage.setItem(STORAGE_KEY, '[]');
    } catch {
      // Storage is unavailable; there is nothing else to clear.
    }
  }
}
