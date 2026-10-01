// Measures real layout behaviour across device widths using headless Chrome over
// the DevTools protocol, against the same stubbed API as browser-check.js.
//
//   node scripts/responsive-check.js <baseUrl>
//
// For each device profile this asserts the things that actually break on a real
// phone: horizontal overflow, elements wider than the viewport, tap targets
// under 44px, and the mobile drawer. Reports the offending elements by selector
// so a failure names its cause instead of just going red.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_URL = process.argv[2] || 'http://localhost:4175';
// Port 0 lets Chrome pick a free port, so a leftover instance from a previous
// run cannot make this one fail to start.
const PORT = Number(process.env.RESP_CHECK_PORT) || 0;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Real device widths worth guarding, smallest first. 360 is the narrowest phone
// still in circulation; the rest are the sizes a user is likely to hit.
const DEVICES = [
  { name: 'small phone  320', width: 320, height: 568, mobile: true },
  { name: 'phone        360', width: 360, height: 740, mobile: true },
  { name: 'phone        390', width: 390, height: 844, mobile: true },
  { name: 'phone land   740', width: 740, height: 360, mobile: true },
  { name: 'tablet      768', width: 768, height: 1024, mobile: true },
  { name: 'tablet     1024', width: 1024, height: 768, mobile: false },
  { name: 'laptop     1280', width: 1280, height: 800, mobile: false },
  { name: 'desktop    1920', width: 1920, height: 1080, mobile: false }
];

// Views that stress different layouts: grids, tables, forms and the drawer.
const ROUTES = ['#/dashboard', '#/books', '#/members', '#/reminders', '#/settings', '#/assistant'];

async function waitForHttp(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return await res.json();
    } catch { /* not up yet */ }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.sessionId = null;
    this.errors = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(msg.error.message));
        else resolve(msg.result);
        return;
      }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      this.errors.push('exception: ' + (d.exception?.description || d.text));
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      const txt = (msg.params.args || []).map((a) => a.value || a.description || '').join(' ');
      this.errors.push('console.error: ' + txt);
    }
    });
  }

  send(method, params = {}, useSession = true) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (useSession && this.sessionId) payload.sessionId = this.sessionId;
    this.ws.send(JSON.stringify(payload));
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }

  async eval(expression) {
    const r = await this.send('Runtime.evaluate', {
      expression: `(async () => { ${expression} })()`,
      awaitPromise: true,
      returnByValue: true
    });
    if (r.exceptionDetails) {
      throw new Error('page eval failed: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
    }
    return r.result.value;
  }
}

// Mirrors browser-check.js: pin the API to this origin, stub every read, and
// disable the service worker so the app shell is never served stale.
const STUB = () => {
  window.__apiCalls = [];
  Object.defineProperty(window, 'LMS_API_BASE', {
    get: () => location.origin + '/api',
    set: () => {},
    configurable: true
  });

  // This script also runs on the initial about:blank document, which has an
  // opaque origin and throws on localStorage. Bail out there so a stray
  // SecurityError cannot be mistaken for a real app failure.
  let ls = null;
  try { ls = window.localStorage; ls.setItem('__probe', '1'); ls.removeItem('__probe'); }
  catch { return; }

  ls.setItem('lms.token', 'test-token');
  ls.setItem('lms.user', JSON.stringify({
    _id: 'u1', username: 'umutoni.jeannette', fullName: 'Umutoni Jeannette',
    role: 'librarian', mustChangePassword: false
  }));

  const items = [
    { memberId: 'm1', name: 'Alice Mukamana', admissionNo: 'STU001', classLevel: 'S3',
      phone: '0788123456', guardianName: 'Mr Mukamana', guardianPhone: '+250788999888',
      overdueCount: 2, maxDaysLate: 9, fineBalance: 900, books: [{ title: 'Harry Potter', dueDate: '2026-09-19T00:00:00.000Z' }] }
  ];

  const routes = [
    ['/api/settings', { success: true, data: { settings: {
      schoolName: 'KAGEYO TSS Boarding School', currencySymbol: 'RF', finePerDay: 100,
      borrowingLimit: 3, loanDays: 14, teacherBorrowingLimit: 5, reservationHoldDays: 3,
      phone: '+250788000000', email: 'library@kageyo.rw', address: 'Kigali' } } }],
    ['/api/auth/me', { success: true, data: { user: { _id: 'u1', fullName: 'Umutoni Jeannette', username: 'umutoni.jeannette', role: 'librarian' } } }],
    ['/api/dashboard', { success: true, data: {} }],
    ['/api/notifications/overdue', { success: true, data: { items, total: 1, totalBooks: 1, totalFines: 900 } }],
    ['/api/assistant/chat', { success: true, data: { intent: 'policy', answer: 'Overdue books are charged RF100 per book per day.', suggestions: [] } }]
  ];
  const mirrorRoutes = ['/api/books', '/api/members', '/api/categories', '/api/transactions'];

  const json = (body) => Promise.resolve(new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  }));

  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    window.__apiCalls.push({ url, method: (init && init.method) || 'GET' });
    for (const [frag, body] of routes) if (url.includes(frag)) return json(body);
    for (const frag of mirrorRoutes) if (url.includes(frag)) return json({ success: true, data: [] });
    return realFetch.apply(this, arguments);
  };
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register = () => Promise.reject(new Error('sw disabled in check'));
  }
};

