import type { SongInfo } from './types';

const DB_NAME = 'piano-practice';
const DB_VERSION = 1;
const SONGS_STORE = 'uploaded-songs';

interface StoredSong {
  id: string;
  title: string;
  data: ArrayBuffer;
  uploadedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    let blocked = false;
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SONGS_STORE)) {
        db.createObjectStore(SONGS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      if (blocked) {
        request.result.close();
      } else {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('Failed to open song storage'));
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Song storage upgrade is blocked by another tab'));
    };
  });
}

async function runRequest<T>(
  mode: IDBTransactionMode,
  createRequest: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    let transaction: IDBTransaction;
    let request: IDBRequest<T>;
    try {
      transaction = db.transaction(SONGS_STORE, mode);
      request = createRequest(transaction.objectStore(SONGS_STORE));
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    let result: T;
    let settled = false;

    const fail = (error: DOMException | null): void => {
      if (settled) return;
      settled = true;
      db.close();
      reject(error ?? new Error('Song storage transaction failed'));
    };

    request.onsuccess = () => {
      result = request.result;
    };
    request.onerror = () => fail(request.error);
    transaction.oncomplete = () => {
      if (settled) return;
      settled = true;
      db.close();
      resolve(result);
    };
    transaction.onerror = () => fail(transaction.error);
    transaction.onabort = () => fail(transaction.error);
  });
}

export async function saveUploadedSong(id: string, title: string, data: ArrayBuffer): Promise<void> {
  await runRequest('readwrite', store => store.put({
    id,
    title,
    data,
    uploadedAt: Date.now(),
  } satisfies StoredSong));
}

export async function getUploadedSongs(): Promise<{ info: SongInfo; data: ArrayBuffer }[]> {
  const stored = await runRequest<StoredSong[]>('readonly', store => store.getAll());
  return stored.map(song => ({
    info: {
      id: song.id,
      title: song.title,
      url: '',
      source: 'uploaded' as const,
    },
    data: song.data,
  }));
}

export async function deleteUploadedSong(id: string): Promise<void> {
  await runRequest('readwrite', store => store.delete(id));
}

export async function getUploadedSongData(id: string): Promise<ArrayBuffer | null> {
  const stored = await runRequest<StoredSong | undefined>('readonly', store => store.get(id));
  return stored?.data ?? null;
}
