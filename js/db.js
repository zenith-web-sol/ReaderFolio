// IndexedDB wrapper. Everything lives in the visitor's browser; nothing is uploaded anywhere.
//   books   – metadata, progress, per-book stats
//   covers  – cover images (data URLs)
//   content – extracted, reflowable text (chapters/blocks)
//   files   – the original PDF blobs
//   notes   – bookmarks + highlights per book
//   kv      – misc (custom fonts, imported backups waiting for their PDF)

const DB_NAME = 'folio';
const DB_VERSION = 1;
const STORES = { books: 'id', covers: 'id', content: 'id', files: 'id', notes: 'id', kv: 'key' };

let dbPromise;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('This browser does not support local storage for books (IndexedDB).')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Storage is blocked by another open tab. Close other Folio tabs and reload.'));
  });
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let result;
    const req = fn(tx.objectStore(store));
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Storage transaction aborted'));
  });
}

export const dbGet = (store, key) => run(store, 'readonly', (s) => s.get(key));
export const dbPut = (store, value) => run(store, 'readwrite', (s) => s.put(value));
export const dbDelete = (store, key) => run(store, 'readwrite', (s) => s.delete(key));
export const dbAll = (store) => run(store, 'readonly', (s) => s.getAll());

/** Write several stores atomically (used when adding a book). */
export async function dbPutMany(entries) {
  const db = await open();
  const names = [...new Set(entries.map((e) => e[0]))];
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    for (const [store, value] of entries) tx.objectStore(store).put(value);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Could not save the book (storage may be full).'));
  });
}

export async function deleteBook(id) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const names = ['books', 'covers', 'content', 'files', 'notes'];
    const tx = db.transaction(names, 'readwrite');
    for (const n of names) tx.objectStore(n).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function kvGet(key, fallback = null) {
  const row = await dbGet('kv', key);
  return row ? row.value : fallback;
}
export const kvSet = (key, value) => dbPut('kv', { key, value });
