// public/js/core/router.js
// Hash-based router with params, query state, guards, lazy view loading,
// and a strict view contract: every view exports mount(ctx) -> unmount().
import { getState, set, subscribe } from './store.js';
import { isAuthenticated, getStoredUser, registerUnauthorized } from './auth.js';
import { t } from './i18n.js';
import { parseQuery, buildQuery } from './utils.js';
import { renderShell, setShellActive, setShellTitle } from '../components/shell.js';
import { toast } from '../components/toast.js';

// Route table. `view` is a dynamic import path relative to /js/.
const routes = [
  { path: '/login', view: 'views/login.js', titleKey: 'nav.login', public: true, layout: 'auth' },
  { path: '/change-password', view: 'views/changePassword.js', titleKey: 'nav.changePassword', layout: 'auth', forceWhenMustChange: true },
  { path: '/dashboard', view: 'views/dashboard.js', titleKey: 'nav.dashboard', crumb: ['nav.dashboard'] },
  { path: '/books', view: 'views/books.js', titleKey: 'nav.books', crumb: ['nav.books'] },
  { path: '/books/:id', view: 'views/bookDetails.js', titleKey: 'nav.bookDetails', crumb: ['nav.books', 'nav.bookDetails'] },
  { path: '/categories', view: 'views/categories.js', titleKey: 'nav.categories', crumb: ['nav.categories'] },
  { path: '/members', view: 'views/members.js', titleKey: 'nav.members', crumb: ['nav.members'] },
  { path: '/members/:id', view: 'views/memberProfile.js', titleKey: 'nav.memberProfile', crumb: ['nav.members', 'nav.memberProfile'] },
  { path: '/issue', view: 'views/issueBook.js', titleKey: 'nav.issue', crumb: ['nav.issue'] },
  { path: '/return', view: 'views/returnBook.js', titleKey: 'nav.return', crumb: ['nav.return'] },
  { path: '/transactions', view: 'views/transactions.js', titleKey: 'nav.transactions', crumb: ['nav.transactions'] },
  { path: '/overdue', view: 'views/overdue.js', titleKey: 'nav.overdue', crumb: ['nav.overdue'] },
  { path: '/fines', view: 'views/fines.js', titleKey: 'nav.fines', crumb: ['nav.fines'] },
  { path: '/reservations', view: 'views/reservations.js', titleKey: 'nav.reservations', crumb: ['nav.reservations'] },
  { path: '/reports', view: 'views/reports.js', titleKey: 'nav.reports', crumb: ['nav.reports'] },
  { path: '/clearance', view: 'views/clearance.js', titleKey: 'nav.clearance', crumb: ['nav.clearance'] },
  { path: '/settings', view: 'views/settings.js', titleKey: 'nav.settings', crumb: ['nav.settings'] },
  { path: '/profile', view: 'views/profile.js', titleKey: 'nav.profile', crumb: ['nav.profile'] },
  { path: '/404', view: 'views/notFound.js', titleKey: 'nav.notFound', public: true, layout: 'auth' }
];

let currentUnmount = null;
let currentAbort = null;
let dirtyGuard = null; // set by a view with unsaved changes
let lastHash = '';

// ---- Path matching ----
function matchRoute(pathname) {
  for (const r of routes) {
    const params = matchPath(r.path, pathname);
    if (params) return { route: r, params };
  }
  return null;
}

function matchPath(pattern, pathname) {
  const pSeg = pattern.split('/').filter(Boolean);
  const aSeg = pathname.split('/').filter(Boolean);
  if (pSeg.length !== aSeg.length) return null;
  const params = {};
  for (let i = 0; i < pSeg.length; i++) {
    if (pSeg[i].startsWith(':')) params[pSeg[i].slice(1)] = decodeURIComponent(aSeg[i]);
    else if (pSeg[i] !== aSeg[i]) return null;
  }
  return params;
}

// ---- Navigation helpers ----
export function navigate(path, { replace = false } = {}) {
  const target = path.startsWith('#') ? path : `#${path}`;
  if (replace) history.replaceState(null, '', target);
  else location.hash = target;
  if (replace) handleRoute(); // replaceState doesn't fire hashchange
}

