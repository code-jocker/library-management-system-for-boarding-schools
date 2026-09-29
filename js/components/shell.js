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

      <!-- Sidebar: fixed on desktop, drawer on mobile. The collapse width is
           applied in css/app.css behind a min-width query rather than here, so
           a desktop collapse never shrinks the phone drawer to an icon sliver. -->
      <aside id="sidebar"
        class="fixed lg:sticky top-0 left-0 z-40 h-screen bg-primary transition-transform duration-200 -translate-x-full lg:translate-x-0 w-64">
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

  const sidebarEl = document.getElementById('sidebar');
  const overlay = document.getElementById('mobile-overlay');
  const menuBtn = () => document.getElementById('menu-toggle');

  // Desktop collapse only. Below lg the drawer is always full width, so the
  // class is a no-op there via the media query in css/app.css.
  const applyCollapsed = (collapsed) => {
    if (sidebarEl) sidebarEl.classList.toggle('is-collapsed', Boolean(collapsed));
  };
  applyCollapsed(getState().sidebarCollapsed);
  const unsubWidth = subscribe('sidebarCollapsed', applyCollapsed);

  // Mobile drawer open/close.
  const applyOpen = (open) => {
    if (!sidebarEl || !overlay) return;
    if (open) { sidebarEl.classList.remove('-translate-x-full'); overlay.classList.remove('hidden'); }
    else { sidebarEl.classList.add('-translate-x-full'); overlay.classList.add('hidden'); }
    const btn = menuBtn();
    if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    // Stop the page behind the drawer from scrolling with it.
    document.body.classList.toggle('drawer-open', Boolean(open) && window.innerWidth < 1024);
  };
  const unsubMobile = subscribe('sidebarOpenMobile', applyOpen);
  // A drawer left open across a rotate or a resize to desktop width would trap
  // the user behind it, so close it whenever the viewport stops being a phone.
  const onViewportChange = () => {
    if (getState().sidebarOpenMobile && window.innerWidth >= 1024) set({ sidebarOpenMobile: false });
  };
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('orientationchange', onViewportChange);

  overlay.addEventListener('click', () => set({ sidebarOpenMobile: false }));

  // Escape closes the drawer, matching the dropdown and modal behaviour.
  const onKeydown = (e) => {
    if (e.key === 'Escape' && getState().sidebarOpenMobile) {
      set({ sidebarOpenMobile: false });
      const btn = menuBtn();
      if (btn) btn.focus();
    }
  };
  document.addEventListener('keydown', onKeydown);

  // Opening the drawer moves focus into it so keyboard and screen-reader users
  // are not left behind on the page underneath.
  const unsubFocus = subscribe('sidebarOpenMobile', (open) => {
    if (!open) return;
    const first = sidebarEl && sidebarEl.querySelector('a[href], button');
    if (first) first.focus();
  });

  sidebarUnsub = () => {
    if (unsubWidth) unsubWidth();
    if (unsubFocus) unsubFocus();
  };
  mobileUnsub = () => {
    if (unsubMobile) unsubMobile();
    window.removeEventListener('resize', onViewportChange);
    window.removeEventListener('orientationchange', onViewportChange);
    document.removeEventListener('keydown', onKeydown);
  };
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
