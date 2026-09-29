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
  // branch has no tailwind.config.js to rebuild it, so a class invented in a
  // component silently renders unstyled. The install banner is built by hand
  // rather than reusing an existing view's class strings, so it is the risk.
  const compiledCss = fs.readFileSync(path.join(ROOT, 'css/tailwind.css'), 'utf8');
  const bannerSrc = fs.readFileSync(path.join(ROOT, 'js/components/installPrompt.js'), 'utf8');
  const classAttr = [...bannerSrc.matchAll(/className\s*=\s*'([^']+)'|class="([^"]+)"/g)]
    .map((m) => m[1] || m[2])
    .join(' ')
    // Keep only the plain class names, not the ${...} template holes.
    .replace(/\$\{[^}]*\}/g, ' ')
    .split(/\s+/)
    .filter((c) => c && !c.includes('$'));
  // CSS escapes ':' and brackets in a selector (.z-\[9000\], .dark\:bg-slate-800).
  const cssSelector = (name) => '.' + name.replace(/([:[\]/.\%])/g, '\\$1');
  const absent = [...new Set(classAttr)].filter((c) => !compiledCss.includes(cssSelector(c)));
  if (absent.length) fail(`installPrompt.js uses classes missing from css/tailwind.css: ${absent.join(', ')}`);
  else pass(`all ${new Set(classAttr).size} install-banner classes exist in the compiled CSS`);

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
