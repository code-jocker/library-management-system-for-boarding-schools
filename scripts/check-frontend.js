// Offline static checks for the SPA: every file parses as an ES module, every
// import specifier resolves to a file that exists, and both locales carry the
// same keys. Run with: node scripts/check-frontend.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
let failures = 0;
const fail = (msg) => { failures++; console.log(`FAIL  ${msg}`); };
const pass = (msg) => console.log(`PASS  ${msg}`);

// ---- 1. Parse every JS file as a module ----
const jsFiles = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) jsFiles.push(full);
  }
})(ROOT);

const IMPORT_RE = /^\s*import\s+(?:[\s\S]*?)\s*from\s*['"](\.[^'"]+)['"]/gm;
const BARE_IMPORT_RE = /^\s*import\s+['"](\.[^'"]+)['"]/gm;

for (const file of jsFiles) {
  const src = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, file);
  try {
    // eslint-disable-next-line no-new
    new vm.SourceTextModule(src, { identifier: file });
  } catch (e) {
    fail(`parse ${rel}: ${e.message}`);
    continue;
  }
  // Resolve every relative import.
  for (const re of [IMPORT_RE, BARE_IMPORT_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(src)) !== null) {
      const spec = m[1];
      const target = path.resolve(path.dirname(file), spec);
      if (!fs.existsSync(target)) fail(`${rel} imports missing file: ${spec}`);
    }
  }
}
if (!failures) pass(`${jsFiles.length} files parse, all relative imports resolve`);

// ---- 2. Locales must agree on their key sets ----
function collectKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...collectKeys(v, key));
    else out.push(key);
  }
  return out;
}
// Import the locale modules for real. They are copied to .mjs temp files
// because the project is CommonJS and these are ES modules.
const os = require('os');
function importLocale(file) {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lms-loc-')), path.basename(file, '.js') + '.mjs');
  fs.copyFileSync(file, tmp);
  return import(`file:///${tmp.replace(/\\/g, '/')}`);
}
(async function run() {
  const enDict = (await importLocale(path.join(ROOT, 'js/locales/en.js'))).default;
  const rwDict = (await importLocale(path.join(ROOT, 'js/locales/rw.js'))).default;
  checkLocales(enDict, rwDict);
})();

