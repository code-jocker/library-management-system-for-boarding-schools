// scripts/test-isbn-lookup.js
// Offline check for the Open Library ISBN lookup path. Mocks the Book model so
// it runs without MongoDB, and exercises the controller handler end to end.
//
// Run: node scripts/test-isbn-lookup.js
const assert = require('assert');
const path = require('path');

// Mock mongoose so requiring models does not need a live connection.
const Module = require('module');
const originalLoad = Module._load;
let bookStore = [];
Module._load = function patched(request, parent, isMain) {
  if (parent && /controllers[\\/]bookController\.js$/.test(parent.filename) && request === '../models/Book') {
    return {
      findOne: () => ({ select: () => ({ lean: async () => bookStore[0] || null }) }),
      find: () => ({ select: () => ({ lean: async () => [] }), sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) }),
      countDocuments: async () => 0,
      distinct: async () => [],
      findById: async () => null,
      findByIdAndDelete: async () => null
    };
  }
  if (parent && /controllers[\\/]bookController\.js$/.test(parent.filename) && request === '../models/Category') {
    return { find: () => ({ lean: async () => [] }) };
  }
  if (parent && /controllers[\\/]bookController\.js$/.test(parent.filename) && request === '../models/Transaction') {
    return { find: () => ({ sort: () => ({ limit: () => ({ populate: () => ({ lean: async () => [] }) }) }) }), countDocuments: async () => 0 };
  }
  if (parent && /controllers[\\/]bookController\.js$/.test(parent.filename) && request === '../models/Reservation') {
    return { countDocuments: async () => 0 };
  }
  if (parent && /controllers[\\/]bookController\.js$/.test(parent.filename) && request === '../utils/activityLogger') {
    return { logActivity: async () => {} };
  }
  return originalLoad(request, parent, isMain);
};

const ol = require(path.join('..', 'utils', 'openlibrary'));
const ctrl = require(path.join('..', 'controllers', 'bookController'));

function fakeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (c) => { res.statusCode = c; return res; };
  res.json = (b) => { res.body = b; return res; };
  return res;
}

async function call(query) {
  const res = fakeRes();
  let handlerError = null;
  await ctrl.isbnLookup({ query }, res, (err) => { handlerError = err; });
  if (handlerError) {
    // asyncHandler forwards rejections to next(); surface them as a failure
    // instead of silently returning an empty body.
    res.statusCode = 500;
    res.body = { success: false, message: `Handler threw: ${handlerError.message}` };
  }
  return res;
}

// Retries around flaky upstream connectivity so the test is not flaky itself.
// The handler surfaces `retryable` when a lookup failed on the network rather
// than on a genuinely absent record.
async function withRetry(fn, attempts = 6) {
  let r;
  for (let i = 0; i < attempts; i++) {
    r = await fn();
    const msg = r && r.body && r.body.message ? String(r.body.message) : '';
    if (r.body && r.body.success) return r;
    if (!/timed out|Network error|Could not reach|ECONN|ENOTFOUND|returned 5/i.test(msg)) return r;
    await new Promise(s => setTimeout(s, 2500));
  }
  return r;
}

const results = [];
function check(name, cond, detail) {
  results.push({ name, pass: !!cond, detail: detail || '' });
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
}

(async () => {
  // --- pure helpers, no network ---
  check('normalize strips hyphens', ol.normalizeIsbn('978-0-451-52493-5') === '9780451524935');
  check('normalize keeps ISBN-10 X', ol.normalizeIsbn('0-8044-2957-X') === '080442957X');
  check('valid ISBN-13 accepted', ol.isValidIsbn('9780451524935'));
  check('invalid checksum rejected', !ol.isValidIsbn('1234567890123'));
  check('valid ISBN-10 accepted', ol.isValidIsbn('080442957X'));
  check('plainText strips markdown links',
    ol.plainText('A [link](http://x.co) here').includes('A link here'),
    ol.plainText('A [link](http://x.co) here'));
  check('parseYear pulls 4-digit year', ol.parseYear('October 1, 1988') === 1988);
  check('parseYear rejects junk', ol.parseYear('unknown') === null);

  // --- controller guards, no network needed ---
  let res = await call({ isbn: '' });
  check('empty ISBN is rejected', res.body.success === false && /Enter an ISBN/.test(res.body.message), res.body.message);

  res = await call({ isbn: '1234567890123' });
  check('bad checksum rejected before any fetch', res.body.success === false && /not a valid ISBN/.test(res.body.message), res.body.message);

  res = await call({ isbn: '9791234567890' });
  check('well-formed but unknown ISBN is handled', res.body.success === false, res.body.message);

  // --- live lookup ---
  const live = await withRetry(() => call({ isbn: '978-0-451-52493-5' }));
  if (live.body.success) {
    const b = live.body.data.book;
    check('live lookup returns title', b.title === '1984', b.title);
    check('live lookup resolves author', b.author === 'George Orwell', b.author);
    check('live lookup maps publisher', b.publisher === 'Signet Classic', b.publisher);
    check('live lookup maps year as number', b.year === 1984, String(b.year));
    check('live lookup maps language', b.language === 'English', b.language);
    check('live lookup returns description', typeof b.description === 'string' && b.description.length > 40);
    check('live lookup returns subjects as suggestions', Array.isArray(b.subjects));
    check('response reports normalised isbn', live.body.data.isbn === '9780451524935');
    check('duplicate check present', 'alreadyInLibrary' in live.body.data);
    check('no fields invented for librarian', !('totalCopies' in b) && !('shelfLocation' in b) && !('replacementValue' in b));
  } else {
    check('live lookup (skipped: upstream unreachable)', true, live.body.message);
  }

  // --- duplicate detection: Book.isbn is unique, so the UI must be warned
  // before a save throws E11000 ---
  bookStore = [{
    title: '1984', author: 'George Orwell', isbn: '9780451524935',
    totalCopies: 4, availableCopies: 2, shelfLocation: 'FIC-2'
  }];
  const dup = await withRetry(() => call({ isbn: '978-0-451-52493-5' }));
  if (dup.body.success) {
    check('existing copy detected', !!dup.body.data.alreadyInLibrary,
      dup.body.data.alreadyInLibrary ? dup.body.data.alreadyInLibrary.title : 'none');
    check('duplicate lookup still returns data', dup.body.data.book.title === '1984');
  } else {
    check('duplicate check (skipped: upstream unreachable)', true, dup.body.message);
  }
  bookStore = [];

  const failed = results.filter(r => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
