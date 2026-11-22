// Minimal IndexedDB wrapper. Everything lives on this device only.
export const DB_NAME = 'sluzhinnya';
export const DB_VERSION = 1;
export const STORES = ['entries', 'notes', 'territories', 'photos', 'kv'];

let dbp;

export function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' }).createIndex('date', 'date');
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('territories')) db.createObjectStore('territories', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('photos')) db.createObjectStore('photos', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('База даних заблокована іншою вкладкою'));
  });
  return dbp;
}

function run(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const req = fn(s);
    if (req) req.onsuccess = () => { result = req.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('Транзакцію скасовано'));
  }));
}

export const db = {
  all: (store) => run(store, 'readonly', (s) => s.getAll()),
  get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
  put: (store, value) => run(store, 'readwrite', (s) => s.put(value)),
  del: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
  clear: (store) => run(store, 'readwrite', (s) => s.clear()),
  async getKV(key, fallback = null) {
    const r = await run('kv', 'readonly', (s) => s.get(key));
    return r ? r.value : fallback;
  },
  setKV: (key, value) => run('kv', 'readwrite', (s) => s.put({ key, value })),
  /** Replace the contents of several stores in one transaction. */
  replaceAll(data) {
    return openDB().then((d) => new Promise((resolve, reject) => {
      const names = Object.keys(data);
      const t = d.transaction(names, 'readwrite');
      for (const n of names) {
        const s = t.objectStore(n);
        s.clear();
        for (const v of data[n]) s.put(v);
      }
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('Імпорт скасовано'));
    }));
  },
};
