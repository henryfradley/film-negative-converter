/// Tiny IndexedDB wrapper for persisting loaded frames across page reloads.
/// Stores the ORIGINAL file buffer + tone/crop params. On boot we re-decode
/// the buffers (fast — a few seconds per frame in WASM) rather than caching
/// the huge decoded pixel arrays (a 24MP frame is ~280MB decoded vs ~40MB
/// compressed as a DNG).

import type { StretchParams } from './gl';

const DB_NAME = 'film-lab';
const DB_VERSION = 1;
const STORE = 'frames';

export interface SavedFrame {
  id: number;
  name: string;
  type: string;
  buffer: ArrayBuffer;
  params: StretchParams;
  cropUV: [number, number, number, number];
  mode: 'edit' | 'preview';
  order: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function saveFrame(f: SavedFrame): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(f);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

/// Update just the tone/crop params for an existing frame.
export async function updateFrame(id: number,
  patch: Partial<Pick<SavedFrame, 'params' | 'cropUV' | 'mode' | 'order'>>): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const get = store.get(id);
    get.onsuccess = () => {
      const existing = get.result as SavedFrame | undefined;
      if (!existing) { resolve(); return; }
      store.put({ ...existing, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function deleteFrame(id: number): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}

export async function loadAllFrames(): Promise<SavedFrame[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result as SavedFrame[]).sort((a, b) => a.order - b.order);
      resolve(rows);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function clearAll(): Promise<void> {
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  });
}
