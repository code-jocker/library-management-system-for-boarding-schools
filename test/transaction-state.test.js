// Regression tests for the circulation state machine.
//
// These cover the stock-corruption bugs: a book marked lost could still be
// "returned" (inflating availableCopies above totalCopies and billing the
// member for a book nobody has) and could still be renewed, chasing a member
// for a book that is already written off.
//
// These are static + logic tests: no database needed, run with
//   node test/transaction-state.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'controllers/transactionController.js'), 'utf8');

function stripComments(s) {
  return s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}
const code = stripComments(src);

test('the model allows the statuses the state machine reasons about', () => {
  const model = fs.readFileSync(path.join(ROOT, 'models/Transaction.js'), 'utf8');
  for (const s of ['borrowed', 'returned', 'overdue', 'lost', 'damaged']) {
    assert.ok(new RegExp(`'${s}'`).test(model), `Transaction.status enum is missing '${s}'`);
  }
});

test('CLOSED_STATUSES covers every non-open status', () => {
  const m = /const CLOSED_STATUSES = \[([^\]]+)\]/.exec(code);
  assert.ok(m, 'CLOSED_STATUSES is not defined in transactionController.js');
  const listed = m[1].split(',').map(s => s.trim().replace(/^'|'$/g, ''));
  for (const s of ['returned', 'lost', 'damaged']) {
    assert.ok(listed.includes(s), `CLOSED_STATUSES omits '${s}', so that loan stays open`);
  }
});

test('every closed status is rejected by the shared guard', () => {
  // isOpenLoan must exclude returned, lost and damaged. A guard that only
  // checks 'returned' is exactly the bug being regression-tested.
  const m = /function isOpenLoan\(txn\)\s*\{\s*return !CLOSED_STATUSES\.includes\(txn\.status\)/.exec(code);
  assert.ok(m, 'isOpenLoan must reject any status listed in CLOSED_STATUSES');
});

test('return, renew, mark-lost and mark-damaged all use the shared guard', () => {
  // Each of these four handlers previously checked only
  // `status === 'returned'`, which let lost and damaged through.
  const handlers = ['const returnBook', 'const renew', 'const markLostOrDamaged'];
  let found = 0;
  for (const marker of handlers) {
    const start = code.indexOf(marker);
    assert.ok(start !== -1, `could not find ${marker} in transactionController.js`);
    const body = code.slice(start, code.indexOf('\n});', start));
    assert.ok(
      body.includes('isOpenLoan(txn)'),
      `${marker} does not call isOpenLoan; it may still accept a lost or damaged loan`
    );
    // The old, too-narrow guard must be gone from these handlers.
    assert.ok(
      !/status === 'returned'/.test(body),
      `${marker} still contains a bare "status === 'returned'" check that misses lost/damaged`
    );
    found++;
  }
  assert.equal(found, 3);
  // markLostOrDamaged serves both write-off routes, so one guard covers both.
  assert.ok(/mark-lost/.test(code) && /mark-damaged/.test(code), 'write-off routes are missing');
});

test('lost books are removed from totalCopies and never returned to the shelf', () => {
  // Marking lost decrements totalCopies and must leave availableCopies alone.
  // Bound the block on the `damaged` branch in comment-stripped code, not on
  // the "Damaged:" comment, which stripComments() has already removed.
  const lostStart = code.indexOf("if (kind === 'lost')");
  const damagedStart = code.indexOf('txn.status = \'damaged\'');
  assert.ok(lostStart !== -1 && damagedStart > lostStart, 'could not locate the lost/damaged branches');
  const lostBlock = code.slice(lostStart, damagedStart);
  assert.ok(/totalCopies: -1/.test(lostBlock), 'marking lost no longer decrements totalCopies');
  assert.ok(
    !/availableCopies/.test(lostBlock),
    'marking lost must not touch availableCopies; the copy was already off the shelf'
  );
});

test('returning a book puts exactly one copy back on the shelf', () => {
  const start = code.indexOf('const returnBook');
  const body = code.slice(start, code.indexOf('\n});', start));
  const increments = body.match(/availableCopies: 1/g) || [];
  assert.equal(increments.length, 1, 'returnBook must increment availableCopies exactly once');
});

test('the shared guard runs before any stock mutation or fine is written', () => {
  // Ordering matters: if the guard came after the Fine.create or the stock
  // update, the corruption would still happen before the 400 was returned.
  for (const marker of ['const returnBook', 'const renew', 'const markLostOrDamaged']) {
    const start = code.indexOf(marker);
    const body = code.slice(start, code.indexOf('\n});', start));
    const guardAt = body.indexOf('isOpenLoan(txn)');
    assert.ok(guardAt !== -1, `${marker} has no guard`);
    const saveAt = body.search(/\.save\(\)|Fine\.create|availableCopies|totalCopies/);
    if (saveAt !== -1) {
      assert.ok(guardAt < saveAt, `${marker} mutates stock or fines before checking the status`);
    }
  }
});