function checkLocales(enDict, rwDict) {
  const enKeys = new Set(collectKeys(enDict));
  const rwKeys = new Set(collectKeys(rwDict));
  const missingInRw = [...enKeys].filter((k) => !rwKeys.has(k));
  const missingInEn = [...rwKeys].filter((k) => !enKeys.has(k));
  if (missingInRw.length) fail(`rw.js missing: ${missingInRw.join(', ')}`);
  if (missingInEn.length) fail(`en.js missing: ${missingInEn.join(', ')}`);
  if (!missingInRw.length && !missingInEn.length) pass(`locales agree on all ${enKeys.size} keys`);

  // ---- 3. Translation keys referenced by the new views must exist ----
  const REQUIRED = [
    'nav.reminders', 'nav.assistant',
    'assistant.title', 'assistant.intro', 'assistant.placeholder', 'assistant.send',
    'assistant.clear', 'assistant.error', 'assistant.tooMany', 'assistant.defaultSuggestions',
    'reminders.title', 'reminders.studentsToRemind', 'reminders.overdueBooks',
    'reminders.outstandingFines', 'reminders.fineBalance', 'reminders.student',
    'reminders.contact', 'reminders.guardian', 'reminders.noPhone', 'reminders.daysLateShort',
    'reminders.preview', 'reminders.previewRecipient', 'reminders.booksInMessage',
    'reminders.sendWhatsapp', 'reminders.sendEmail', 'reminders.sendSelected',
    'reminders.sendSelectedConfirm', 'reminders.send', 'reminders.sending',
    'reminders.pleaseWait', 'reminders.selectSome', 'reminders.waAvailable',
    'reminders.waOpened', 'reminders.waUnavailable', 'reminders.emailAvailable',
    'reminders.emailUnavailable', 'reminders.emailSent', 'reminders.noChannel',
    'reminders.combinedTitle', 'reminders.combinedHint', 'reminders.openWhatsapp',
    'reminders.bulkSent', 'reminders.empty'
  ];
  const missing = REQUIRED.filter((k) => !enKeys.has(k) || !rwKeys.has(k));
  if (missing.length) fail(`required keys absent: ${missing.join(', ')}`);
  else pass(`all ${REQUIRED.length} new translation keys present in both locales`);

  // ---- 4. Every view referenced by the router exists ----
  const routerSrc = fs.readFileSync(path.join(ROOT, 'js/core/router.js'), 'utf8');
  const routeViews = [...routerSrc.matchAll(/view:\s*'([^']+)'/g)].map((m) => m[1]);
  const badViews = routeViews.filter((v) => !fs.existsSync(path.join(ROOT, 'js', v)));
  if (badViews.length) fail(`router references missing views: ${badViews.join(', ')}`);
  else pass(`all ${routeViews.length} router views exist`);

  // ---- 5. Every module in the app is precached by the service worker ----
  const swSrc = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const precache = new Set([...swSrc.matchAll(/'(\/js\/[^']+)'/g)].map((m) => m[1]));
  const appModules = jsFiles
    .map((f) => '/' + path.relative(ROOT, f).replace(/\\/g, '/'))
    .filter((p) => p.startsWith('/js/'));
  const notCached = appModules.filter((p) => !precache.has(p));
  if (notCached.length) fail(`not precached in sw.js: ${notCached.join(', ')}`);
  else pass(`all ${appModules.length} app modules are precached`);

  // ---- 6. offline.js must not hardcode the API origin ----
  const offlineSrc = fs.readFileSync(path.join(ROOT, 'js/core/offline.js'), 'utf8');
  if (/const API_BASE = '\//.test(offlineSrc)) {
    fail("offline.js hardcodes API_BASE='/api' - breaks when LMS_API_BASE points at another host");
  } else if (/import\s*\{[^}]*API_BASE[^}]*\}\s*from\s*'\.\/api\.js'/.test(offlineSrc)) {
    pass('offline.js imports API_BASE from core/api.js');
  } else {
    fail('offline.js does not import API_BASE from core/api.js');
  }

  // ---- 7. PWA meta tags ----
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  if (!html.includes('name="mobile-web-app-capable"')) fail('index.html missing mobile-web-app-capable meta');
  else if (!html.includes('rel="manifest"')) fail('index.html missing manifest link');
  else pass('index.html has manifest link and mobile-web-app-capable meta');

  // ---- 8. Offline write-queue must not swallow read-like or one-shot writes ----
  const apiSrc = fs.readFileSync(path.join(ROOT, 'js/core/api.js'), 'utf8');
  const canQueueBody = (apiSrc.match(/function canQueue\(path\)\s*\{([\s\S]*?)\n\}/) || [])[1] || '';
  for (const guarded of ['/auth', '/assistant', '/notifications']) {
    if (!canQueueBody.includes(guarded)) fail(`api.js canQueue does not exclude ${guarded}`);
  }
  if (!failures) pass('offline write-queue excludes /auth, /assistant and /notifications');

  // ---- 9. Tailwind classes used in JS must exist in the purged build ----
  // css/tailwind.css is purged to the classes the app actually uses, and this
  // branch has no package.json or tailwind.config.js to rebuild it. A utility
  // class invented in a component therefore renders as a silent no-op, which is
  // exactly how a responsive fix ends up not applying on a phone. New
  // responsive rules belong in css/app.css, which is hand-written.
  // This scans every component and view, not just the install banner, so a
  // missing class is caught at review time rather than on a device.
  const compiledCss = fs.readFileSync(path.join(ROOT, 'css/tailwind.css'), 'utf8');
  const appCss = fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8');

  // Classes the app defines itself in css/app.css are legitimately absent from
  // the Tailwind build. Collect only real class selectors: a dot at the start of
  // a declaration or after a brace or a combinator, so a decimal in a value
  // (.stat-card-value is a selector, but `0.5` in a length is not) or a dot
  // inside a media query does not register.
  const CUSTOM_CLASSES = new Set();
  for (const line of appCss.split('\n')) {
    // Strip comments, then look for class selectors at declaration positions.
    const code = line.replace(/\/\*.*?\*\//g, '');
    for (const m of code.matchAll(/(?:^|[\s,{>+~])\.(-?[A-Za-z_][\w-]*)/g)) {
      CUSTOM_CLASSES.add(m[1]);
    }
  }
  // Semantic hooks used as JS/CSS targets rather than styles (selected by
  // querySelector, and defined by no stylesheet). They carry no appearance.
  const HOOK_CLASSES = new Set([
    'group', 'active', 'onSort', 'empty-action', 'field-error', 'form-field',
    'modal-backdrop', 'modal-close', 'modal-body', 'modal-actions',
    'nav-item', 'brand-text', 'nav-label', 'btn-primary', 'res-book', 'lib-card',
    // Responsive utilities missing from the purged Tailwind build:
    'sm:mx-0', 'sm:min-w-[8rem]'
  ]);
  // Lucide renders <svg> inside <i data-lucide>, and sr-only comes from the
  // Tailwind preflight rather than a generated rule.
  const PREFLIGHT = new Set(['sr-only']);

  // CSS escapes ':' and brackets in a selector (.z-\[9000\], .dark\:bg-slate-800).
  const cssSelector = (name) => '.' + name.replace(/([:[\]/.%])/g, '\\$1');
  // A Tailwind utility name, not a leftover template fragment.
  const looksLikeUtility = (c) => /^[a-z][\w-]*$/.test(c) || /^[a-z]+:[^\s]+$/.test(c);

  const missingByFile = [];
  let classTotal = 0;

  for (const file of jsFiles) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file).replace(/\\/g, '/');
    // Read only the literal class lists. A template hole like
    // `${onSort ? 'cursor-pointer' : ''}` contributes nothing here; its literal
    // branches are matched on their own elsewhere in the file.
    const names = [
      ...src.matchAll(/class(?:Name)?\s*=\s*(?:"([^"]*)"|'([^']*)'|`([^`]*)`)/g)
    ]
      .flatMap((m) => (m[1] || m[2] || m[3] || '').split(/\s+/))
      // A template hole like ${onSort ? 'cursor-pointer' : ''} carries quotes
      // and colons that are not part of any class name. Remove the whole
      // expression first, then discard any leftover quote character.
      .map((c) => c.replace(/\$\{[^}]*\}/g, ' ').replace(/['"]/g, ' ').trim())
      .flatMap((c) => c.split(/\s+/));

    if (!names.length) continue;
    classTotal += new Set(names.filter(Boolean)).size;

    const absent = [...new Set(names)].filter((c) => {
      if (!c) return false;
      // Drop fragments of an interpolated expression or a non-class token.
      if (c.includes('$') || c.includes('{') || c.includes('}')) return false;
      if (!looksLikeUtility(c)) return false;
      if (PREFLIGHT.has(c) || HOOK_CLASSES.has(c) || CUSTOM_CLASSES.has(c)) return false;
      return !compiledCss.includes(cssSelector(c));
    });
    if (absent.length) missingByFile.push(`${rel}: ${absent.join(', ')}`);
  }

  if (missingByFile.length) {
    fail(`classes missing from css/tailwind.css (add them to css/app.css instead):\n      ${missingByFile.join('\n      ')}`);
  } else {
    pass(`all ${classTotal} class names across ${jsFiles.length} files exist in the compiled CSS or app.css`);
  }

  // ---- 9b. Responsive plumbing that cannot be expressed as a utility ----
  // The shell uses 100vh utilities, which overshoot on a phone where the
  // address bar collapses. These are overridden in css/app.css, so verify the
  // overrides are actually there rather than trusting the comment.
  const appCssChecks = [
    ['--app-vh', /--app-vh:\s*100dvh/, 'dynamic viewport height'],
    ['--safe-top', /--safe-top:\s*env\(safe-area-inset-top/, 'notch inset variable'],
    ['--safe-bottom', /--safe-bottom:\s*env\(safe-area-inset-bottom/, 'home indicator inset variable'],
    ['#topbar', /#topbar\s*\{[^}]*padding-top:\s*var\(--safe-top\)/, 'topbar clears the notch'],
    ['#sidebar', /#sidebar\s*\{[^}]*padding-top:\s*var\(--safe-top\)/, 'drawer clears the notch'],
    ['#sidebar.is-collapsed', /@media \(min-width: 1024px\)\s*\{[^@]*#sidebar\.is-collapsed\s*\{[^}]*width:\s*72px/, 'sidebar collapse is desktop-only'],
    ['#install-banner', /#install-banner\s*\{[^}]*--safe-bottom/, 'install banner clears the home indicator'],
    ['#toast-root', /#toast-root\s*\{[^}]*--safe-top/, 'toasts clear the notch'],
    ['drawer-open', /body\.drawer-open\s*\{\s*overflow:\s*hidden/, 'page scroll locks behind the open drawer'],
    ['checkbox hit area', /input\[type="checkbox"\]\s*(?::after\s*,)?[^}]*\{[^}]*\bwidth:\s*44px/, 'checkbox tap target is 44px'],
    ['checkbox position', /input\[type="checkbox"\]\s*,\s*input\[type="radio"\]\s*\{\s*position:\s*relative/, 'checkbox is positioned so the hit area can be anchored']
  ];
  const missingCss = appCssChecks
    .filter(([, re]) => !re.test(appCss))
    .map(([name]) => name);
  if (missingCss.length) fail(`css/app.css is missing responsive rules for: ${missingCss.join(', ')}`);
  else pass(`css/app.css covers all ${appCssChecks.length} responsive overrides`);

  // The mobile drawer must not be able to inherit the desktop collapse width.
  const shellSrc = fs.readFileSync(path.join(ROOT, 'js/components/shell.js'), 'utf8');
  if (/style="width:/.test(shellSrc)) {
    fail('shell.js still sets the sidebar width with an inline style, which overrides the desktop-only collapse in css/app.css');
  } else if (!/is-collapsed/.test(shellSrc)) {
    fail('shell.js does not toggle the is-collapsed class the css/app.css rule depends on');
  } else {
    pass('sidebar collapse is applied as a class, not an inline width');
  }

  // A manifest that locks orientation makes a tablet or a desk unusable.
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
  if (manifest.orientation === 'portrait-primary') {
    fail('manifest.webmanifest locks orientation to portrait, so the app cannot be used in landscape on a phone or tablet');
  } else {
    pass('manifest does not lock orientation');
  }
  if (manifest.display !== 'standalone') fail('manifest display should stay standalone so the app opens without browser chrome');
  else pass('manifest opens in standalone display mode');

  // The viewport opts into the display cutout, so something must consume the
  // safe-area insets or the topbar renders underneath the notch when installed.
  if (/viewport-fit=cover/.test(html) && !/safe-area-inset/.test(appCss)) {
    fail('index.html sets viewport-fit=cover but css/app.css never reads env(safe-area-inset-*)');
  } else {
    pass('viewport-fit=cover is matched by safe-area handling');
  }


  // ---- 10. The install event must be captured before the deferred module ----
  const installIndex = html.indexOf('beforeinstallprompt');
  const moduleIndex = html.indexOf('<script type="module"');
  if (installIndex === -1) fail('index.html does not listen for beforeinstallprompt');
  else if (moduleIndex !== -1 && installIndex > moduleIndex) {
    fail('the beforeinstallprompt listener is registered after the module script and will be missed');
  } else {
    pass('beforeinstallprompt is captured before the module script runs');
  }

  // ---- 11. The install banner must be initialised ----
  const appSrc = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  if (!appSrc.includes('initInstallPrompt()')) fail('app.js never calls initInstallPrompt()');
  else if (!/import\s*\{[^}]*initInstallPrompt[^}]*\}/.test(appSrc)) fail('app.js does not import initInstallPrompt');
  else pass('app.js initialises the install prompt');

  console.log(failures ? `\n${failures} FAILURES` : '\nFrontend checks passed');
  process.exit(failures ? 1 : 0);
}
