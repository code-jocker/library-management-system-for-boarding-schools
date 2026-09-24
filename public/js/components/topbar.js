// public/js/components/topbar.js
// Top bar: hamburger, page title, global search, notification bell, dark-mode
// toggle, language switch, and the librarian profile menu.
import { escapeHtml } from '../core/utils.js';
import { t } from '../core/i18n.js';
import { getState, set, subscribe } from '../core/store.js';
import { getStoredUser, clearSession } from '../core/auth.js';
import { avatar } from './avatar.js';
import { attachDropdown } from './dropdown.js';
import { mountGlobalSearch } from './globalSearch.js';
import { navigate } from '../core/router.js';
import { getLanguages, setLanguage } from '../core/i18n.js';
import { syncNow } from '../core/offline.js';
import { toast } from './toast.js';

export function topbarHtml() {
  const u = getStoredUser() || {};
  const s = getState();
  return `
    <div class="flex items-center gap-3 h-16 px-4">
      <button id="menu-toggle" class="lg:hidden p-2 rounded-input text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 min-w-[44px] min-h-[44px]" aria-label="Menu">
        <i data-lucide="menu" class="w-6 h-6"></i>
      </button>

      <h1 id="page-title" class="font-heading font-semibold text-lg text-slate-800 dark:text-slate-100 truncate hidden sm:block"></h1>

      <!-- Global quick search -->
      <div class="flex-1 max-w-md relative ml-auto sm:ml-4">
        <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
        <input id="global-search" type="search" autocomplete="off"
          placeholder="${escapeHtml(t('common.searchPlaceholder'))}"
          aria-label="${escapeHtml(t('common.search'))}"
          class="w-full rounded-input border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 pl-9 pr-3 py-2.5 text-sm min-h-[44px] focus:border-primary focus:ring-2 focus:ring-primary/20" />
        <div id="global-search-results" class="hidden absolute left-0 right-0 mt-2 bg-white dark:bg-slate-800 rounded-card shadow-card border border-slate-200 dark:border-slate-700 overflow-hidden max-h-[70vh] overflow-y-auto z-50"></div>
      </div>

      <div class="flex items-center gap-1">
        <!-- Offline sync: pending-drafts badge + manual "Sync now" -->
        <button id="sync-toggle" type="button" class="relative p-2 rounded-input text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 min-w-[44px] min-h-[44px] flex items-center justify-center" title="${escapeHtml(t('offline.syncNow'))}" aria-label="${escapeHtml(t('offline.syncNow'))}">
          <i data-lucide="refresh-cw" id="sync-icon" class="w-5 h-5"></i>
          <span id="sync-count" class="hidden absolute -top-0.5 -right-0.5 bg-secondary text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">0</span>
        </button>

        <!-- Notification bell -->
        <a href="#/overdue" id="notif-bell" class="relative p-2 rounded-input text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 min-w-[44px] min-h-[44px] flex items-center justify-center" title="${escapeHtml(t('nav.overdue'))}">
          <i data-lucide="bell" class="w-5 h-5"></i>
          <span id="notif-count" class="hidden absolute -top-0.5 -right-0.5 bg-danger text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1">0</span>
        </a>

        <!-- Dark mode -->
        <button id="theme-toggle" class="p-2 rounded-input text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 min-w-[44px] min-h-[44px]" title="${escapeHtml(t('common.darkMode'))}">
          <i data-lucide="${s.theme === 'dark' ? 'sun' : 'moon'}" class="w-5 h-5"></i>
        </button>

        <!-- Language -->
        <button id="lang-toggle" class="p-2 rounded-input text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 min-w-[44px] min-h-[44px] font-medium text-sm" title="${escapeHtml(t('common.language'))}">
          ${escapeHtml((s.language || 'en').toUpperCase())}
        </button>

        <!-- Profile -->
        <button id="profile-toggle" class="flex items-center gap-2 pl-1 pr-2 py-1 rounded-input hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[44px]" aria-haspopup="true" aria-expanded="false">
          ${avatar({ src: u.avatar, name: u.fullName || 'Librarian', size: 'sm' })}
          <span class="hidden md:block text-sm font-medium text-slate-700 dark:text-slate-200 max-w-[140px] truncate">${escapeHtml(t('auth.welcome') + ', ' + (u.fullName || ''))}</span>
          <i data-lucide="chevron-down" class="w-4 h-4 text-slate-400"></i>
        </button>
      </div>
    </div>`;
}

