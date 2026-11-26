// AI V2 — 轻量 IndexedDB KV，用于大块会话数据
const DB_NAME = 'githubm_ai_state';
const STORE = 'kv';
const VERSION = 1;
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise(resolve => {
    try {
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

export async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(key);
      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbSet(key: string, value: unknown): Promise<boolean> {
  return idbWrite([[key, value]]);
}

export async function idbWrite(entries: [string, unknown][], deletedKeys: string[] = []): Promise<boolean> {
  return mutateStore(store => writeEntries(store, entries, deletedKeys));
}

function writeEntries(store: IDBObjectStore, entries: [string, unknown][], deletedKeys: string[]): void {
  for (const key of deletedKeys) store.delete(key);
  for (const [key, value] of entries) store.put(value, key);
}

export function idbUpdate<T>(
  key: string,
  update: (previous: T | undefined) => { entries: [string, unknown][]; deletedKeys: string[] },
): Promise<boolean> {
  return mutateStore((store, tx) => {
    const request = store.get(key);
    request.onsuccess = () => {
      try {
        const { entries, deletedKeys } = update(request.result as T | undefined);
        writeEntries(store, entries, deletedKeys);
      } catch {
        tx.abort();
      }
    };
  });
}

export function idbDelete(key: string): Promise<boolean> {
  return idbWrite([], [key]);
}

function prefixRange(prefix: string): IDBKeyRange {
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`);
}

async function mutateStore(mutate: (store: IDBObjectStore, tx: IDBTransaction) => void): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
      try {
        mutate(tx.objectStore(STORE), tx);
      } catch {
        tx.abort();
      }
    } catch {
      resolve(false);
    }
  });
}

export function idbDeletePrefixes(prefixes: string[], keys: string[] = []): Promise<boolean> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(true);
  return mutateStore(store => {
    for (const prefix of prefixes) store.delete(prefixRange(prefix));
    for (const key of keys) store.delete(key);
  });
}

/** Read the manifest and its chunks in one transaction. */
export async function idbGetGroup<T, C>(key: string, prefix: string): Promise<{ value: T | null; chunks: C[] }> {
  const empty = { value: null, chunks: [] };
  const db = await openDb();
  if (!db) return empty;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const store = tx.objectStore(STORE);
      const value = store.get(key);
      const chunks = store.getAll(prefixRange(prefix));
      tx.oncomplete = () => resolve({ value: value.result as T ?? null, chunks: chunks.result as C[] });
      tx.onerror = () => resolve(empty);
      tx.onabort = () => resolve(empty);
    } catch {
      resolve(empty);
    }
  });
}

export async function idbKeys(prefix: string): Promise<string[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).getAllKeys(prefixRange(prefix));
      request.onsuccess = () => resolve(
        (request.result || []).map(String).filter(key => key.startsWith(prefix)),
      );
      request.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}