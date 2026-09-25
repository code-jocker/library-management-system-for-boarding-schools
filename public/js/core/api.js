// public/js/core/api.js
// One fetch wrapper for the whole SPA: JSON, auth header, timeout, abort,
// retry-once for GETs, normalized errors, in-memory cache, 401 handling.
// Also the offline integration point: successful GETs feed the IndexedDB
// mirror, and writes made offline (or that hit a network failure) are queued
// as drafts and replayed later by core/offline.js.
import { getToken, clearSession, onUnauthorized } from './auth.js';
import { mirrorResponse, queueDraft, isOffline, readFromMirror } from './offline.js';

// API base URL - can be overridden at runtime via window.LMS_API_BASE
// Defaults to '/api' for same-origin (when served by Express)
// For Firebase hosting, set to your Render backend URL (e.g., 'https://your-api.onrender.com/api')
const BASE = (typeof window !== 'undefined' && window.LMS_API_BASE) || '/api';
const DEFAULT_TIMEOUT = 20000;

// In-memory cache for rarely-changing data (settings, categories, lists).
const cache = new Map();

// Writes to these paths are never queued as offline drafts (auth is meaningless
// to replay later; it must succeed live).
function canQueue(path) {
  return !path.startsWith('/auth');
}

// A fetch that failed for connectivity reasons (no HTTP status, not our timeout).
function isNetworkError(err) {
  return !!err && !err.status && err.name !== 'AbortError';
}

function cacheKey(method, url, body) {
  return `${method}:${url}:${body ? JSON.stringify(body) : ''}`;
}

export function invalidateCache(match) {
  for (const key of [...cache.keys()]) {
    if (!match || key.includes(match)) cache.delete(key);
  }
}

// When a queued draft finally syncs, cached reads are stale — drop them all.
if (typeof window !== 'undefined') {
  window.addEventListener('lms:synced', () => invalidateCache());
}

// Build a normalized error object from a response or thrown error.
function normalizeError(status, payload, fallbackMessage) {
  return {
    status,
    message: (payload && payload.message) || fallbackMessage || 'Request failed',
    fieldErrors: (payload && payload.errors) || undefined,
    data: payload && payload.data
  };
}

/**
 * Core request function.
 * @param {string} method
 * @param {string} path        e.g. '/books?page=2'
 * @param {object} [options]
 *   body, signal (AbortSignal), timeout, cache (bool), retry (bool), raw (bool)
 */
async function request(method, path, options = {}) {
  const {
    body,
    signal: externalSignal,
    timeout = DEFAULT_TIMEOUT,
    cache: useCache = false,
    retry = method === 'GET',
    raw = false
  } = options;

  const key = cacheKey(method, path, body);
  if (useCache && cache.has(key)) return cache.get(key);

  // Offline write: queue as a draft instead of hitting the network.
  if (method !== 'GET' && canQueue(path) && isOffline()) {
    return queueDraft(method, path, body);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  // Link an external abort signal (tied to the current view).
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  const headers = { 'Content-Type': 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  const doFetch = async () => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    if (res.status === 401) {
      clearSession();
      onUnauthorized();
      throw normalizeError(401, null, 'Session expired');
    }

    // Some endpoints (CSV) may return text; default to JSON.
    const text = await res.text();
    let payload = null;
    if (text) {
      try { payload = JSON.parse(text); }
      catch { payload = raw ? text : { message: text }; }
    }

    if (!res.ok) {
      throw normalizeError(res.status, payload, `Request failed (${res.status})`);
    }
    // Keep the offline mirror fresh from every successful read.
    if (method === 'GET' && payload && payload.data) mirrorResponse(path, payload);
    return payload;
  };

  try {
    let result;
    try {
      result = await doFetch();
    } catch (err) {
      const isWrite = method !== 'GET';
      // A write that failed for connectivity reasons becomes a queued draft.
      if (isWrite && canQueue(path) && isNetworkError(err)) {
        clearTimeout(timer);
        return queueDraft(method, path, body);
      }
      // Retry once for GETs on network/abort/5xx errors only.
      const isRetryable = retry && (err.name === 'AbortError' || !err.status || err.status >= 500);
      if (isRetryable && !controller.signal.aborted) {
        result = await doFetch();
      } else {
        // Offline read: fall back to the local mirror if we have the data.
        if (!isWrite && isOffline()) {
          const mirrored = await readFromMirror(path);
          if (mirrored) {
            clearTimeout(timer);
            if (useCache) cache.set(key, mirrored);
            return mirrored;
          }
        }
        throw err;
      }
    }
    if (useCache) cache.set(key, result);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

// Convenience verbs.
export const api = {
  get: (path, opts = {}) => request('GET', path, { cache: true, ...opts }),
  post: (path, body, opts = {}) => request('POST', path, { body, ...opts }),
  put: (path, body, opts = {}) => request('PUT', path, { body, ...opts }),
  del: (path, opts = {}) => request('DELETE', path, opts),
  request
};

export default api;
