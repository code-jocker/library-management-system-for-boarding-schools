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
import { initInstallPrompt } from './components/installPrompt.js';
import { connectSocket, onSocket } from './core/socket.js';

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
  if (getToken()) { startInactivityTracking(); refreshOverdueCount(); requestPushPermission(); }

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
  // "Install this app" banner on a user's first visit.
  initInstallPrompt();
  // Real-time updates + push notifications (if logged in).
  connectSocket();
  onSocket('dashboard:update', () => refreshOverdueCount());
  onSocket('notifications:push', (data) => {
    toast(data.title || 'New notification', 'info');
    refreshOverdueCount();
  });

// Refresh the overdue count every 2 minutes while on the app.
setInterval(() => { if (getToken()) refreshOverdueCount(); }, 120000);

// Request browser push permission and save the subscription.
async function requestPushPermission() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return;

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleProperties: ['title', 'body', 'icon'],
    applicationServerKey: localStorage.getItem('lms_push_key') || undefined
  });
  if (!sub) return;

  try {
    const res = await api.get('/notifications/channels');
    if (res?.data?.push?.available && res.data.push.vapidPublicKey) {
      localStorage.setItem('lms_push_key', res.data.push.vapidPublicKey);
    }
  } catch { /* ignore */ }

  await api.post('/notifications/subscribe', {
    endpoint: sub.endpoint,
    keys: {
      p256dh: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('p256dh')))),
      auth: btoa(String.fromCharCode(...new Uint8Array(sub.getKey('auth'))))
    }
  }).catch((err) => console.warn('[app] push subscription failed:', err.message));
}
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