// Runs in the page: find anything that pushes the layout wider than the viewport.
const OVERFLOW_PROBE = `
  if (!document.documentElement || !document.body) return { vw: 0, docScrollW: 0, overflows: false, offenders: [], smallTargets: [], smallTargetCount: 0, hasHamburger: false, hasSidebar: false, notReady: true };
  const vw = document.documentElement.clientWidth;
  const describe = (el) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    if (el.className && typeof el.className === 'string') {
      s += '.' + el.className.trim().split(/\\s+/).slice(0, 3).join('.');
    }
    return s;
  };

  // Widest offenders. The off-canvas drawer is meant to sit outside the
  // viewport, so everything inside it is skipped, as is any element that
  // scrolls or clips its own overflow.
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('#sidebar')) continue;
    const sb = el.getBoundingClientRect();
    if (sb.width === 0 || sb.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    let p = el.parentElement, scrolls = false;
    while (p && p !== document.body) {
      const pcs = getComputedStyle(p);
      if (pcs.overflowX === 'auto' || pcs.overflowX === 'scroll' || pcs.overflowX === 'hidden') { scrolls = true; break; }
      p = p.parentElement;
    }
    if (scrolls) continue;
    if (sb.right > vw + 1) {
      offenders.push({ el: describe(el), left: Math.round(sb.left), right: Math.round(sb.right), w: Math.round(sb.width) });
    }
  }

  // Tap targets: interactive controls a finger has to hit. A checkbox or radio
  // is visually 16px but css/app.css extends its hit area with a 44px
  // pseudo-element, so measure that box rather than the element itself.
  const small = [];
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea')) {
    const sb = el.getBoundingClientRect();
    if (sb.width === 0 || sb.height === 0) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    if (el.closest('#print-root')) continue;
    let w = sb.width, h = sb.height;
    if (el.matches('input[type="checkbox"], input[type="radio"]')) {
      const after = getComputedStyle(el, '::after');
      if (after && after.content !== 'none') {
        w = Math.max(w, parseFloat(after.width) || 0);
        h = Math.max(h, parseFloat(after.height) || 0);
      }
    }
    if (h < 44 || w < 44) {
      small.push({ el: describe(el), w: Math.round(w), h: Math.round(h) });
    }
  }

  return {
    vw,
    docScrollW: document.documentElement.scrollWidth,
    bodyScrollW: document.body.scrollWidth,
    overflows: document.documentElement.scrollWidth > vw + 1,
    offenders: offenders.slice(0, 8),
    smallTargets: small.slice(0, 8),
    smallTargetCount: small.length,
    hasHamburger: !!document.querySelector('#menu-toggle'),
    hasSidebar: !!document.querySelector('#sidebar')
  };
`;