export function mountTopbar(root) {
  root.innerHTML = topbarHtml();
  if (window.lucide) window.lucide.createIcons();

  const unsubscribers = [];

  // Hamburger toggles the mobile drawer.
  root.querySelector('#menu-toggle').addEventListener('click', () => {
    set({ sidebarOpenMobile: !getState().sidebarOpenMobile });
  });

  // Global search.
  unsubscribers.push(mountGlobalSearch(root.querySelector('#global-search'), root.querySelector('#global-search-results')));

  // Theme toggle.
  const themeBtn = root.querySelector('#theme-toggle');
  themeBtn.addEventListener('click', () => {
    const next = getState().theme === 'dark' ? 'light' : 'dark';
    set({ theme: next });
    themeBtn.innerHTML = `<i data-lucide="${next === 'dark' ? 'sun' : 'moon'}" class="w-5 h-5"></i>`;
    if (window.lucide) window.lucide.createIcons();
  });

  // Language toggle (cycles through available languages).
  const langBtn = root.querySelector('#lang-toggle');
  langBtn.addEventListener('click', () => {
    const langs = getLanguages();
    const idx = langs.findIndex((l) => l.code === getState().language);
    const next = langs[(idx + 1) % langs.length].code;
    setLanguage(next);
  });

  // Profile menu.
  attachDropdown(root.querySelector('#profile-toggle'), [
    { label: t('nav.profile'), icon: 'user', onClick: () => navigate('/profile') },
    { label: t('nav.changePassword'), icon: 'key-round', onClick: () => navigate('/change-password') },
    { divider: true },
    { label: t('nav.logout'), icon: 'log-out', danger: true, onClick: () => { clearSession(); navigate('/login', { replace: true }); } }
  ]);

  // Notification bell reflects overdue count.
  const unsubOverdue = subscribe('overdueCount', (n) => updateBell(root, n));
  unsubscribers.push(unsubOverdue);
  updateBell(root, getState().overdueCount);

  // Offline sync widget: manual sync + live pending-drafts badge.
  wireSyncWidget(root, unsubscribers);

  // Re-render labels when language changes.
  const unsubLang = subscribe('language', () => {
    root.innerHTML = topbarHtml();
    if (window.lucide) window.lucide.createIcons();
    mountTopbarHandlers(root, unsubscribers);
  });
  unsubscribers.push(unsubLang);

  return () => { unsubscribers.forEach((u) => typeof u === 'function' && u()); };
}

// Re-attach handlers after an innerHTML re-render (language change).
function mountTopbarHandlers(root, unsubscribers) {
  root.querySelector('#menu-toggle').addEventListener('click', () => set({ sidebarOpenMobile: !getState().sidebarOpenMobile }));
  unsubscribers.push(mountGlobalSearch(root.querySelector('#global-search'), root.querySelector('#global-search-results')));
  const themeBtn = root.querySelector('#theme-toggle');
  themeBtn.addEventListener('click', () => {
    const next = getState().theme === 'dark' ? 'light' : 'dark';
    set({ theme: next });
    themeBtn.innerHTML = `<i data-lucide="${next === 'dark' ? 'sun' : 'moon'}" class="w-5 h-5"></i>`;
    if (window.lucide) window.lucide.createIcons();
  });
  root.querySelector('#lang-toggle').addEventListener('click', () => {
    const langs = getLanguages();
    const idx = langs.findIndex((l) => l.code === getState().language);
    setLanguage(langs[(idx + 1) % langs.length].code);
  });
  attachDropdown(root.querySelector('#profile-toggle'), [
    { label: t('nav.profile'), icon: 'user', onClick: () => navigate('/profile') },
    { label: t('nav.changePassword'), icon: 'key-round', onClick: () => navigate('/change-password') },
    { divider: true },
    { label: t('nav.logout'), icon: 'log-out', danger: true, onClick: () => { clearSession(); navigate('/login', { replace: true }); } }
  ]);
  updateBell(root, getState().overdueCount);
  wireSyncWidget(root, unsubscribers);
}

function updateBell(root, count) {
  const el = root.querySelector('#notif-count');
  if (!el) return;
  if (count > 0) { el.textContent = count > 99 ? '99+' : String(count); el.classList.remove('hidden'); }
  else el.classList.add('hidden');
}

// Attach the sync button handler + store subscriptions (idempotent per render).
function wireSyncWidget(root, unsubscribers) {
  const btn = root.querySelector('#sync-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => handleSyncClick(root));
  const redraw = () => updateSyncWidget(root);
  unsubscribers.push(subscribe('pendingDrafts', redraw));
  unsubscribers.push(subscribe('erroredDrafts', redraw));
  unsubscribers.push(subscribe('syncState', redraw));
  redraw();
}

async function handleSyncClick(root) {
  const s = getState();
  if (s.syncState === 'syncing') return;
  if (!s.pendingDrafts) { toast(t('offline.noPending'), 'info'); return; }
  updateSyncWidget(root, 'syncing');
  const { synced, remaining } = await syncNow();
  if (remaining > 0 && getState().erroredDrafts > 0) toast(t('offline.syncError'), 'error');
  else if (synced > 0) toast(t('offline.syncedCount', { n: synced }), 'success');
  else toast(t('offline.synced'), 'success');
  updateSyncWidget(root);
}

// Reflect pending drafts + sync state on the widget.
function updateSyncWidget(root, overrideState) {
  const btn = root.querySelector('#sync-toggle');
  if (!btn) return;
  const s = getState();
  const state = overrideState || s.syncState;
  const icon = root.querySelector('#sync-icon');
  const count = root.querySelector('#sync-count');
  const pending = s.pendingDrafts || 0;
  const errored = s.erroredDrafts || 0;

  // Badge
  if (count) {
    if (pending > 0) {
      count.textContent = pending > 99 ? '99+' : String(pending);
      count.classList.remove('hidden');
      count.classList.toggle('bg-danger', errored > 0);
      count.classList.toggle('bg-secondary', errored === 0);
    } else {
      count.classList.add('hidden');
    }
  }

  // Icon spin + color
  if (icon) {
    icon.classList.toggle('animate-spin', state === 'syncing');
  }
  btn.classList.toggle('text-danger', errored > 0 && state !== 'syncing');
  btn.setAttribute('title', errored > 0
    ? t('offline.erroredCount', { n: errored })
    : (pending > 0 ? t('offline.pendingCount', { n: pending }) : t('offline.noPending')));
}

export function setTopbarTitle(title) {
  const el = document.getElementById('page-title');
  if (el) el.textContent = title;
}
