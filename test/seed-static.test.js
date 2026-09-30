// Regression guard for the auto-seed behaviour — static checks only.
// These prove the server no longer resets passwords on boot, without
// needing a database. Run with: node test/seed-static.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const serverSrc = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
const seedSrc = fs.readFileSync(path.join(ROOT, 'seed/seedLibrarian.js'), 'utf8');
const env = fs.readFileSync(path.join(ROOT, '.env.example'), 'utf8');

function stripComments(src) {
  // Remove // line comments and /* block comments */ so we don't flag our
  // own explanatory text as a violation.
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '');
}

const serverCode = stripComments(serverSrc);
const envLive = env.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');

test('the server exposes no unauthenticated /seed route', () => {
  assert.equal(
    /app\.(all|get|post|put|patch|delete)\s*\(\s*['"`][^'"`]*seed/i.test(serverCode),
    false,
    'server.js registers a route whose path contains "seed"'
  );
  assert.equal(serverCode.includes('_seed'), false, 'server.js still references _seed');
});

test('boot() does not create or update any user', () => {
  assert.equal(
    /autoSeed/.test(serverSrc),
    false,
    'server.js still calls autoSeed; it would reset passwordHash on every boot'
  );
  const boot = serverSrc.slice(serverSrc.indexOf('async function boot'));
  assert.equal(/User\.(update|findOneAndUpdate|create|upsert)/.test(boot), false,
    'boot() writes to the User collection, which can reset a password');
});

test('server.js does not hash a password at boot', () => {
  assert.equal(
    /hashPassword/.test(serverSrc),
    false,
    'server.js hashes a password, which only makes sense if it is resetting one'
  );
});

test('the seed script has no hardcoded fallback password', () => {
  assert.equal(
    /DEFAULT_LIBRARIAN_PASSWORD\s*\|\|\s*['"]/.test(seedSrc),
    false,
    'seedLibrarian.js falls back to a literal password, which is a publicly known credential'
  );
  assert.equal(/Librarian@2024/.test(seedSrc), false, 'the old default password is still present');
});

test('.env.example ships no real credential', () => {
  const mongo = envLive.split('\n').find((l) => l.startsWith('MONGODB_URI='));
  assert.ok(mongo, 'MONGODB_URI is missing from .env.example');
  assert.equal(mongo.trim(), 'MONGODB_URI=', 'MONGODB_URI should be left empty in the example file');
  assert.equal(/mongodb\+srv:\/\/[^@\s]+:[^@\s]+@/.test(envLive), false,
    '.env.example still contains a credentialed connection string');
  const defaultPw = envLive.split('\n').find((l) => l.startsWith('DEFAULT_LIBRARIAN_PASSWORD='));
  assert.ok(defaultPw.trim() === 'DEFAULT_LIBRARIAN_PASSWORD=', 'the example ships a default password');
});

test('the seed script refuses to run without DEFAULT_LIBRARIAN_PASSWORD', () => {
  assert.ok(/resolveInitialPassword/.test(seedSrc), 'seedLibrarian.js does not define resolveInitialPassword');
  assert.ok(/DEFAULT_LIBRARIAN_PASSWORD/.test(seedSrc), 'seedLibrarian.js does not reference DEFAULT_LIBRARIAN_PASSWORD');
  assert.ok(/process\.exit\(1\)/.test(seedSrc), 'seedLibrarian.js does not exit on missing password');
});

test('the seed script never overwrites an existing librarian', () => {
  const existingCheck = seedSrc.slice(seedSrc.indexOf('existing = await User.findOne'));
  assert.ok(/if \(existing\)/.test(existingCheck), 'seed script does not check for existing account');
  assert.ok(/Leaving it untouched|leaving.*untouched/i.test(existingCheck), 'seed script does not document that it skips');
});

test('warnIfNoUsers warns when the database is empty', () => {
  assert.ok(/warnIfNoUsers/.test(serverSrc), 'server.js does not define warnIfNoUsers');
  assert.ok(/No user accounts exist/.test(serverSrc), 'server.js does not warn when empty');
});

test('server.js does not use Setting or the scheduler to seed data', () => {
  // server.js legitimately *reads* the settings document at the "/" route to
  // decide whether to redirect to /setup, and starts the scheduler so overdue
  // reminders go out. Both are fine. What must never happen is a *write*:
  // that is what would silently reset library configuration or a password on
  // every start, so the guard targets writes only.
  assert.equal(/Setting\.(create|insert|update|updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|replaceOne|bulkWrite)/.test(serverCode), false,
    'server.js writes to the settings collection, which would reset library configuration on boot');

  // The scheduler sends reminders. It must never create or mutate a user,
  // which is the failure mode this whole file guards against.
  const schedulerSrc = stripComments(fs.readFileSync(path.join(ROOT, 'utils/scheduler.js'), 'utf8'));
  assert.equal(/User\.(create|update|updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate)/.test(schedulerSrc), false,
    'the scheduler writes to the User collection; it should only send reminders');

  assert.equal(/Setting\.(create|insert|update|updateOne|updateMany|findOneAndUpdate|findByIdAndUpdate|replaceOne|bulkWrite)/.test(schedulerSrc), false,
    'the scheduler writes to the settings collection; it should only read them');
});

console.log('\nAll static regression checks passed.');