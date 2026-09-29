// Drives a real headless Chrome over the DevTools protocol to smoke-test a SPA
// view against a stubbed API. Used because the interactive browser tools are not
// always available in the session.
//
//   node scripts/browser-check.js <baseUrl> <hashRoute>
//
// Exits non-zero if the page logs an error or an assertion fails.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE_URL = process.argv[2] || 'http://localhost:4174';
const ROUTE = process.argv[3] || '#/assistant';
const PORT = 9333;
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

// Minimal CDP client over the global WebSocket.
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
      // Collect anything that looks like a page-level failure.
      if (msg.method === 'Runtime.exceptionThrown') {
        const d = msg.params.exceptionDetails;
        this.errors.push('exception: ' + (d.exception?.description || d.text));
      }
      if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') {
        this.errors.push('console: ' + msg.params.entry.text);
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

  // Evaluate in the page and return the JSON value.
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

// The stub runs before any app code, exactly like the app's own entry point.
const STUB = () => {
  window.__apiCalls = [];
  localStorage.setItem('lms.token', 'test-token');
  localStorage.setItem('lms.user', JSON.stringify({
    _id: 'u1', username: 'umutoni.jeannette', fullName: 'Umutoni Jeannette',
    role: 'librarian', mustChangePassword: false
  }));

  const items = [
    { memberId: 'm1', name: 'Alice Mukamana', admissionNo: 'STU001', classLevel: 'S3',
      phone: '0788123456', guardianName: 'Mr Mukamana', guardianPhone: '+250788999888',
      overdueCount: 2, maxDaysLate: 9, fineBalance: 900, books: [{ title: 'Harry Potter', dueDate: '2026-09-19T00:00:00.000Z' }] },
    { memberId: 'm2', name: 'Eric Habimana', admissionNo: 'STU002', classLevel: 'S5',
      phone: '0722334455', guardianName: '', guardianPhone: '',
      overdueCount: 1, maxDaysLate: 2, fineBalance: 0, books: [] }
  ];

  const routes = [
    ['/api/settings', { success: true, data: { settings: {
      schoolName: 'Green Hills Boarding School', currencySymbol: 'RF', finePerDay: 100,
      borrowingLimit: 3, loanDays: 14, teacherBorrowingLimit: 5, reservationHoldDays: 3,
      phone: '+250788000000', email: 'library@greenhills.rw', address: 'Kigali' } } }],
    ['/api/auth/me', { success: true, data: { user: { _id: 'u1', fullName: 'Umutoni Jeannette', username: 'umutoni.jeannette', role: 'librarian' } } }],
    ['/api/transactions/overdue', { success: true, data: { total: 4 } }],
    ['/api/dashboard', { success: true, data: {} }],
    ['/api/notifications/channels', { success: true, data: { whatsapp: { available: true }, email: { available: false } } }],
    ['/api/notifications/overdue', { success: true, data: { items, total: 2, totalBooks: 3, totalFines: 900 } }],
    ['/api/assistant/chat', { success: true, data: {
      intent: 'policy',
      answer: 'Overdue books are charged RF100 per book per day.',
      suggestions: ['My fines', 'Find a book'],
      payload: { books: [{ _id: 'b1', title: 'Harry Potter and the Goblet of Fire' }] } } }]
  ];

  const json = (body) => Promise.resolve(new Response(JSON.stringify(body), {
    status: 200, headers: { 'Content-Type': 'application/json' }
  }));

  const realFetch = window.fetch;
  window.fetch = function (input, init) {
    const url = typeof input === 'string' ? input : input.url;
    const method = (init && init.method) || (typeof input !== 'string' && input.method) || 'GET';
    window.__apiCalls.push({ url, method });
    for (const [frag, body] of routes) {
      if (url.includes(frag)) return json(body);
    }
    if (url.includes('/api/notifications/overdue/') && url.includes('/send')) {
      return json({ success: true, data: { results: [{ channel: 'whatsapp', status: 'queued',
        link: 'https://wa.me/250788999888?text=Dear%20Alice',
        message: 'Dear Alice (STU001),\n\nYou have 2 book(s) that are now overdue.' }] } });
    }
    if (url.includes('/api/assistant/chat')) {
      return json({ success: true, data: { intent: 'policy', answer: 'Overdue books are charged RF100 per book per day.',
        suggestions: ['My fines', 'Find a book'] } });
    }
    return realFetch.apply(this, arguments);
  };
  // The service worker would cache the app shell and fight the stub.
  if (navigator.serviceWorker) {
    navigator.serviceWorker.register = () => Promise.reject(new Error('sw disabled in check'));
  }
};

