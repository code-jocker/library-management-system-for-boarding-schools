// utils/openlibrary.js
// Fetch book metadata by ISBN from Open Library (https://openlibrary.org).
// Public API, no key or npm dependency required.
//
// Endpoint note: the documented /api/books?bibkeys=... endpoint currently
// answers 404 for every request, so this uses the edition + works chain
// instead, which is the same data by another route:
//   /isbn/<isbn>.json  -> edition record (title, publishers, publish_date)
//   /works/<key>.json  -> description, subjects, author keys
//   /authors/<key>.json -> author display name
//
// Never throws: every entry point returns { ok, data, error } so a network
// failure can never block adding a book. The librarian must always be able to
// type the details by hand.
const cache = new Map(); // normalised isbn -> { at, data }
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
// Open Library is a volunteer-run service reached over school and rural
// links, where transient connect timeouts are common. One retry turns most of
// them into a success rather than a "no record" the librarian would distrust.
const TIMEOUT_MS = 12000;
const ATTEMPTS = 2;
// The lookup is three sequential round trips (edition -> work -> author).
// This caps the total so a librarian never waits indefinitely: past the budget
// we return a clear "not available" and they type the book in by hand.
const BUDGET_MS = 25000;
const OL_BASE = 'https://openlibrary.org';

// Store and scan digits-only. Book.isbn is unique, and the desk lookup in
// controllers/bookController.js anchors /^code$/ — a copy saved as
// "978-0-13-..." but scanned as "978013..." would 404 and look like a
// different book. Normalising on save keeps one identity per ISBN.
function normalizeIsbn(raw) {
  return String(raw == null ? '' : raw).toUpperCase().replace(/[^0-9X]/g, '');
}

// Reject typos before spending network calls on them.
function isValidIsbn(isbn) {
  if (/^\d{13}$/.test(isbn)) {
    let sum = 0;
    for (let i = 0; i < 13; i++) sum += Number(isbn[i]) * (i % 2 === 0 ? 1 : 3);
    return sum % 10 === 0;
  }
  if (/^\d{9}[\dX]$/.test(isbn)) {
    let sum = 0;
    for (let i = 0; i < 10; i++) sum += (isbn[i] === 'X' ? 10 : Number(isbn[i])) * (10 - i);
    return sum % 11 === 0;
  }
  return false;
}

async function fetchJson(url, outerSignal) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  if (outerSignal) {
    if (outerSignal.aborted) controller.abort();
    else outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }
  let last = { ok: false, error: 'Network error' };
  try {
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      try {
        const res = await fetch(url, {
          signal: controller.signal,
          headers: {
            // Open Library asks callers to identify themselves.
            'User-Agent': 'GreenHillsLibrary/1.0 (school library management system)',
            Accept: 'application/json'
          }
        });
        if (res.status === 404) {
          // Definitive: this record does not exist. Do not retry.
          return { ok: false, status: 404, error: 'Not found' };
        }
        if (res.ok) return { ok: true, data: await res.json() };
        last = { ok: false, error: `Open Library returned ${res.status}` };
      } catch (err) {
        last = { ok: false, error: (err && err.name === 'AbortError') ? 'Open Library timed out' : ((err && err.message) || 'Network error') };
        if (last.error === 'Open Library timed out' || controller.signal.aborted) break;
      }
    }
    return last;
  } finally {
    clearTimeout(timer);
    if (outerSignal) outerSignal.removeEventListener('abort', onOuterAbort);
  }
}

const LANG_NAMES = {
  eng: 'English', fre: 'French', spa: 'Spanish', kin: 'Kinyarwanda',
  swa: 'Swahili', ara: 'Arabic', por: 'Portuguese', deu: 'German',
  rus: 'Russian', chi: 'Chinese', hin: 'Hindi', zul: 'Zulu',
  afr: 'Afrikaans', ita: 'Italian', nld: 'Dutch', tur: 'Turkish'
};

