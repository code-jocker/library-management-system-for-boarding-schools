// Proves the offline-sync fix: when the SPA is served from a different host than
// the API (window.LMS_API_BASE points at Render), the IndexedDB prefetch and the
// queued-draft replay must use that host, not the frontend's own '/api'.
//
//   node scripts/offline-base-check.js <baseUrl>
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_URL = process.argv[2] || 'http://localhost:4174';
const REMOTE = 'https://library-management-system-for-boarding.onrender.com/api';
const PORT = 9334;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForHttp(url, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) return r.json(); } catch { /* not up */ }
    await sleep(250);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

const STUB = (remote) => {
  // Pin the API base before index.html's inline script tries to assign it.
  // The inline script is non-strict, so a getter-only property makes the
  // assignment a silent no-op.
  let base = remote;
  Object.defineProperty(window, 'LMS_API_BASE', {
    get: () => base,
    set: () => { base = remote; },
    configurable: true
  });

  window.__calls = [];
  window.__queueable = [];
  localStorage.setItem('lms.token', 'test-token');
  localStorage.setItem('lms.user', JSON.stringify({ _id: 'u1', fullName: 'Lib', role: 'librarian', mustChangePassword: false }));

  const emptyList = { success: true, data: { items: [], total: 0, page: 1, pages: 1, limit: 100 } };
  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init && init.method) || 'GET';
    window.__calls.push({ url, method });
    if (url.includes('/api/settings')) {
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { settings: { schoolName: 'Test', currencySymbol: 'RF' } } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.includes('/api/auth/me')) {
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { user: { _id: 'u1', fullName: 'Lib', role: 'librarian' } } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.includes('/api/transactions/overdue')) {
      return Promise.resolve(new Response(JSON.stringify({ success: true, data: { total: 0 } }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    if (url.includes('/api/books') || url.includes('/api/members') || url.includes('/api/categories')) {
      return Promise.resolve(new Response(JSON.stringify(emptyList), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch.apply(this, arguments);
  };
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register = () => Promise.reject(new Error('sw disabled in check'));
  }
};

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-offline-'));
  const chrome = spawn(CHROME, [
    '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu', 'about:blank'
  ], { stdio: 'ignore' });

  let failures = 0;
  const check = (name, cond, extra) => {
    if (cond) console.log(`PASS  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''}`); }
  };

  try {
    const { webSocketDebuggerUrl } = await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
    const ws = new WebSocket(webSocketDebuggerUrl);
    await new Promise((res, rej) => { ws.addEventListener('open', res, { once: true }); ws.addEventListener('error', rej, { once: true }); });

    let id = 0;
    const pending = new Map();
    let sessionId = null;
    const errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const { resolve, reject } = pending.get(m.id);
        pending.delete(m.id);
        return m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
      if (m.method === 'Runtime.exceptionThrown') {
        errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
      }
    });
    const send = (method, params = {}, useSession = true) => {
      const n = ++id;
      const payload = { id: n, method, params };
      if (useSession && sessionId) payload.sessionId = sessionId;
      ws.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => {
        pending.set(n, { resolve, reject });
        setTimeout(() => { if (pending.has(n)) { pending.delete(n); reject(new Error('timeout ' + method)); } }, 30000);
      });
    };
    const evaluate = async (expression) => {
      const r = await send('Runtime.evaluate', { expression: `(async () => { ${expression} })()`, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed');
      return r.result.value;
    };

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' }, false);
    ({ sessionId } = await send('Target.attachToTarget', { targetId, flatten: true }, false));
    await send('Page.enable');
    await send('Runtime.enable');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: `(${STUB.toString()})(${JSON.stringify(REMOTE)});` });
    await send('Page.navigate', { url: `${BASE_URL}/#/dashboard` });
    // initOfflineSync kicks off a prefetch ~1.5s after boot.
    await sleep(6000);

    const result = await evaluate(`
      const origin = new URL(window.LMS_API_BASE).origin;
      // A relative '/api/...' URL is the bug this check exists to catch, so it
      // must be resolved against the page rather than crashing on new URL().
      const absolute = (u) => new URL(u, location.href).href;
      const apiCalls = window.__calls.filter(c => c.url.includes('/api/'));
      return {
        apiBase: window.LMS_API_BASE,
        apiBaseOrigin: origin,
        pageOrigin: location.origin,
        calls: apiCalls.map(c => c.url),
        wrongOrigin: apiCalls.filter(c => new URL(absolute(c.url)).origin !== origin).map(c => c.url),
        relativeCalls: apiCalls.filter(c => !/^https?:\\/\\//.test(c.url)).map(c => c.url),
        remotePrefetches: apiCalls.filter(c => /^https?:\\/\\//.test(c.url) && c.url.startsWith(origin) && /\\/(books|members|categories)\\b/.test(c.url)).map(c => c.url)
      };
    `);
    console.log('  ', JSON.stringify(result, null, 2).split('\n').map((l) => '  ' + l).join('\n'));

    check('LMS_API_BASE is the remote API host', result.apiBaseOrigin === new URL(REMOTE).origin, result.apiBase);
    check('the page is served from a different origin', result.pageOrigin !== result.apiBaseOrigin, result.pageOrigin);
    check('offline prefetch hit the API host', result.remotePrefetches.length > 0, result.remotePrefetches);
    check('no relative /api requests were made', result.relativeCalls.length === 0, result.relativeCalls);
    check('no request was sent to the frontend host /api', result.wrongOrigin.length === 0, result.wrongOrigin);
    check('no uncaught page exceptions', errors.length === 0, errors);
  } finally {
    chrome.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(failures ? `\n${failures} FAILURES` : '\nOffline base checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error('CHECK CRASHED:', e.message); process.exit(1); });
