// public/js/core/offline.js
// Offline sync manager. Two responsibilities:
//   1. Keep the IndexedDB read-mirror fresh from successful GET responses.
//   2. Queue writes made while offline (drafts) and replay them, in order,
//      when connectivity returns — on 'online', on app start, on an interval,
//      or when the user taps "Sync now".
// Sync progress is published to the store (pendingDrafts / syncState / ...).

import { getToken } from './auth.js';
import { getState, set } from './store.js';
import { t } from './i18n.js';
import * as db from './db.js';

const API_BASE = '/api';
const SYNC_INTERVAL_MS = 30000; // periodic background sync attempt
let syncing = false;
let started = false;

// ---------------------------------------------------------------------------
// Read mirror: persist GET results so they are browsable offline.
// ---------------------------------------------------------------------------

/**
 * Mirror a successful GET response into IndexedDB based on its path.
 * Safe to call with any path; unknown paths are ignored.
 * @param {string} path  request path, e.g. '/books?page=2'
 * @param {object} payload parsed JSON response body
 */
export async function mirrorResponse(path, payload) {
  if (!payload || !payload.data) return;
  const data = payload.data;
  const route = path.split('?')[0];

  try {
    if (route === '/books') {
      if (Array.isArray(data.items)) await db.mirrorBooks(data.items);
    } else if (route.startsWith('/books/')) {
      if (data.book && data.book._id) await db.mirrorBooks([data.book]);
    } else if (route === '/members') {
      if (Array.isArray(data.items)) await db.mirrorMembers(data.items);
    } else if (route === '/members/lookup') {
      if (data.member && data.member._id) await db.mirrorMembers([data.member]);
    } else if (route.startsWith('/members/')) {
      if (data.member && data.member._id) await db.mirrorMembers([data.member]);
    } else if (route === '/categories') {
      if (Array.isArray(data.items)) await db.mirrorCategories(data.items);
    } else if (route === '/settings') {
      if (data.settings) await db.mirrorSettings(data.settings);
    }
  } catch (err) {
    // Mirroring is best-effort; never break a successful request over it.
    console.warn('[offline] mirror failed:', err.message);
  }
}

// Prefetch the core lists so offline browse has data even before the user
// navigates to each screen. Called after login and when coming back online.
export async function prefetchMirror() {
  if (!getToken()) return;
  const headers = authHeaders();
  const targets = [
    ['/books?limit=100', (d) => db.mirrorBooks(d.items)],
    ['/members?limit=100', (d) => db.mirrorMembers(d.items)],
    ['/categories', (d) => db.mirrorCategories(d.items)],
    ['/settings', (d) => db.mirrorSettings(d.settings)]
  ];
  await Promise.allSettled(targets.map(async ([path, write]) => {
    const res = await fetch(`${API_BASE}${path}`, { headers });
    if (!res.ok) return;
    const json = await res.json();
    if (json && json.data) await write(json.data);
  }));
  refreshCounts();
}

function authHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

/**
 * Build a synthetic GET response from the local mirror when the network is
 * unavailable. Returns null for paths we do not mirror, so the caller can
 * surface a normal offline error instead.
 * @param {string} path e.g. '/books?q=har&titleOnly=1&limit=12'
 */
export async function readFromMirror(path) {
  const [route, qs] = path.split('?');
  const params = new URLSearchParams(qs || '');
  const limit = parseInt(params.get('limit'), 10) || 50;

  try {
    if (route === '/books') {
      const items = await db.searchBooks(params.get('q') || '', {
        titleOnly: params.get('titleOnly') === '1',
        limit
      });
      return listPayload(items, limit);
    }
    if (route === '/members') {
      const items = await db.searchMembers(params.get('q') || '', { limit });
      return listPayload(items, limit);
    }
    if (route === '/categories') {
      const items = await db.getAllCategories();
      return { success: true, data: { items }, offline: true };
    }
    if (route === '/settings') {
      const settings = await db.getSettings();
      return settings ? { success: true, data: { settings }, offline: true } : null;
    }
    if (route === '/members/lookup') {
      const member = await db.getMemberByAdmissionNo(params.get('admissionNo') || '');
      if (!member) return null;
      return {
        success: true,
        offline: true,
        data: {
          member, loans: [], activeLoanCount: 0, borrowingLimit: member.borrowingLimit || 3,
          overdueCount: 0, overdueFine: 0, unpaidFines: 0
        }
      };
    }
  } catch (err) {
    console.warn('[offline] mirror read failed:', err.message);
  }
  return null;
}