(async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lms-chrome-'));
  const chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    'about:blank'
  ], { stdio: 'ignore' });

  let failures = 0;
  const check = (name, cond, extra) => {
    if (cond) console.log(`PASS  ${name}`);
    else { failures++; console.log(`FAIL  ${name}${extra ? ' :: ' + JSON.stringify(extra) : ''}`); }
  };

  try {
    await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);
    const { webSocketDebuggerUrl } = await waitForHttp(`http://127.0.0.1:${PORT}/json/version`);

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
    const stubSource = `(${STUB.toString()})();`;
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: stubSource });

    await cdp.send('Page.navigate', { url: `${BASE_URL}/${ROUTE}` });
    await sleep(2500);

    // Force a clean re-mount now that the stub is in place.
    await cdp.send('Runtime.evaluate', { expression: `location.hash = '${ROUTE}'` });
    await sleep(2000);

    const state = await cdp.eval(`
      return {
        hash: location.hash,
        h1: document.querySelector('h1') ? document.querySelector('h1').textContent.trim() : null,
        nav: Array.from(document.querySelectorAll('[data-nav]')).map(a => a.textContent.trim()),
        logBubbles: document.querySelectorAll('#asst-log > div').length,
        suggestions: Array.from(document.querySelectorAll('#asst-suggest button')).map(b => b.textContent.trim()),
        tableRows: document.querySelectorAll('tbody tr').length,
        statCards: Array.from(document.querySelectorAll('.truncate')).map(e => e.textContent.trim()).filter(s => s.includes('remind') || s.includes('overdue') || s.includes('Outstanding')),
        calls: window.__apiCalls.map(c => c.method + ' ' + c.url.replace(/^https?:\\/\\/[^/]+/, ''))
      };
    `);

    console.log('  page state:', JSON.stringify(state, null, 2).split('\n').map((l) => '  ' + l).join('\n'));

    if (ROUTE.includes('assistant')) {
      check('routed to the assistant', state.hash.includes('assistant'), state.hash);
      check('heading is Library Assistant', state.h1 === 'Library Assistant', state.h1);
      check('greeting rendered into the log', state.logBubbles >= 1, state.logBubbles);
      check('suggestion chips rendered', state.suggestions.length > 0, state.suggestions);
      check('assistant endpoint was called', state.calls.some((c) => c.includes('/api/assistant/chat')), state.calls);
      check('sidebar has Library Assistant', state.nav.some((n) => n.includes('Library Assistant')), state.nav);

      // Type a question and submit through the real form.
      const after = await cdp.eval(`
        const input = document.querySelector('#asst-input');
        input.value = 'what is the fine per day?';
        document.querySelector('#asst-form button[type="submit"]').click();
        await new Promise(r => setTimeout(r, 1200));
        const bubbles = Array.from(document.querySelectorAll('#asst-log > div'));
        return {
          bubbles: bubbles.length,
          lastText: bubbles.length ? bubbles[bubbles.length - 1].textContent.trim() : null,
          bookChips: document.querySelectorAll('#asst-log a[href^="#/books/"]').length,
          userEcho: bubbles.some(b => b.textContent.includes('what is the fine per day')),
          inputCleared: document.querySelector('#asst-input').value === ''
        };
      `);
      console.log('  after submit:', JSON.stringify(after));
      check('user question echoed as a bubble', after.userEcho, after);
      check('answer appended to the log', after.bubbles >= 3, after.bubbles);
      check('answer text rendered', /RF100/.test(after.lastText || ''), after.lastText);
      check('book result chips rendered', after.bookChips >= 1, after.bookChips);
      check('input cleared after send', after.inputCleared, after);
    }

    if (ROUTE.includes('reminders')) {
      check('routed to reminders', state.hash.includes('reminders'), state.hash);
      check('heading is Reminders', state.h1 === 'Reminders', state.h1);
      check('table rendered rows', state.tableRows === 2, state.tableRows);
      check('notifications endpoint was called', state.calls.some((c) => c.includes('/api/notifications/overdue')), state.calls);
      check('channels endpoint was called', state.calls.some((c) => c.includes('/api/notifications/channels')), state.calls);
      check('sidebar has Reminders', state.nav.some((n) => n.includes('Reminders')), state.nav);
    }

    if (ROUTE.includes('install')) {
      // The banner only shows once the browser offers a prompt, which headless
      // Chrome will not do on its own. Fire a synthetic event carrying the same
      // shape so the real code path runs.
      const shown = await cdp.eval(`
        const evt = new Event('beforeinstallprompt', { cancelable: true });
        evt.prompt = () => { window.__promptCalled = true; };
        Object.defineProperty(evt, 'userChoice', { value: Promise.resolve({ outcome: 'accepted' }) });
        window.dispatchEvent(evt);
        await new Promise(r => setTimeout(r, 2500));
        const banner = document.getElementById('install-banner');
        return {
          stored: window.__installPrompt === evt,
          exists: !!banner,
          title: banner ? (banner.querySelector('h2') || {}).textContent : null,
          body: banner ? (banner.querySelector('p') || {}).textContent : null,
          hasAccept: !!(banner && banner.querySelector('#install-accept')),
          hasLater: !!(banner && banner.querySelector('#install-later')),
          iconLoaded: !!(banner && banner.querySelector('img[src="/images/icon.png"]')),
          position: banner ? banner.style.cssText : null
        };
      `);
      console.log('  banner:', JSON.stringify(shown));
      check('the beforeinstallprompt event was stashed', shown.stored, shown);
      check('the banner appeared', shown.exists, shown);
      check('banner shows the translated title', shown.title === 'Library Assistant'.replace('Library Assistant', 'Install the Library app'), shown.title);
      check('banner shows the body copy', typeof shown.body === 'string' && shown.body.length > 20, shown.body);
      check('Install button is present when promptable', shown.hasAccept, shown);
      check('dismiss button is present', shown.hasLater, shown);
      check('app icon is shown', shown.iconLoaded, shown);
      check('banner is positioned at the bottom centre', /bottom/.test(shown.position || ''), shown.position);

      // Clicking Install must call prompt() and record the install.
      const accepted = await cdp.eval(`
        document.getElementById('install-banner').querySelector('#install-accept').click();
        await new Promise(r => setTimeout(r, 600));
        return {
          promptCalled: window.__promptCalled === true,
          gone: !document.getElementById('install-banner'),
          done: localStorage.getItem('lms.install.done')
        };
      `);
      console.log('  accept:', JSON.stringify(accepted));
      check('clicking Install called prompt()', accepted.promptCalled, accepted);
      check('banner closed after accepting', accepted.gone, accepted);
      check('install recorded so it never nags again', accepted.done === '1', accepted);

      // A dismissed banner must be suppressed on the next visit.
      const redisplay = await cdp.eval(`
        localStorage.removeItem('lms.install.done');
        localStorage.setItem('lms.install.dismissedAt', String(Date.now()));
        window.dispatchEvent(new CustomEvent('lms:installable'));
        await new Promise(r => setTimeout(r, 2000));
        return { shown: !!document.getElementById('install-banner') };
      `);
      check('a recently dismissed banner is not shown again', redisplay.shown === false, redisplay);

      // ...but it comes back after the 14-day window.
      const after14 = await cdp.eval(`
        localStorage.setItem('lms.install.dismissedAt', String(Date.now() - 15 * 86400000));
        window.dispatchEvent(new CustomEvent('lms:installable'));
        await new Promise(r => setTimeout(r, 2000));
        const b = document.getElementById('install-banner');
        const onlyDismiss = b && !b.querySelector('#install-accept');
        if (b) b.remove();
        return { shownAgain: !!b, onlyDismissButton: !!onlyDismiss };
      `);
      console.log('  after 14 days:', JSON.stringify(after14));
      check('banner returns after 14 days', after14.shownAgain === true, after14);
      check('non-promptable browser shows only a dismiss button', after14.onlyDismissButton === true, after14);
    }

    const realErrors = cdp.errors.filter((e) => !/sw disabled in check|Failed to load resource.*(unpkg|jsdelivr|fonts)/i.test(e));
    check('no page errors', realErrors.length === 0, realErrors);
  } finally {
    chrome.kill();
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  console.log(failures ? `\n${failures} FAILURES` : '\nBrowser checks passed');
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error('CHECK CRASHED:', e.message);
  process.exit(1);
});
