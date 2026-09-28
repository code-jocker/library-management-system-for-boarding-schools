// public/js/core/auth.js
// Token storage (localStorage), session helpers, and a 30-minute inactivity
// auto-logout with a warning modal at 28 minutes.
import { set } from './store.js';

const TOKEN_KEY = 'lms.token';
const USER_KEY = 'lms.user';
const REMEMBER_KEY = 'lms.remember';

const INACTIVITY_LIMIT_MS = 30 * 60 * 1000; // 30 minutes
const WARNING_AT_MS = 28 * 60 * 1000;       // warn at 28 minutes

let lastActivity = Date.now();
let warningShown = false;
let warningTimer = null;
let logoutTimer = null;
let unauthorizedHandler = null;

// ---- Token / user storage ----
export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setSession(token, user, remember = false) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  if (remember) localStorage.setItem(REMEMBER_KEY, '1');
  else localStorage.removeItem(REMEMBER_KEY);
  set({ user });
}

export function getStoredUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch { return null; }
}

export function updateUser(user) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
  set({ user });
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
  set({ user: null });
}

export function isAuthenticated() {
  return !!getToken();
}

export function isRemembered() {
  return localStorage.getItem(REMEMBER_KEY) === '1';
}

// ---- 401 handling hook (set by router to avoid a circular import) ----
export function registerUnauthorized(handler) {
  unauthorizedHandler = handler;
}

export function onUnauthorized() {
  if (typeof unauthorizedHandler === 'function') unauthorizedHandler();
}

// ---- Inactivity auto-logout ----
const ACTIVITY_EVENTS = ['mousedown', 'keydown', 'touchstart', 'scroll', 'click'];

function markActive() {
  lastActivity = Date.now();
  if (warningShown) hideWarning();
  schedule();
}

function schedule() {
  clearTimeout(warningTimer);
  clearTimeout(logoutTimer);
  const waitWarn = Math.max(0, WARNING_AT_MS - (Date.now() - lastActivity));
  const waitLogout = Math.max(0, INACTIVITY_LIMIT_MS - (Date.now() - lastActivity));
  warningTimer = setTimeout(showWarning, waitWarn);
  logoutTimer = setTimeout(forceLogout, waitLogout);
}

function showWarning() {
  warningShown = true;
  // Lazily import modal + i18n to avoid a cycle at load time.
  import('../components/modal.js').then(({ openModal, closeModal }) => {
    import('./i18n.js').then(({ t }) => {
      const id = openModal({
        title: t('auth.stillThere'),
        dismissible: false,
        body: `<p class="text-slate-600 dark:text-slate-300">${t('auth.inactivityWarning')}</p>`,
        actions: [
          {
            label: t('auth.stayLoggedIn'),
            variant: 'primary',
            onClick: () => { closeModal(id); markActive(); }
          },
          {
            label: t('auth.logoutNow'),
            variant: 'ghost',
            onClick: () => { closeModal(id); forceLogout(); }
          }
        ]
      });
    });
  });
}

function hideWarning() {
  warningShown = false;
  import('../components/modal.js').then(({ closeAllModals }) => closeAllModals());
}

function forceLogout() {
  clearSession();
  stopInactivityTracking();
  if (location.hash !== '#/login') location.hash = '#/login';
  import('../components/toast.js').then(({ toast }) => {
    import('./i18n.js').then(({ t }) => toast(t('auth.loggedOutInactivity'), 'warning'));
  });
}

export function startInactivityTracking() {
  stopInactivityTracking();
  lastActivity = Date.now();
  ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, markActive, { passive: true }));
  schedule();
}

export function stopInactivityTracking() {
  clearTimeout(warningTimer);
  clearTimeout(logoutTimer);
  warningShown = false;
  ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, markActive));
}
