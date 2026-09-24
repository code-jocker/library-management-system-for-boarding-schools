// public/js/components/sidebar.js
// Fixed left sidebar. Collapsible to icons on tablet, off-canvas drawer on phone.
import { escapeHtml } from '../core/utils.js';
import { t } from '../core/i18n.js';
import { getState, set, subscribe } from '../core/store.js';

const NAV = [
  { path: '/dashboard', icon: 'layout-dashboard', key: 'nav.dashboard' },
  { path: '/books', icon: 'book-open', key: 'nav.books' },
  { path: '/categories', icon: 'tags', key: 'nav.categories' },
  { path: '/members', icon: 'users', key: 'nav.members' },
  { divider: true, labelKey: 'nav.issue' },
  { path: '/issue', icon: 'log-in', key: 'nav.issue' },
  { path: '/return', icon: 'log-out', key: 'nav.return' },
  { path: '/transactions', icon: 'list', key: 'nav.transactions' },
  { path: '/overdue', icon: 'alert-triangle', key: 'nav.overdue' },
  { path: '/fines', icon: 'badge-dollar-sign', key: 'nav.fines' },
  { path: '/reservations', icon: 'bookmark', key: 'nav.reservations' },
  { divider: true },
  { path: '/reports', icon: 'bar-chart-3', key: 'nav.reports' },
  { path: '/clearance', icon: 'file-check', key: 'nav.clearance' },
  { path: '/settings', icon: 'settings', key: 'nav.settings' }
];

export function sidebarHtml() {
  const s = getState();
  const settings = s.settings || {};
  return `
    <div class="flex h-full flex-col">
      <div class="flex items-center gap-3 px-4 h-16 border-b border-white/10 flex-shrink-0">
        ${settings.logo
          ? `<img src="${escapeHtml(settings.logo)}" alt="" class="w-9 h-9 rounded object-cover bg-white" />`
          : `<div class="w-9 h-9 rounded bg-white/15 flex items-center justify-center"><i data-lucide="library" class="w-5 h-5 text-white"></i></div>`}
        <div class="brand-text min-w-0 ${s.sidebarCollapsed ? 'hidden' : ''}">
          <p class="text-white font-heading font-semibold text-sm truncate">${escapeHtml(settings.schoolName || 'School')}</p>
          <p class="text-white/60 text-xs truncate">${escapeHtml(t('app.name'))}</p>
        </div>
      </div>
      <nav class="flex-1 overflow-y-auto scroll-slim py-3 px-2 space-y-1" aria-label="Main">
        ${NAV.map((item) => {
          if (item.divider) {
            return `<div class="my-2 border-t border-white/10"></div>`;
          }
          return `<a href="#${item.path}" data-nav="${item.path}"
            class="nav-item group flex items-center gap-3 px-3 py-2.5 rounded-input text-white/80 hover:bg-white/10 hover:text-white transition-colors min-h-[44px]"
            title="${escapeHtml(t(item.key))}">
            <i data-lucide="${item.icon}" class="w-5 h-5 flex-shrink-0"></i>
            <span class="nav-label ${s.sidebarCollapsed ? 'hidden' : ''} text-sm font-medium truncate">${escapeHtml(t(item.key))}</span>
          </a>`;
        }).join('')}
      </nav>
      <div class="px-2 py-3 border-t border-white/10 flex-shrink-0">
        <button id="sidebar-collapse" class="w-full flex items-center gap-3 px-3 py-2.5 rounded-input text-white/70 hover:bg-white/10 hover:text-white min-h-[44px]" title="${escapeHtml(t('common.close'))}">
          <i data-lucide="${s.sidebarCollapsed ? 'chevrons-right' : 'chevrons-left'}" class="w-5 h-5 flex-shrink-0"></i>
          <span class="nav-label ${s.sidebarCollapsed ? 'hidden' : ''} text-sm">Collapse</span>
        </button>
      </div>
    </div>`;
}

export function mountSidebar(root) {
  root.innerHTML = sidebarHtml();
  if (window.lucide) window.lucide.createIcons();

  const collapseBtn = root.querySelector('#sidebar-collapse');
  collapseBtn.addEventListener('click', () => {
    set({ sidebarCollapsed: !getState().sidebarCollapsed });
  });

  // Re-render when collapse state or settings change.
  const unsub = subscribe('*', (val, key) => {
    if (key === 'sidebarCollapsed' || key === 'settings' || key === 'language') {
      root.innerHTML = sidebarHtml();
      if (window.lucide) window.lucide.createIcons();
      root.querySelector('#sidebar-collapse').addEventListener('click', () => set({ sidebarCollapsed: !getState().sidebarCollapsed }));
      highlightActive(root);
    }
  });
  return unsub;
}

export function highlightActive(root, pathname) {
  const path = pathname || location.hash.replace(/^#/, '').split('?')[0];
  root.querySelectorAll('[data-nav]').forEach((a) => {
    const p = a.getAttribute('data-nav');
    const active = path === p || (p !== '/dashboard' && path.startsWith(p + '/'));
    a.classList.toggle('bg-white/15', active);
    a.classList.toggle('text-white', active);
    a.setAttribute('aria-current', active ? 'page' : 'false');
  });
}

export { NAV };
