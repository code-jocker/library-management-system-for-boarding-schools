// public/js/core/store.js
// Tiny publish/subscribe store for global UI state.
const state = {
  user: null,
  settings: null,
  language: localStorage.getItem('lms.lang') || 'en',
  theme: localStorage.getItem('lms.theme') || 'light',
  sidebarCollapsed: localStorage.getItem('lms.sidebar') === 'collapsed',
  sidebarOpenMobile: false,
  overdueCount: 0,
  // Offline sync state (see core/offline.js).
  pendingDrafts: 0,   // number of queued writes waiting to sync
  erroredDrafts: 0,   // drafts that failed with a non-retryable error
  syncState: 'idle',  // idle | syncing | error
  lastSyncAt: null    // ISO timestamp of the last successful sync
};

const listeners = new Map(); // key -> Set<fn>

function getState() {
  return state;
}

// Subscribe to a single key or to any change (omit key). Returns an unsubscribe fn.
function subscribe(key, fn) {
  const k = key || '*';
  if (!listeners.has(k)) listeners.set(k, new Set());
  listeners.get(k).add(fn);
  return () => listeners.get(k).delete(fn);
}

function emit(changedKey) {
  const notify = (set) => set && set.forEach((fn) => {
    try { fn(state[changedKey], changedKey, state); } catch (e) { console.error('[store] listener error', e); }
  });
  notify(listeners.get(changedKey));
  notify(listeners.get('*'));
}

function set(patch) {
  const changed = [];
  for (const [k, v] of Object.entries(patch)) {
    if (state[k] !== v) { state[k] = v; changed.push(k); }
  }
  // Persist the bits that should survive a reload.
  if ('language' in patch) localStorage.setItem('lms.lang', state.language);
  if ('theme' in patch) {
    localStorage.setItem('lms.theme', state.theme);
    document.documentElement.classList.toggle('dark', state.theme === 'dark');
  }
  if ('sidebarCollapsed' in patch) {
    localStorage.setItem('lms.sidebar', state.sidebarCollapsed ? 'collapsed' : 'expanded');
  }
  changed.forEach(emit);
}

export { getState, subscribe, set };
