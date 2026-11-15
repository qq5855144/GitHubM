// AI V2 — Artifact 正文 IndexedDB 存储（localStorage 只保留小型索引）
const DB_NAME = 'githubm_ai_artifacts';
const STORE = 'contents';
const VERSION = 1;

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
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
}

function keyOf(login: string | undefined, id: string): string {
  return `${encodeURIComponent(login || 'anonymous')}:${id}`;
}

export async function putArtifactContent(login: string | undefined, id: string, content: string): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(content, keyOf(login, id));
      tx.oncomplete = () => { db.close(); resolve(true); };
      tx.onerror = () => { db.close(); resolve(false); };
      tx.onabort = () => { db.close(); resolve(false); };
    } catch {
      db.close();
      resolve(false);
    }
  });
}

export async function getArtifactContent(login: string | undefined, id: string): Promise<string | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(keyOf(login, id));
      request.onsuccess = () => {
        db.close();
        resolve(typeof request.result === 'string' ? request.result : null);
      };
      request.onerror = () => { db.close(); resolve(null); };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function deleteArtifactContent(login: string | undefined, id: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(keyOf(login, id));
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  } catch {
    db.close();
  }
}

export async function clearArtifactContents(login: string | undefined): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    const prefix = `${encodeURIComponent(login || 'anonymous')}:`;
    const request = store.openCursor();
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return;
      if (String(cursor.key).startsWith(prefix)) cursor.delete();
      cursor.continue();
    };
    tx.oncomplete = () => db.close();
    tx.onerror = () => db.close();
  } catch {
    db.close();
  }
}