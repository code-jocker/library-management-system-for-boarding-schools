// public/sw.js
// Service worker: makes the SPA installable and usable offline.
//  - Precaches the full app shell (HTML, CSS, every JS module, icons).
//  - Stale-while-revalidate for same-origin static assets + CDN scripts/fonts.
//  - Network-first for navigations, falling back to cached index.html.
//  - Network-first for /api GETs, falling back to the last cached response.
// Writes (POST/PUT/DELETE) are handled by the app's IndexedDB outbox, not here.

const VERSION = 'v1.0.1';
const SHELL_CACHE = `lms-shell-${VERSION}`;
const RUNTIME_CACHE = `lms-runtime-${VERSION}`;

// Everything needed to boot and render the app with no network.
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/images/favicon.svg',
  '/images/icon.png',
  '/css/tailwind.css',
  '/css/app.css',
  '/js/app.js',
  '/js/core/api.js',
  '/js/core/auth.js',
  '/js/core/i18n.js',
  '/js/core/printer.js',
  '/js/core/router.js',
  '/js/core/store.js',
  '/js/core/utils.js',
  '/js/core/db.js',
  '/js/core/offline.js',
  '/js/locales/en.js',
  '/js/locales/rw.js',
  '/js/components/avatar.js',
  '/js/components/badge.js',
  '/js/components/breadcrumbs.js',
  '/js/components/charts.js',
  '/js/components/confirm.js',
  '/js/components/dataTable.js',
  '/js/components/dropdown.js',
  '/js/components/emptyState.js',
  '/js/components/filterBar.js',
  '/js/components/formField.js',
  '/js/components/globalSearch.js',
  '/js/components/importModal.js',
  '/js/components/modal.js',
  '/js/components/pageHeader.js',
  '/js/components/pagination.js',
  '/js/components/shell.js',
  '/js/components/sidebar.js',
  '/js/components/skeleton.js',
  '/js/components/statCard.js',
  '/js/components/tabs.js',
  '/js/components/toast.js',
  '/js/components/topbar.js',
  '/js/print/certificate.js',
  '/js/print/libraryCard.js',
  '/js/print/overdueNotice.js',
  '/js/print/receipt.js',
  '/js/print/report.js',
  '/js/print/slip.js',
  '/js/views/bookDetails.js',
  '/js/views/books.js',
  '/js/views/categories.js',
  '/js/views/changePassword.js',
  '/js/views/clearance.js',
  '/js/views/dashboard.js',
  '/js/views/fines.js',
  '/js/views/issueBook.js',
  '/js/views/login.js',
  '/js/views/memberProfile.js',
  '/js/views/members.js',
  '/js/views/notFound.js',
  '/js/views/overdue.js',
  '/js/views/profile.js',
  '/js/views/reports.js',
  '/js/views/reservations.js',
  '/js/views/returnBook.js',
  '/js/views/settings.js',
  '/js/views/transactions.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // Cache each URL independently so one 404 does not abort the install.
      .then((cache) => Promise.allSettled(PRECACHE_URLS.map((url) => cache.add(url))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((k) => k.startsWith('lms-') && k !== SHELL_CACHE && k !== RUNTIME_CACHE)
          .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Notify the controlling page when a new version is live.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

function isApiGet(request) {
  const url = new URL(request.url);
  return url.origin === self.location.origin && url.pathname.startsWith('/api/') && request.method === 'GET';
}

function isNavigation(request) {
  return request.mode === 'navigate' || (request.method === 'GET' && request.headers.get('accept')?.includes('text/html'));
}

// Serve from cache first, refresh the cache in the background.
function staleWhileRevalidate(request, cacheName) {
  return caches.open(cacheName).then(async (cache) => {
    const cached = await cache.match(request);
    const network = fetch(request)
      .then((response) => {
        // Only cache successful, basic (same-origin or CORS) responses.
        if (response && response.status === 200 && (response.type === 'basic' || response.type === 'cors')) {
          cache.put(request, response.clone());
        }
        return response;
      })
      .catch(() => cached);
    return cached || network;
  });
}

// Try the network first, fall back to cache when offline.
function networkFirst(request, cacheName) {
  return caches.open(cacheName).then(async (cache) => {
    try {
      const response = await fetch(request);
      if (response && response.status === 200 && response.type === 'basic') {
        cache.put(request, response.clone());
      }
      return response;
    } catch (err) {
      const cached = await cache.match(request);
      return cached || Response.error();
    }
  });
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // Writes are queued by the app, not cached.

  const url = new URL(request.url);

  // Cross-origin (CDN scripts, Google Fonts): stale-while-revalidate.
  if (url.origin !== self.location.origin) {
    event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
    return;
  }

  // API reads: network-first with a cached fallback for offline browse.
  if (isApiGet(request)) {
    event.respondWith(networkFirst(request, RUNTIME_CACHE));
    return;
  }

  // Navigations: network-first, fall back to the cached app shell.
  if (isNavigation(request)) {
    event.respondWith(
      networkFirst(request, RUNTIME_CACHE).then((res) =>
        (res && res.type !== 'error') ? res : caches.match('/index.html')
      ).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // Same-origin static assets: stale-while-revalidate.
  event.respondWith(staleWhileRevalidate(request, RUNTIME_CACHE));
});