// Works descriptions are markdown-ish: wiki links, section rules, CRLF.
// models/Book.description is a plain short string.
function plainText(description) {
  if (!description) return '';
  if (typeof description === 'object') {
    description = description.value || '';
  }
  return String(description)
    .replace(/\r/g, '')
    .replace(/^-{5,}.*$/gm, ' ')          // section rules
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // [text](url) -> text
    .replace(/[*_#>`]/g, '')              // markdown emphasis
    .replace(/<[^>]+>/g, ' ')             // any residual HTML
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000);
}

// publish_date is free text ("1984", "October 1, 1988"); Book.year is a
// Number constrained to 1000-2200.
function parseYear(publishDate) {
  const m = String(publishDate || '').match(/\b(\d{4})\b/);
  if (!m) return null;
  const year = Number(m[1]);
  return year >= 1000 && year <= 2200 ? year : null;
}

// Edition.languages is [{ key: '/languages/eng' }]
function resolveLanguage(languages) {
  const first = Array.isArray(languages) ? languages[0] : null;
  if (!first) return '';
  const code = String(first.key || '').split('/').pop();
  return LANG_NAMES[code] || '';
}

// maps/author.json returns { name: "George Orwell" }
async function resolveAuthorName(authorKey, signal) {
  const res = await fetchJson(`${OL_BASE}${authorKey}.json`, signal);
  if (res.ok && res.data && res.data.name) return String(res.data.name).trim();
  return '';
}

// Works.authors is [{ author: { key: '/authors/OL...' }, type: {...} }];
// edition.authors (older records) is [{ key: '/authors/OL...' }].
function authorKeysOf(edition, work) {
  const list = (work && Array.isArray(work.authors) && work.authors.length)
    ? work.authors
    : (Array.isArray(edition.authors) ? edition.authors : []);
  return list
    .map(entry => (entry && entry.author && entry.author.key) || (entry && entry.key))
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Fetch and normalise the Open Library record for an ISBN.
 * @returns {Promise<{ok: boolean, data?: object, error?: string, isbn?: string}>}
 */
async function fetchDraft(isbn, signal) {
  const editionRes = await fetchJson(`${OL_BASE}/isbn/${encodeURIComponent(isbn)}.json`, signal);
  if (!editionRes.ok) {
    return {
      ok: false,
      error: editionRes.status === 404
        ? 'Open Library has no record for that ISBN. Enter the details manually.'
        : editionRes.error
    };
  }

  const edition = editionRes.data;
  const title = String(edition.title || '').trim();

  // The works record carries description, subjects and usually the author
  // keys. A missing works entry is not fatal — the edition alone is enough
  // for a usable draft.
  const workKey = Array.isArray(edition.works) && edition.works[0] && edition.works[0].key;

  // Author names usually live on the works record, so fetch it once and derive
  // the author string from it rather than fetching the work twice.
  let work = null;
  if (workKey) {
    const workRes = await fetchJson(`${OL_BASE}${workKey}.json`, signal);
    if (workRes.ok) work = workRes.data;
  }

  const keys = authorKeysOf(edition, work);
  // Distinguish "no author in the record" from "the author request failed".
  // Collapsing the two makes a flaky connection look like a missing record,
  // and the librarian would retype a book that is perfectly well recorded.
  let authorLookupFailed = false;
  const nameResults = await Promise.all(keys.map(async (key) => {
    const name = await resolveAuthorName(key, signal);
    if (!name) authorLookupFailed = true;
    return name;
  }));
  const names = nameResults.filter(Boolean);
  const author = names.join(', ');

  const publishers = Array.isArray(edition.publishers) ? edition.publishers.filter(Boolean) : [];
  // Covers are stored as numeric ids on the edition, not URLs.
  const coverId = Array.isArray(edition.covers)
    ? edition.covers.find(id => typeof id === 'number' && id > 0)
    : null;

  return {
    title,
    author,
    publisher: publishers.join(', '),
    year: parseYear(edition.publish_date),
    edition: String(edition.edition_name || '').trim(),
    language: resolveLanguage(edition.languages),
    description: plainText(work && work.description) || plainText(edition.description),
    pageCount: edition.number_of_pages || (work && work.number_of_pages) || null,
    coverUrl: coverId ? `https://covers.openlibrary.org/b/id/${coverId}-M.jpg` : '',
    // Suggestions only. We must not auto-create categories from these:
    // models/Category.name is unique, and Open Library subjects are free text
    // full of near-duplicates ("fiction", "Fiction", "novels").
    subjects: (work && Array.isArray(work.subjects) ? work.subjects : []).filter(Boolean).slice(0, 12),
    // Set when author keys existed but the name requests did not come back.
    // Callers can then say "connection problem, try again" instead of
    // "this book has no author".
    authorLookupFailed
  };
}

/**
 * Look up a book by ISBN, with a long-lived in-memory cache.
 * @returns {Promise<{ok: boolean, data?: object, error?: string, cached?: boolean, isbn?: string}>}
 */
async function lookupByIsbn(rawIsbn) {
  const isbn = normalizeIsbn(rawIsbn);
  if (!isbn) return { ok: false, error: 'Enter an ISBN first' };
  if (!isValidIsbn(isbn)) {
    return { ok: false, error: 'That is not a valid ISBN-10 or ISBN-13. Check the number.' };
  }

  const hit = cache.get(isbn);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { ok: true, isbn, data: hit.data, cached: true };
  }

  // Hard cap on the whole lookup. Author name resolution is the last step and
  // the slowest, so if the budget is already spent we return what we have and
  // let the librarian type the author rather than hanging the desk.
  const budget = new AbortController();
  const budgetTimer = setTimeout(() => budget.abort(), BUDGET_MS);
  try {
    const draft = await fetchDraft(isbn, budget.signal);

    if (!draft.title) {
      return { ok: false, isbn, error: 'Open Library returned an incomplete record. Enter the details manually.' };
    }

    if (!draft.author) {
      // An unresolved author is either a network failure or a genuinely
      // author-less record. Only cache the answer when it is a real answer,
      // so a dropped connection is never cached for 30 days.
      if (draft.authorLookupFailed) {
        return { ok: false, isbn, retryable: true, error: 'Could not reach Open Library. Check the connection and try again, or enter the details manually.' };
      }
      return { ok: false, isbn, error: 'Open Library has this ISBN but no author. Enter the details manually.' };
    }

    cache.set(isbn, { at: Date.now(), data: draft });
    return { ok: true, isbn, data: draft, cached: false };
  } finally {
    clearTimeout(budgetTimer);
  }
}

module.exports = { lookupByIsbn, normalizeIsbn, isValidIsbn, fetchDraft, plainText, parseYear };
