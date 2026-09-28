// public/js/components/shell.js
// Renders the two layouts: 'auth' (bare) and 'app' (sidebar + topbar + view).
// Called by the router on every navigation.
import { getState, set, subscribe } from '../core/store.js';
import { sidebarHtml, mountSidebar, highlightActive } from './sidebar.js';
import { topbarHtml, mountTopbar, setTopbarTitle } from './topbar.js';
import { breadcrumbs } from './breadcrumbs.js';

let currentLayout = null;
let sidebarUnsub = null;
let topbarUnsub = null;
let mobileUnsub = null;

export function renderShell(layout) {
  const app = document.getElementById('app');

  if (layout === currentLayout && document.getElementById('view-container')) {
    return; // already in the right layout
  }

  // Tear down previous shell subscriptions.
  if (sidebarUnsub) { sidebarUnsub(); sidebarUnsub = null; }
  if (topbarUnsub) { topbarUnsub(); topbarUnsub = null; }
  if (mobileUnsub) { mobileUnsub(); mobileUnsub = null; }

  currentLayout = layout;

  if (layout === 'auth') {
    app.innerHTML = `<div id="view-container" class="min-h-screen"></div>`;
    return;
  }

  // App shell.
  app.innerHTML = `
    <div class="min-h-screen flex bg-surface dark:bg-slate-900">
      <!-- Mobile overlay -->
      <div id="mobile-overlay" class="hidden fixed inset-0 bg-slate-900/50 z-30 lg:hidden"></div>

      <!-- Sidebar: fixed on desktop, drawer on mobile -->
      <aside id="sidebar"
        class="fixed lg:sticky top-0 left-0 z-40 h-screen bg-primary transition-transform duration-200 -translate-x-full lg:translate-x-0
        ${getState().sidebarCollapsed ? 'w-[72px]' : 'w-64'}"
        style="width: ${getState().sidebarCollapsed ? '72px' : '256px'}">
        <div id="sidebar-inner"></div>
      </aside>

      <div class="flex-1 flex flex-col min-w-0">
        <header class="sticky top-0 z-20 bg-white dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700" id="topbar"></header>
        <div id="crumbs" class="px-4 sm:px-6 pt-4"></div>
        <main id="view-container" class="flex-1 p-4 sm:p-6"></main>
      </div>
    </div>`;

  // Mount sidebar + topbar.
  const sidebarRoot = document.getElementById('sidebar-inner');
  sidebarUnsub = mountSidebar(sidebarRoot);
  const topbarRoot = document.getElementById('topbar');
  topbarUnsub = mountTopbar(topbarRoot);

  // Sidebar width reacts to collapse state.
  const unsubWidth = subscribe('sidebarCollapsed', (collapsed) => {
    const sb = document.getElementById('sidebar');
    if (sb) sb.style.width = collapsed ? '72px' : '256px';
  });

  // Mobile drawer open/close.
  const unsubMobile = subscribe('sidebarOpenMobile', (open) => {
    const sb = document.getElementById('sidebar');
    const ov = document.getElementById('mobile-overlay');
    if (!sb || !ov) return;
    if (open) { sb.classList.remove('-translate-x-full'); ov.classList.remove('hidden'); }
    else { sb.classList.add('-translate-x-full'); ov.classList.add('hidden'); }
  });
  document.getElementById('mobile-overlay').addEventListener('click', () => set({ sidebarOpenMobile: false }));

  sidebarUnsub = () => { if (unsubWidth) unsubWidth(); };
  mobileUnsub = () => { if (unsubMobile) unsubMobile(); };
}

export function setShellTitle(title) {
  setTopbarTitle(title);
}

export function setShellActive(pathname) {
  const inner = document.getElementById('sidebar-inner');
  if (inner) highlightActive(inner, pathname);
  // Close the mobile drawer on navigation.
  if (getState().sidebarOpenMobile) set({ sidebarOpenMobile: false });
}

// Exposed globally so the router can set breadcrumbs per view.
window.__setCrumbs = (crumbs) => {
  const el = document.getElementById('crumbs');
  if (!el) return;
  el.innerHTML = breadcrumbs(crumbs || []);
  if (window.lucide) window.lucide.createIcons();
};