function listPayload(items, limit) {
  return {
    success: true,
    offline: true,
    data: { items, total: items.length, page: 1, pages: 1, limit }
  };
}


// ---------------------------------------------------------------------------
// Write queue (drafts)
// ---------------------------------------------------------------------------

export function isOffline() {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/**
 * Enqueue a write as a draft and return a synthetic success response so the
 * calling view can proceed (show a toast, reset the form) without a server.
 */
export async function queueDraft(method, path, body) {
  const id = await db.addOutbox({ method, path, body });
  await refreshCounts();
  return {
    success: true,
    queued: true,
    message: t('offline.savedDraft'),
    data: { queued: true, draftId: id, offline: true }
  };
}

/**
 * Replay every queued draft in insertion order.
 * - 2xx  -> remove from the outbox.
 * - 4xx  -> mark as 'error' (bad data; keep for the user to review) and continue.
 * - 5xx / network -> leave 'pending' and stop this pass (retry later).
 */
export async function syncNow() {
  if (syncing) return { synced: 0, remaining: await db.countOutbox() };
  if (isOffline()) return { synced: 0, remaining: await db.countOutbox() };

  const entries = await db.getOutbox();
  if (!entries.length) {
    set({ syncState: 'idle', lastSyncAt: new Date().toISOString() });
    await refreshCounts();
    return { synced: 0, remaining: 0 };
  }

  syncing = true;
  set({ syncState: 'syncing' });
  let synced = 0;
  let hadError = false;

  try {
    for (const entry of entries) {
      await db.updateOutbox(entry.id, { status: 'syncing', attempts: (entry.attempts || 0) + 1 });
      let res;
      try {
        res = await fetch(`${API_BASE}${entry.path}`, {
          method: entry.method,
          headers: authHeaders(),
          body: entry.body ? JSON.stringify(entry.body) : undefined
        });
      } catch (networkErr) {
        // Lost connectivity mid-sync: keep it pending and stop.
        await db.updateOutbox(entry.id, { status: 'pending', lastError: networkErr.message });
        break;
      }

      if (res.ok) {
        await db.removeOutbox(entry.id);
        synced += 1;
        // A successful write may change server state; drop cached reads.
        window.dispatchEvent(new CustomEvent('lms:synced', { detail: { entry } }));
      } else if (res.status >= 400 && res.status < 500) {
        let message = `Request failed (${res.status})`;
        try { const j = await res.json(); if (j && j.message) message = j.message; } catch { /* ignore */ }
        await db.updateOutbox(entry.id, { status: 'error', lastError: message });
        hadError = true;
      } else {
        // 5xx: transient server problem — leave pending, stop this pass.
        await db.updateOutbox(entry.id, { status: 'pending', lastError: `Server error (${res.status})` });
        break;
      }
    }
  } finally {
    syncing = false;
  }

  const remaining = await db.countOutbox();
  set({
    syncState: hadError ? 'error' : 'idle',
    lastSyncAt: synced ? new Date().toISOString() : getState().lastSyncAt
  });
  await refreshCounts();
  return { synced, remaining };
}

// ---------------------------------------------------------------------------
// Store publishing
// ---------------------------------------------------------------------------

export async function refreshCounts() {
  try {
    const summary = await db.getOutboxSummary();
    set({ pendingDrafts: summary.total, erroredDrafts: summary.errored });
  } catch {
    set({ pendingDrafts: 0, erroredDrafts: 0 });
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

export function initOfflineSync() {
  if (started) return;
  started = true;

  refreshCounts();

  window.addEventListener('online', () => {
    set({ syncState: 'idle' });
    prefetchMirror();
    syncNow();
  });
  window.addEventListener('offline', () => set({ syncState: 'idle' }));

  // Kick an initial sync shortly after boot (covers "opened while online").
  setTimeout(() => { if (getToken()) prefetchMirror().then(syncNow); }, 1500);

  // Periodic background attempt.
  setInterval(() => { if (!isOffline() && getToken()) syncNow(); }, SYNC_INTERVAL_MS);
}
