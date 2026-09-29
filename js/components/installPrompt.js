// public/js/components/installPrompt.js
// "Install this app" banner, shown once per user.
// Chrome/Edge/Android fire `beforeinstallprompt`, which index.html stashes on
// window.__installPrompt. iOS Safari never fires it, so that case falls back to
// manual Share -> Add to Home Screen instructions.
//
// Note on styling: css/tailwind.css is a purged build containing only the
// classes the app actually uses, and this branch has no tailwind.config.js to
// rebuild it. So every class below is already present in the compiled CSS, and
// positioning uses inline styles rather than a utility that may not exist.
import { t } from '../core/i18n.js';
import { escapeHtml } from '../core/utils.js';
import { toast } from './toast.js';

const DISMISS_KEY = 'lms.install.dismissedAt';
const DONE_KEY = 'lms.install.done';
const REDISPLAY_AFTER_DAYS = 14;

let banner = null;

function isStandalone() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: window-controls-overlay)').matches ||
    navigator.standalone === true
  );
}

function isIos() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent || '');
}

// True when the user dismissed recently, or has already installed.
function isDismissed() {
  if (localStorage.getItem(DONE_KEY) === '1') return true;
  const at = parseInt(localStorage.getItem(DISMISS_KEY) || '0', 10);
  if (!at) return false;
  if ((Date.now() - at) / 86400000 < REDISPLAY_AFTER_DAYS) return true;
  localStorage.removeItem(DISMISS_KEY);
  return false;
}

function hide() {
  if (banner) { banner.remove(); banner = null; }
}

function dismiss() {
  localStorage.setItem(DISMISS_KEY, String(Date.now()));
  hide();
}

function bodyHtml() {
  if (isIos()) {
    return `
      <p class="text-sm text-slate-600 dark:text-slate-300 mb-2">${escapeHtml(t('install.iosHint'))}</p>
      <p class="text-sm text-slate-600 dark:text-slate-300 space-y-1">
        <span class="block">1. ${escapeHtml(t('install.iosStep1'))}</span>
        <span class="block">2. ${escapeHtml(t('install.iosStep2'))}</span>
      </p>`;
  }
  return `<p class="text-sm text-slate-600 dark:text-slate-300">${escapeHtml(t('install.body'))}</p>`;
}

function show() {
  if (banner || isStandalone() || isDismissed()) return;

  const canPrompt = Boolean(window.__installPrompt);
  banner = document.createElement('div');
  banner.id = 'install-banner';
  banner.setAttribute('role', 'dialog');
  banner.setAttribute('aria-label', t('install.title'));
  banner.className =
    'fixed z-[9000] bg-white dark:bg-slate-800 rounded-card shadow-card ' +
    'border border-slate-200 dark:border-slate-700 p-4';
  // Centred at the bottom on every screen size, above the offline banner.
  banner.style.cssText = 'left:50%;transform:translateX(-50%);bottom:1rem;width:min(92vw,24rem);';

  banner.innerHTML = `
    <div class="flex items-start gap-3">
      <img src="/images/icon.png" alt="" class="w-11 h-11 rounded-input flex-shrink-0" />
      <div class="min-w-0 flex-1">
        <h2 class="font-heading font-semibold text-slate-800 dark:text-slate-100">${escapeHtml(t('install.title'))}</h2>
        <div class="mt-1">${bodyHtml()}</div>
      </div>
      <button id="install-close" class="text-slate-400 hover:text-slate-600 dark:text-slate-200" aria-label="${escapeHtml(t('common.close'))}">
        <i data-lucide="x" class="w-5 h-5"></i>
      </button>
    </div>
    ${
      canPrompt
        ? `<div class="flex gap-2 mt-4">
             <button id="install-accept" class="inline-flex items-center justify-center gap-2 px-4 py-2 rounded-input text-sm font-medium min-h-[44px] bg-primary text-white hover:bg-primary-700 disabled:opacity-50 flex-1">${escapeHtml(t('install.accept'))}</button>
             <button id="install-later" class="inline-flex items-center justify-center px-4 py-2 rounded-input text-sm font-medium min-h-[44px] bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200">${escapeHtml(t('install.later'))}</button>
           </div>`
        : `<button id="install-later" class="inline-flex items-center justify-center w-full px-4 py-2 mt-4 rounded-input text-sm font-medium min-h-[44px] bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200">${escapeHtml(t('install.gotIt'))}</button>`
    }`;

  document.body.appendChild(banner);
  if (window.lucide) window.lucide.createIcons();

  banner.querySelector('#install-close').addEventListener('click', dismiss);
  banner.querySelector('#install-later').addEventListener('click', dismiss);

  const accept = banner.querySelector('#install-accept');
  if (!accept) return;

  accept.addEventListener('click', async () => {
    const evt = window.__installPrompt;
    if (!evt) return;
    // prompt() must run inside a user gesture, so it stays in this handler.
    accept.disabled = true;
    try {
      evt.prompt();
      const choice = await evt.userChoice;
      if (choice && choice.outcome === 'accepted') {
        localStorage.setItem(DONE_KEY, '1');
        hide();
      } else {
        dismiss();
      }
    } catch (err) {
      console.warn('[install] prompt failed:', err.message);
      hide();
    } finally {
      window.__installPrompt = null;
    }
  });
}

export function initInstallPrompt() {
  if (!('serviceWorker' in navigator)) return;
  if (isStandalone() || isDismissed()) return;

  // Chrome/Edge/Opera: only shown once the browser actually offers the prompt.
  window.addEventListener('lms:installable', () => {
    // Delay so it does not collide with the login screen or a toast.
    setTimeout(show, 1500);
  });
  window.addEventListener('lms:installed', () => {
    localStorage.setItem(DONE_KEY, '1');
    hide();
  });

  // iOS never fires the event, so offer the manual route instead.
  if (isIos()) setTimeout(show, 4000);
}

// For an "Install app" entry in Settings or the topbar, for users who already
// dismissed the banner. Resolves to true when the app was installed.
export async function promptInstallNow() {
  const evt = window.__installPrompt;
  if (!evt) {
    toast(t('install.failed'), 'warning');
    return false;
  }
  try {
    evt.prompt();
    const choice = await evt.userChoice;
    const accepted = Boolean(choice && choice.outcome === 'accepted');
    if (accepted) {
      localStorage.setItem(DONE_KEY, '1');
      hide();
    }
    return accepted;
  } catch (err) {
    console.warn('[install] prompt failed:', err.message);
    return false;
  }
}

export { isStandalone, isIos };
