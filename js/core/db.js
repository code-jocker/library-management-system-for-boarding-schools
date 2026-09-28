// public/js/core/db.js
// Local IndexedDB layer that powers full offline use:
//   - A read mirror of books / members / categories / settings (last synced data).
//   - A write "outbox" of pending drafts (queued POST/PUT/DELETE) to replay online.
// Everything is promise-wrapped; callers never touch raw IDB requests.

const DB_NAME = 'lms-offline';
const DB_VERSION = 1;

const STORES = {
  books: 'books',
  members: 'members',
  categories: 'categories',
  settings: 'settings',
  outbox: 'outbox'
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.books)) db.createObjectStore(STORES.books, { keyPath: '_id' });
      if (!db.objectStoreNames.contains(STORES.members)) db.createObjectStore(STORES.members, { keyPath: '_id' });
      if (!db.objectStoreNames.contains(STORES.categories)) db.createObjectStore(STORES.categories, { keyPath: '_id' });
      if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings);
      // Outbox keeps insertion order via an auto-increment key so drafts replay FIFO.
      if (!db.objectStoreNames.contains(STORES.outbox)) db.createObjectStore(STORES.outbox, { keyPath: 'id', autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// True when the browser can persist offline data at all.
export async function isSupported() {
  try { await openDB(); return true; } catch { return false; }
}

function tx(storeName, mode) {
  return openDB().then((db) => db.transaction(storeName, mode).objectStore(storeName));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// ---- Generic helpers ----

async function putMany(storeName, records) {
  if (!Array.isArray(records) || !records.length) return;
  const store = await tx(storeName, 'readwrite');
  await Promise.all(records.map((r) => reqToPromise(store.put(r))));
}

async function getAll(storeName) {
  const store = await tx(storeName, 'readonly');
  return reqToPromise(store.getAll());
}

async function getByKey(storeName, key) {
  const store = await tx(storeName, 'readonly');
  return reqToPromise(store.get(key));
}

async function deleteByKey(storeName, key) {
  const store = await tx(storeName, 'readwrite');
  return reqToPromise(store.delete(key));
}

async function clearStore(storeName) {
  const store = await tx(storeName, 'readwrite');
  return reqToPromise(store.clear());
}

// ---- Mirror writes (called after a successful GET) ----

export const mirrorBooks = (items) => putMany(STORES.books, items);
export const mirrorMembers = (items) => putMany(STORES.members, items);
export const mirrorCategories = (items) => putMany(STORES.categories, items);
export async function mirrorSettings(settings) {
  if (!settings) return;
  const store = await tx(STORES.settings, 'readwrite');
  return reqToPromise(store.put(settings, 'current'));
}

// Remove a single mirrored record (e.g. after a confirmed delete).
export const removeBook = (id) => deleteByKey(STORES.books, id);
export const removeMember = (id) => deleteByKey(STORES.members, id);

// ---- Mirror reads (used when offline) ----

export const getAllBooks = () => getAll(STORES.books);
export const getAllMembers = () => getAll(STORES.members);
export const getAllCategories = () => getAll(STORES.categories);
export const getBook = (id) => getByKey(STORES.books, id);
export const getMember = (id) => getByKey(STORES.members, id);
export async function getSettings() {
  const store = await tx(STORES.settings, 'readonly');
  return reqToPromise(store.get('current'));
}

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

// Case-insensitive title/author/isbn search over the mirrored books.
export async function searchBooks(q, { titleOnly = false, limit = 50 } = {}) {
  const all = await getAllBooks();
  const needle = (q || '').trim().toLowerCase();
  const rx = needle ? new RegExp(escapeRe(needle), 'i') : null;
  let out = all;
  if (rx) {
    out = all.filter((b) => (titleOnly
      ? rx.test(b.title || '')
      : rx.test(b.title || '') || rx.test(b.author || '') || rx.test(b.isbn || '')));
  }
  return out.slice(0, limit);
}

// Search mirrored members by name / admission number / guardian.
export async function searchMembers(q, { limit = 50 } = {}) {
  const all = await getAllMembers();
  const needle = (q || '').trim().toLowerCase();
  if (!needle) return all.slice(0, limit);
  const rx = new RegExp(escapeRe(needle), 'i');
  return all
    .filter((m) => rx.test(m.fullName || '') || rx.test(m.admissionNo || '') || rx.test(m.guardianName || ''))
    .slice(0, limit);
}

export async function getMemberByAdmissionNo(no) {
  const needle = String(no || '').trim().toUpperCase();
  if (!needle) return null;
  const all = await getAllMembers();
  return all.find((m) => String(m.admissionNo || '').toUpperCase() === needle) || null;
}

// ---- Outbox (pending drafts) ----

export async function addOutbox(entry) {
  const store = await tx(STORES.outbox, 'readwrite');
  const record = {
    method: entry.method,
    path: entry.path,
    body: entry.body || null,
    createdAt: new Date().toISOString(),
    status: 'pending', // pending | syncing | error
    attempts: 0,
    lastError: null
  };
  return reqToPromise(store.add(record)); // resolves to the new id
}

export const getOutbox = () => getAll(STORES.outbox);
export const countOutbox = async () => (await getAll(STORES.outbox)).length;

export async function updateOutbox(id, patch) {
  const store = await tx(STORES.outbox, 'readwrite');
  const existing = await reqToPromise(store.get(id));
  if (!existing) return null;
  const next = { ...existing, ...patch };
  await reqToPromise(store.put(next));
  return next;
}

export const removeOutbox = (id) => deleteByKey(STORES.outbox, id);

// A draft is "errored" (needs manual attention) once it has a non-retryable status.
export async function getOutboxSummary() {
  const all = await getOutbox();
  return {
    total: all.length,
    pending: all.filter((o) => o.status !== 'error').length,
    errored: all.filter((o) => o.status === 'error').length
  };
}

export { STORES, clearStore };
