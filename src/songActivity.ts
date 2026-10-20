const STORAGE_KEY = 'piano-song-activity';
const MAX_TRACKED_SONGS = 500;

export type SongActivity = Map<string, number>;

/** Return valid persisted song-open timestamps, keyed by song ID. */
export function getSongActivity(): SongActivity {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Map();

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return new Map();
    }

    return new Map(
      Object.entries(parsed)
        .filter((entry): entry is [string, number] => (
          entry[0].length > 0
          && typeof entry[1] === 'number'
          && Number.isFinite(entry[1])
          && entry[1] >= 0
        )),
    );
  } catch {
    return new Map();
  }
}

/** Persist a successful song open so the library can put it first next time. */
export function recordSongActivity(songId: string, openedAt: number = Date.now()): void {
  if (!songId || !Number.isFinite(openedAt) || openedAt < 0) return;

  const activity = getSongActivity();
  activity.set(songId, Math.trunc(openedAt));

  const recentEntries = [...activity.entries()]
    .sort(([, left], [, right]) => right - left)
    .slice(0, MAX_TRACKED_SONGS);

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(recentEntries)));
  } catch {
    // The current session still works when storage is blocked or full.
  }
}