let failures = 0;
const check = (name, cond, extra) => {
  if (cond) console.log(`PASS  ${name}`);
  else { failures++; console.log(`FAIL  ${name}${extra ? ' :: ' + JSON.stringify(extra) : ''}`); }
};

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-resp-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-browser-check', '--disable-gpu',
    'about:blank'
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  // Chrome prints "DevTools listening on ws://127.0.0.1:<port>/..." on stderr.
  // With --remote-debugging-port=0 the port is only known from there.
  const realPort = await new Promise((resolve, reject) => {
    let buf = '';
    const timer = setTimeout(() => reject(new Error('Chrome never reported a DevTools port')), 30000);
    chrome.stderr.on('data', (d) => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//);
      if (m) { clearTimeout(timer); resolve(Number(m[1])); }
    });
    chrome.on('exit', (code) => { clearTimeout(timer); reject(new Error('Chrome exited early: ' + code)); });
  });

  try {
    const { webSocketDebuggerUrl } = await waitForHttp(`http://127.0.0.1:${realPort}/json/version`);
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((resolve, reject) => {
      ws.addEventListener('open', resolve, { once: true });
      ws.addEventListener('error', reject, { once: true });
    });
    const cdp = new CDP(ws);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' }, false);
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true }, false);
    cdp.sessionId = sessionId;

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Log.enable');
    await cdp.send('Network.enable');
    await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
    await cdp.send('Network.setBypassServiceWorker', { bypass: true });
    // No outbound internet here, so the blocking CDN <script> tags never resolve
    // and the HTML parser stalls part way through <head>. Fail them fast.
    await cdp.send('Network.setBlockedURLs', {
      urls: ['*unpkg.com*', '*cdn.jsdelivr.net*', '*fonts.googleapis.com*', '*fonts.gstatic.com*']
    });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 360, height: 740, deviceScaleFactor: 1, mobile: true
    });
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: `(${STUB.toString()})();` });
    await cdp.send('Page.navigate', { url: `${BASE_URL}/#/dashboard` });
    await sleep(3000);

    // Wait for the real document and the app shell, so a slow first paint does
    // not make every later probe evaluate against about:blank.
    for (let i = 0; i < 40; i++) {
      const ready = await cdp.eval(`
        return Boolean(document.documentElement && document.getElementById('sidebar'));
      `).catch(() => false);
      if (ready) break;
      await sleep(250);
    }

    // Surface a boot failure immediately and with the real reason, rather than
    // letting every device assert fail with a confusing "no hamburger".
    const bootErrs = cdp.errors.filter((e) => !/localStorage.*Access is denied/.test(e));
    if (bootErrs.length) {
      console.log('BOOT ERRORS:', JSON.stringify(bootErrs, null, 1));
    }

    for (const device of DEVICES) {
      console.log(`\n--- ${device.name} (${device.mobile ? 'mobile' : 'desktop'}) ---`);
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: device.width, height: device.height, deviceScaleFactor: 1, mobile: device.mobile
      });
      await sleep(400);

      for (const route of ROUTES) {
        await cdp.eval(`location.hash = '${route}'; return 1;`).catch(() => null);
        // Views fetch before they render, so let the stub resolve and paint.
        await sleep(700);
        const r = await cdp.eval(OVERFLOW_PROBE).catch(() => null);
        const label = `${device.name} ${route}`;
        if (!r || r.notReady) {
          check(`${label} no horizontal overflow`, false, { error: 'page was not ready to measure' });
          continue;
        }
        check(`${label} no horizontal overflow`, !r.overflows, {
          docScrollW: r.docScrollW, vw: r.vw, offenders: r.offenders
        });
        // Below the lg breakpoint the sidebar is a drawer behind a hamburger.
        if (device.width < 1024) {
          check(`${label} has a hamburger menu`, r.hasHamburger, r);
        } else {
          check(`${label} shows the sidebar without a hamburger`, r.hasSidebar, r);
        }
      }
    }

    // Tap targets only matter where a finger is used, and the codebase already
    // enforces 44px in ~20 components, so check the narrowest phone only.
    console.log('\n--- tap targets at 360 ---');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 360, height: 740, deviceScaleFactor: 1, mobile: true
    });
    for (const route of ROUTES) {
      await cdp.eval(`location.hash = '${route}'; return 1;`).catch(() => null);
      await sleep(700);
      const r = await cdp.eval(OVERFLOW_PROBE).catch(() => null);
      if (!r || r.notReady) { check(`360 ${route} tap targets are 44px or larger`, false, { error: 'page not ready' }); continue; }
      check(`360 ${route} tap targets are 44px or larger`, r.smallTargetCount === 0, r.smallTargets);
    }

    // The drawer must open on a phone and stay out of the way on desktop.
    console.log('\n--- mobile drawer ---');
    const drawer = await cdp.eval(`
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      location.hash = '#/dashboard';
      await sleep(600);
      const btn = document.getElementById('menu-toggle');
      if (!btn) return { ok: false, reason: 'no hamburger' };
      btn.click();
      await sleep(500);
      const sb = document.getElementById('sidebar');
      const r = sb.getBoundingClientRect();
      const open = {
        onScreen: Math.round(r.left) >= -1,
        width: Math.round(r.width),
        fullyVisible: Math.round(r.left) === 0
      };
      // Sample the state while the drawer is actually open, not after closing.
      const expandedOpen = btn.getAttribute('aria-expanded');
      const focusInDrawer = sb.contains(document.activeElement);
      const scrollLocked = document.body.classList.contains('drawer-open');
      document.getElementById('mobile-overlay').click();
      await sleep(500);
      const closed = Math.round(sb.getBoundingClientRect().right) <= 1;
      return {
        ok: true, open, closed,
        expanded: expandedOpen,
        focusInDrawer, scrollLocked,
        expandedAfterClose: btn.getAttribute('aria-expanded')
      };
    `);
    check('drawer opens fully on screen at 360', drawer.ok && drawer.open.fullyVisible, drawer);
    check('drawer is a usable width, not an icon sliver', drawer.ok && drawer.open.width >= 200, drawer);
    check('overlay tap closes the drawer', drawer.ok && drawer.closed === true, drawer);
    check('hamburger reports aria-expanded while open', drawer.ok && drawer.expanded === 'true', drawer);
    check('hamburger reports aria-expanded after close', drawer.ok && drawer.expandedAfterClose === 'false', drawer);
    check('focus moves into the open drawer', drawer.ok && drawer.focusInDrawer === true, drawer);
    check('page scroll is locked while the drawer is open', drawer.ok && drawer.scrollLocked === true, drawer);

    // Escape must close it, matching the dropdown and modal behaviour.
    const esc = await cdp.eval(`
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const btn = document.getElementById('menu-toggle');
      btn.click();
      await sleep(400);
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await sleep(400);
      const sb = document.getElementById('sidebar');
      return { closed: Math.round(sb.getBoundingClientRect().right) <= 1 };
    `);
    check('Escape closes the drawer', esc.closed === true, esc);

    // A collapsed desktop sidebar must not shrink the phone drawer.
    console.log('\n--- collapsed sidebar does not leak into the phone drawer ---');
    // Reload before setting the flag so the new document is not torn down
    // mid-eval, and wait on the load event rather than a fixed sleep.
    await cdp.eval(`localStorage.setItem('lms.sidebarCollapsed', '1'); return 1;`);
    const loaded = new Promise((resolve) => {
      const onMsg = (ev) => {
        let m;
        try { m = JSON.parse(ev.data); } catch { return; }
        if (m.method === 'Page.loadEventFired' && m.sessionId === cdp.sessionId) {
          ws.removeEventListener('message', onMsg);
          resolve();
        }
      };
      ws.addEventListener('message', onMsg);
    });
    // Drain in-flight evaluates before reloading: an evaluate whose execution
    // context is destroyed by the navigation never gets a response, and its
    // entry would sit in the pending map holding up the next command.
    cdp.pending.clear();
    await cdp.send('Page.reload', { ignoreCache: true });
    await Promise.race([loaded, sleep(15000)]);
    // The shell renders after the settings/auth requests resolve.
    for (let i = 0; i < 40; i++) {
      const up = await cdp.eval(`return Boolean(document.getElementById('menu-toggle'));`).catch(() => false);
      if (up) break;
      await sleep(250);
    }
    const r = await cdp.eval(`
      const sleep = ms => new Promise(r => setTimeout(r, ms));
      const btn = document.getElementById('menu-toggle');
      if (!btn) return { ok: false };
      btn.click();
      await sleep(500);
      const sb = document.getElementById('sidebar');
      const w = Math.round(sb.getBoundingClientRect().width);
      const labelsHidden = Array.from(sb.querySelectorAll('.nav-label'))
        .some(el => getComputedStyle(el).display === 'none');
      return { ok: true, width: w, labelsHidden };
    `);
    check('drawer stays full width when the desktop sidebar is collapsed', r.ok && r.width >= 200, r);
    check('drawer keeps its labels despite the desktop collapse', r.ok && r.labelsHidden === false, r);
    await cdp.eval(`localStorage.removeItem('lms.sidebarCollapsed'); return 1;`).catch(() => null);

    // Landscape phone: content must reflow rather than overflow.
    console.log('\n--- rotation ---');
    await cdp.eval(`location.hash = '#/dashboard'; return 1;`);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 740, height: 360, deviceScaleFactor: 1, mobile: true
    });
    await sleep(600);
    const rot = await cdp.eval(OVERFLOW_PROBE).catch(() => null);
    check('landscape phone reflows without overflow', rot && !rot.notReady && !rot.overflows, rot || { error: 'page not ready' });

    // The about:blank bootstrap document has no localStorage, so the stub bails
    // out there by design. That is not an app failure.
    const realErrors = cdp.errors.filter((e) =>
      !/ERR_BLOCKED_BY_CLIENT/.test(e) && !/localStorage.*Access is denied/.test(e));
    check('no page errors', realErrors.length === 0, realErrors);

    console.log(failures ? `\n${failures} FAILURES` : '\nResponsive checks passed');
    process.exit(failures ? 1 : 0);
  } catch (e) {
    console.error('responsive-check failed to run:', e.message);
    process.exit(2);
  } finally {
    chrome.kill();
  }
})();
