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
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(SONGS_STORE)) {
        db.createObjectStore(SONGS_STORE, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function saveUploadedSong(id: string, title: string, data: ArrayBuffer): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SONGS_STORE, 'readwrite');
    const store = tx.objectStore(SONGS_STORE);
    store.put({ id, title, data, uploadedAt: Date.now() } satisfies StoredSong);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getUploadedSongs(): Promise<{ info: SongInfo; data: ArrayBuffer }[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SONGS_STORE, 'readonly');
    const store = tx.objectStore(SONGS_STORE);
    const request = store.getAll();
    request.onsuccess = () => {
      const stored: StoredSong[] = request.result;
      db.close();
      resolve(
        stored.map(s => ({
          info: {
            id: s.id,
            title: s.title,
            url: '',
            source: 'uploaded' as const,
          },
          data: s.data,
        }))
      );
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}

export async function deleteUploadedSong(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SONGS_STORE, 'readwrite');
    const store = tx.objectStore(SONGS_STORE);
    store.delete(id);
    tx.oncomplete = () => { db.close(); resolve(); };
    tx.onerror = () => { db.close(); reject(tx.error); };
  });
}

export async function getUploadedSongData(id: string): Promise<ArrayBuffer | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SONGS_STORE, 'readonly');
    const store = tx.objectStore(SONGS_STORE);
    const request = store.get(id);
    request.onsuccess = () => {
      const stored: StoredSong | undefined = request.result;
      db.close();
      resolve(stored?.data ?? null);
    };
    request.onerror = () => { db.close(); reject(request.error); };
  });
}