export function setQuery(patch) {
  const [path, search] = location.hash.replace(/^#/, '').split('?');
  const q = parseQuery(search || '');
  Object.assign(q, patch);
  const next = `#${path}${buildQuery(q)}`;
  if (next !== location.hash) history.replaceState(null, '', next);
}

export function registerDirtyGuard(fn) {
  dirtyGuard = fn; // fn returns true if there are unsaved changes
}

// ---- Route change handler ----
async function handleRoute() {
  const hash = location.hash.replace(/^#/, '') || '/dashboard';
  const [pathname, search] = hash.split('?');
  const query = parseQuery(search || '');

  // Warn before leaving a view with unsaved changes.
  if (lastHash && lastHash !== hash && dirtyGuard && dirtyGuard()) {
    const ok = window.confirm(t('common.unsavedChanges'));
    if (!ok) { history.replaceState(null, '', `#${lastHash}`); return; }
  }
  dirtyGuard = null;
  lastHash = pathname + (search ? '?' + search : '');

  const matched = matchRoute(pathname);
  const route = matched ? matched.route : null;
  const params = matched ? matched.params : {};

  const authed = isAuthenticated();

  // ---- Guards ----
  if (!route) { navigate('/404', { replace: true }); return; }

  if (!route.public && !authed) {
    navigate('/login', { replace: true });
    return;
  }
  if (route.path === '/login' && authed) {
    navigate('/dashboard', { replace: true });
    return;
  }
  const user = getStoredUser();
  if (authed && user && user.mustChangePassword && !route.forceWhenMustChange && route.path !== '/login') {
    navigate('/change-password', { replace: true });
    return;
  }
  if (authed && user && !user.mustChangePassword && route.path === '/change-password') {
    navigate('/dashboard', { replace: true });
    return;
  }

  // ---- Tear down the previous view ----
  if (currentAbort) { currentAbort.abort(); currentAbort = null; }
  if (typeof currentUnmount === 'function') {
    try { currentUnmount(); } catch (e) { console.error('[router] unmount error', e); }
  }
  currentUnmount = null;

  // ---- Ensure the correct layout/shell ----
  const layout = route.layout || 'app';
  renderShell(layout);

  // ---- Prepare per-navigation context ----
  currentAbort = new AbortController();
  const container = document.getElementById('view-container');
  if (!container) return;
  container.innerHTML = '<div class="p-6"><div class="animate-pulse space-y-3"><div class="h-8 bg-slate-200 dark:bg-slate-700 rounded w-1/3"></div><div class="h-64 bg-slate-200 dark:bg-slate-700 rounded"></div></div></div>';

  const title = t(route.titleKey);
  setShellTitle(title);
  document.title = `${title} | ${(getState().settings && getState().settings.schoolName) || 'School'}`;
  setShellActive(pathname);

  // Announce + focus for accessibility.
  const announcer = document.getElementById('route-announcer');
  if (announcer) announcer.textContent = title;

  // ---- Lazy-load and mount the view ----
  try {
    const mod = await import(`/js/${route.view}`);
    if (typeof mod.mount !== 'function') throw new Error(`View ${route.view} does not export mount()`);
    const ctx = {
      params,
      query,
      signal: currentAbort.signal,
      route: route.path,
      navigate,
      setQuery,
      setTitle: setShellTitle,
      setCrumbs: (crumbs) => window.__setCrumbs && window.__setCrumbs(crumbs),
      defaultCrumbs: route.crumb || []
    };
    const result = await mod.mount(ctx);
    currentUnmount = typeof result === 'function' ? result : null;
    // Scroll to top and focus the page heading.
    window.scrollTo({ top: 0, behavior: 'auto' });
    const h1 = container.querySelector('h1, [data-page-heading]');
    if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
  } catch (err) {
    console.error('[router] failed to mount view', err);
    container.innerHTML = `
      <div class="p-8 text-center">
        <div class="text-danger text-lg font-semibold mb-2">${t('common.errorTitle')}</div>
        <p class="text-slate-600 dark:text-slate-300 mb-4">${escapeMsg(err.message)}</p>
        <button id="retry-btn" class="btn-primary">${t('common.retry')}</button>
      </div>`;
    const btn = container.querySelector('#retry-btn');
    if (btn) btn.addEventListener('click', () => { lastHash = ''; handleRoute(); });
  }
}

function escapeMsg(s) {
  return String(s || '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

// ---- Session-expired hook (registered into auth.js) ----
registerUnauthorized(() => {
  toast(t('auth.sessionExpired'), 'warning');
  navigate('/login', { replace: true });
});

// ---- Re-render on language change ----
subscribe('language', () => {
  const hash = location.hash.replace(/^#/, '') || '/dashboard';
  lastHash = '';
  handleRoute();
});

// ---- Start ----
export function startRouter() {
  window.addEventListener('hashchange', handleRoute);
  window.addEventListener('beforeunload', (e) => {
    if (dirtyGuard && dirtyGuard()) { e.preventDefault(); e.returnValue = ''; }
  });
  if (!location.hash) location.hash = isAuthenticated() ? '#/dashboard' : '#/login';
  handleRoute();
}

export { routes };
