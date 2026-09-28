// public/js/app.js
// Bootstrap: load settings, restore session, start the router, wire offline
// banner and keyboard shortcuts.
import { getState, set, subscribe } from './core/store.js';
import { api } from './core/api.js';
import { getToken, getStoredUser, startInactivityTracking, stopInactivityTracking } from './core/auth.js';
import { startRouter, navigate } from './core/router.js';
import { t, applyTranslations } from './core/i18n.js';
import { toast } from './components/toast.js';
import { initOfflineSync, prefetchMirror } from './core/offline.js';

// Apply saved theme immediately to avoid a flash.
document.documentElement.classList.toggle('dark', getState().theme === 'dark');
document.documentElement.lang = getState().language;

async function bootstrap() {
  // Load settings first (needed for branding + money formatting everywhere).
  try {
    if (getToken()) {
      const res = await api.get('/settings');
      if (res && res.data) set({ settings: res.data.settings });
      const me = await api.get('/auth/me');
      if (me && me.data) set({ user: me.data.user });
    } else {
      // Settings are useful on the login screen too (logo, school name).
      const res = await api.get('/settings');
      if (res && res.data) set({ settings: res.data.settings });
    }
  } catch (e) {
    // Non-fatal: the app still works, branding just falls back to defaults.
    if (e && e.status !== 401) console.warn('[app] settings preload failed:', e.message);
  }

  applyTitleFromSettings();
  subscribe('settings', applyTitleFromSettings);

  // Keep the overdue badge fresh while authenticated.
  subscribe('user', async (user) => {
    if (user && getToken()) {
      startInactivityTracking();
      refreshOverdueCount();
      prefetchMirror(); // warm the offline mirror after login
    } else {
      stopInactivityTracking();
      set({ overdueCount: 0 });
    }
  });
  if (getToken()) { startInactivityTracking(); refreshOverdueCount(); }

  // Start routing.
  startRouter();

  // Offline banner.
  wireOfflineBanner();
  // Keyboard shortcuts.
  wireShortcuts();
  // Service worker (installable + offline).
  registerServiceWorker();
  // Offline draft queue + background sync.
  initOfflineSync();

  // Refresh the overdue count every 2 minutes while on the app.
  setInterval(() => { if (getToken()) refreshOverdueCount(); }, 120000);
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch((err) => {
      console.warn('[app] service worker registration failed:', err.message);
    });
  };
  // Module scripts can run after 'load' has already fired, so register now if
  // the document is settled and otherwise wait for load (a minor perf nicety).
  if (document.readyState === 'complete' || document.readyState === 'interactive') register();
  else window.addEventListener('load', register, { once: true });
}

function applyTitleFromSettings() {
  const s = getState().settings;
  const base = t('app.name');
  document.title = s && s.schoolName ? `${base} | ${s.schoolName}` : base;
}

async function refreshOverdueCount() {
  try {
    const res = await api.get('/transactions/overdue');
    const n = (res.data && res.data.total) || 0;
    if (getState().overdueCount !== n) set({ overdueCount: n });
  } catch (e) { /* ignore transient errors */ }
}

function wireOfflineBanner() {
  const banner = document.getElementById('offline-banner');
  const update = () => {
    if (!navigator.onLine) banner.classList.remove('hidden');
    else banner.classList.add('hidden');
  };
  window.addEventListener('online', update);
  window.addEventListener('offline', update);
  update();
}

function wireShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Ignore when typing in a field (except Esc).
    const tag = document.activeElement && document.activeElement.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement && document.activeElement.isContentEditable);

    if (e.altKey && (e.key === 'i' || e.key === 'I')) { e.preventDefault(); navigate('/issue'); }
    else if (e.altKey && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); navigate('/return'); }
    // "/" handled in globalSearch.js so it can also work when not typing.
  });
}

// Kick everything off once the DOM is ready.
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bootstrap);
else bootstrap();
