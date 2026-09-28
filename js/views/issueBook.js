// public/js/views/issueBook.js
// Issue desk without a barcode scanner: search a book by TITLE on the left, pick
// it, then search the student by name or admission number on the right. The
// right panel previews the book and issues it in one place. Blocks with an exact
// reason when the member is ineligible or no copies are available.
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getState } from '../core/store.js';
import { escapeHtml, formatDate, formatMoney, toInputDate, addDays } from '../core/utils.js';
import { pageHeader, card, BTN } from '../components/pageHeader.js';
import { avatar, bookCover } from '../components/avatar.js';
import { toast } from '../components/toast.js';

const inputCls = 'w-full rounded-input border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-3 text-base min-h-[52px] focus:border-primary focus:ring-2 focus:ring-primary/20';

function debounce(fn, ms = 300) {
  let id;
  return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const settings = getState().settings || {};
  let bookData = null;     // selected book (from the title search)
  let memberData = null;   // selected member (from /members/lookup)
  let issuing = false;

  host.innerHTML = '';
  host.appendChild(pageHeader({
    title: t('issue.title'),
    crumbs: ctx.defaultCrumbs,
    actions: [{ label: t('issue.reset'), icon: 'rotate-ccw', variant: 'outline', id: 'reset', onClick: reset }]
  }));

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    <div class="grid lg:grid-cols-2 gap-6 items-start">
      <!-- LEFT: search a book by title -->
      ${card(`<label for="book-search" class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
          <span class="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center font-bold">1</span>${escapeHtml(t('issue.findBook'))}</label>
        <div class="relative">
          <i data-lucide="search" class="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input id="book-search" class="${inputCls} pl-11" autocomplete="off" placeholder="${escapeHtml(t('issue.bookTitlePlaceholder'))}" />
        </div>
        <div id="book-results" class="mt-3 max-h-[26rem] overflow-auto scroll-slim space-y-2"></div>`)}

      <!-- RIGHT: preview + student search + issue -->
      <div id="preview-col">
        ${card(`<div id="preview-empty" class="text-center py-10 text-slate-400">
            <i data-lucide="book-open" class="w-10 h-10 mx-auto mb-2 opacity-60"></i>
            <p class="text-sm">${escapeHtml(t('issue.pickBookHint'))}</p>
          </div>
          <div id="preview" class="hidden">
            <div id="book-card"></div>

            <div class="mt-5 pt-5 border-t border-slate-200 dark:border-slate-700">
              <label for="student-search" class="flex items-center gap-2 text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
                <span class="w-6 h-6 rounded-full bg-primary text-white text-xs flex items-center justify-center font-bold">2</span>${escapeHtml(t('issue.findStudent'))}</label>
              <div class="relative">
                <i data-lucide="user-search" class="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
                <input id="student-search" class="${inputCls} pl-11" autocomplete="off" placeholder="${escapeHtml(t('issue.studentPlaceholder'))}" />
              </div>
              <div id="student-results" class="mt-3 max-h-56 overflow-auto scroll-slim space-y-2"></div>
              <div id="student-card" class="mt-3"></div>
            </div>

            <div id="block-banner" class="hidden mt-4 p-4 rounded-card bg-red-50 dark:bg-red-900/20 border-2 border-danger">
              <div class="flex items-start gap-3">
                <i data-lucide="alert-octagon" class="w-6 h-6 text-danger flex-shrink-0"></i>
                <div><p class="font-heading font-semibold text-danger">${escapeHtml(t('issue.cannotIssue'))}</p>
                <ul id="block-reasons" class="mt-1 text-sm text-red-700 dark:text-red-300 list-disc pl-5 space-y-0.5"></ul>
                <button id="reserve-btn" class="hidden mt-3 ${BTN.secondary}"><i data-lucide="bookmark" class="w-4 h-4"></i>${escapeHtml(t('issue.reserveInstead'))}</button></div>
              </div>
            </div>

            <div class="mt-5 flex flex-wrap items-end gap-4">
              <div class="flex-1 min-w-[180px]">
                <label for="due-input" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">${escapeHtml(t('issue.dueDate'))}</label>
                <input id="due-input" type="date" class="${inputCls}" value="${toInputDate(addDays(new Date(), settings.loanDays || 14))}" />
              </div>
              <button id="issue-btn" class="${BTN.primary} text-base px-8" disabled><i data-lucide="log-in" class="w-5 h-5"></i>${escapeHtml(t('issue.issue'))}</button>
            </div>
          </div>`)}
      </div>
    </div>`;
  host.appendChild(wrap);
  if (window.lucide) window.lucide.createIcons();

  const bookSearch = wrap.querySelector('#book-search');
  const bookResults = wrap.querySelector('#book-results');
  const previewEmpty = wrap.querySelector('#preview-empty');
  const preview = wrap.querySelector('#preview');
  const studentSearch = wrap.querySelector('#student-search');
  const studentResults = wrap.querySelector('#student-results');
  const dueInput = wrap.querySelector('#due-input');
  const issueBtn = wrap.querySelector('#issue-btn');
  const banner = wrap.querySelector('#block-banner');
  const reasonsEl = wrap.querySelector('#block-reasons');
  const reserveBtn = wrap.querySelector('#reserve-btn');

  // ---- Book search by title ----
  async function searchBooks(term) {
    const q = term.trim();
    if (q.length < 2) { bookResults.innerHTML = ''; return; }
    bookResults.innerHTML = `<p class="text-sm text-slate-400 py-2">${escapeHtml(t('common.loading'))}</p>`;
    try {
      const res = await api.get('/books?q=' + encodeURIComponent(q) + '&titleOnly=1&limit=12', { signal: ctx.signal });
      const items = res.data.items || [];
      if (!items.length) {
        bookResults.innerHTML = `<p class="text-sm text-slate-400 py-2">${escapeHtml(t('books.noBooks'))}</p>`;
        return;
      }
      bookResults.innerHTML = items.map((b) => `
        <button data-book="${escapeHtml(b._id)}" class="w-full text-left flex items-center gap-3 p-3 rounded-input border border-slate-200 dark:border-slate-600 hover:border-primary hover:bg-primary-50/40 dark:hover:bg-slate-700/40 transition">
          ${bookCover({ src: b.cover, title: b.title, size: 'sm' })}
          <div class="min-w-0 flex-1">
            <p class="font-medium text-slate-800 dark:text-slate-100 truncate">${escapeHtml(b.title)}</p>
            <p class="text-xs text-slate-500 dark:text-slate-400 truncate">${escapeHtml(b.author)}</p>
            <p class="text-xs mt-0.5 ${b.availableCopies > 0 ? 'text-success font-medium' : 'text-danger font-medium'}">${escapeHtml(t('books.copiesAvailable', { n: b.availableCopies, t: b.totalCopies }))}</p>
          </div>
        </button>`).join('');
      if (window.lucide) window.lucide.createIcons();
      bookResults.querySelectorAll('[data-book]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const id = btn.getAttribute('data-book');
          const found = items.find((x) => x._id === id);
          if (found) selectBook(found);
        });
      });
    } catch (err) {
      if (err.name !== 'AbortError') bookResults.innerHTML = `<p class="text-sm text-danger py-2">${escapeHtml(err.message)}</p>`;
    }
  }

  function selectBook(b) {
    bookData = b;
    previewEmpty.classList.add('hidden');
    preview.classList.remove('hidden');
    wrap.querySelector('#book-card').innerHTML = `
      <div class="flex items-center gap-3 p-3 rounded-input bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600">
        ${bookCover({ src: b.cover, title: b.title, size: 'md' })}
        <div class="min-w-0 flex-1">
          <p class="font-heading font-semibold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(b.title)}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(b.author)}${b.isbn ? ' · ' + escapeHtml(b.isbn) : ''}</p>
          <p class="text-xs mt-1 ${b.availableCopies > 0 ? 'text-success font-medium' : 'text-danger font-medium'}">${escapeHtml(t('books.copiesAvailable', { n: b.availableCopies, t: b.totalCopies }))}</p>
        </div>
        <button id="clear-book" class="text-slate-400 hover:text-danger" title="${escapeHtml(t('common.clearFilters'))}"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    wrap.querySelector('#clear-book').addEventListener('click', () => {
      bookData = null;
      preview.classList.add('hidden');
      previewEmpty.classList.remove('hidden');
      bookSearch.value = '';
      bookResults.innerHTML = '';
      evaluate();
      bookSearch.focus();
    });
    evaluate();
    studentSearch.focus();
  }

  // ---- Student search by name or admission number ----
  async function searchStudents(term) {
    const q = term.trim();
    if (q.length < 2) { studentResults.innerHTML = ''; return; }
    studentResults.innerHTML = `<p class="text-sm text-slate-400 py-2">${escapeHtml(t('common.loading'))}</p>`;
    try {
      const res = await api.get('/members?q=' + encodeURIComponent(q) + '&limit=10&status=active', { signal: ctx.signal });
      const items = res.data.items || [];
      if (!items.length) {
        studentResults.innerHTML = `<p class="text-sm text-slate-400 py-2">${escapeHtml(t('members.noMembers'))}</p>`;
        return;
      }
      studentResults.innerHTML = items.map((m) => `
        <button data-adm="${escapeHtml(m.admissionNo)}" class="w-full text-left flex items-center gap-3 p-2 rounded-input border border-slate-200 dark:border-slate-600 hover:border-primary hover:bg-primary-50/40 dark:hover:bg-slate-700/40 transition">
          ${avatar({ src: m.photo, name: m.fullName, size: 'sm' })}
          <div class="min-w-0 flex-1">
            <p class="font-medium text-slate-800 dark:text-slate-100 truncate">${escapeHtml(m.fullName)}</p>
            <p class="text-xs text-slate-400 truncate">${escapeHtml(m.admissionNo)} · ${escapeHtml([m.classLevel, m.stream].filter(Boolean).join(' '))}</p>
          </div>
        </button>`).join('');
      if (window.lucide) window.lucide.createIcons();
      studentResults.querySelectorAll('[data-adm]').forEach((btn) => {
        btn.addEventListener('click', () => pickStudent(btn.getAttribute('data-adm')));
      });
    } catch (err) {
      if (err.name !== 'AbortError') studentResults.innerHTML = `<p class="text-sm text-danger py-2">${escapeHtml(err.message)}</p>`;
    }
  }

  async function pickStudent(adm) {
    try {
      const res = await api.get('/members/lookup?admissionNo=' + encodeURIComponent(adm), { signal: ctx.signal });
      memberData = res.data;
      studentResults.innerHTML = '';
      studentSearch.value = '';
      renderStudent();
      evaluate();
    } catch (err) {
      memberData = null;
      toast(err.message, 'error');
    }
  }

  function renderStudent() {
    const m = memberData.member;
    const over = memberData.overdueCount;
    wrap.querySelector('#student-card').innerHTML = `
      <div class="flex items-center gap-3 p-3 rounded-input bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600">
        ${avatar({ src: m.photo, name: m.fullName, size: 'md' })}
        <div class="min-w-0 flex-1">
          <p class="font-semibold text-slate-800 dark:text-slate-100 truncate">${escapeHtml(m.fullName)}</p>
          <p class="text-xs text-slate-500 dark:text-slate-400">${escapeHtml(m.admissionNo)} · ${escapeHtml([m.classLevel, m.stream].filter(Boolean).join(' '))} · ${escapeHtml(m.dormitory || '')}</p>
          <p class="text-xs mt-1 ${over ? 'text-danger font-medium' : 'text-slate-500'}">${escapeHtml(t('issue.booksOut', { n: memberData.activeLoanCount, limit: memberData.borrowingLimit }))}${over ? ` · ${over} ${escapeHtml(t('dashboard.overdue').toLowerCase())}` : ''}</p>
          ${memberData.unpaidFines > 0 ? `<p class="text-xs text-danger font-medium">${escapeHtml(formatMoney(memberData.unpaidFines))} ${escapeHtml(t('dashboard.unpaidFines').toLowerCase())}</p>` : ''}
        </div>
        <a href="#/members/${escapeHtml(m._id)}" class="text-slate-400 hover:text-primary" title="${escapeHtml(t('nav.memberProfile'))}" aria-label="${escapeHtml(t('nav.memberProfile'))}"><i data-lucide="external-link" class="w-5 h-5"></i></a>
        <button id="clear-student" class="text-slate-400 hover:text-danger" title="${escapeHtml(t('common.clearFilters'))}"><i data-lucide="x" class="w-5 h-5"></i></button>
      </div>`;
    if (window.lucide) window.lucide.createIcons();
    wrap.querySelector('#clear-student').addEventListener('click', () => {
      memberData = null;
      wrap.querySelector('#student-card').innerHTML = '';
      evaluate();
      studentSearch.focus();
    });
  }

  // ---- Blocking evaluation ----
  function evaluate() {
    const reasons = [];
    let canReserve = false;
    if (memberData) {
      if (memberData.member.status !== 'active') reasons.push(`${t('members.status')}: ${memberData.member.status}`);
      if (memberData.overdueCount > 0) reasons.push(`${memberData.overdueCount} ${t('dashboard.overdue').toLowerCase()}`);
      if (memberData.unpaidFines > 0) reasons.push(`${formatMoney(memberData.unpaidFines)} ${t('dashboard.unpaidFines').toLowerCase()}`);
      if (memberData.activeLoanCount >= memberData.borrowingLimit) reasons.push(t('issue.booksOut', { n: memberData.activeLoanCount, limit: memberData.borrowingLimit }));
    }
    if (bookData && bookData.availableCopies <= 0) { reasons.push(t('issue.noCopies')); canReserve = true; }

    const blocked = reasons.length > 0 || !memberData || !bookData;
    if (reasons.length) {
      banner.classList.remove('hidden');
      reasonsEl.innerHTML = reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('');
      reserveBtn.classList.toggle('hidden', !canReserve);
    } else {
      banner.classList.add('hidden');
    }
    issueBtn.disabled = blocked;
    issueBtn.classList.toggle('opacity-50', blocked);
    if (window.lucide) window.lucide.createIcons();
    return !blocked;
  }

  reserveBtn.addEventListener('click', async () => {
    if (!memberData || !bookData) return;
    try {
      const res = await api.post('/reservations', { bookId: bookData._id, memberId: memberData.member._id });
      toast(res.message || t('reservations.created'), 'success');
      reset();
    } catch (err) { toast(err.message, 'error'); }
  });

  // ---- Issue ----
  async function doIssue() {
    if (issuing) return;               // guard against double-click over-issue
    if (!evaluate()) return;
    issuing = true;
    issueBtn.disabled = true;
    issueBtn.innerHTML = `<i data-lucide="loader-2" class="w-5 h-5 animate-spin"></i>${escapeHtml(t('issue.issuing'))}`;
    if (window.lucide) window.lucide.createIcons();
    try {
      const res = await api.post('/transactions/issue', {
        memberId: memberData.member._id,
        bookId: bookData._id,
        dueDate: dueInput.value
      });
      // The loan is persisted as a transaction and shows up in the Books Issued
      // report — we no longer auto-print a slip on every issue.
      toast(res.message || t('issue.success'), 'success');
      reset();
    } catch (err) {
      toast(err.message, 'error');
      if (err.data && err.data.reasons) {
        banner.classList.remove('hidden');
        reasonsEl.innerHTML = err.data.reasons.map((r) => `<li>${escapeHtml(r)}</li>`).join('');
        reserveBtn.classList.toggle('hidden', !err.data.canReserve);
      }
    } finally {
      issuing = false;
      issueBtn.disabled = false;
      issueBtn.innerHTML = `<i data-lucide="log-in" class="w-5 h-5"></i>${escapeHtml(t('issue.issue'))}`;
      if (window.lucide) window.lucide.createIcons();
    }
  }

  issueBtn.addEventListener('click', doIssue);
  dueInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doIssue(); } });

  bookSearch.addEventListener('input', debounce((e) => searchBooks(e.target.value), 300));
  bookSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchBooks(bookSearch.value); } });
  studentSearch.addEventListener('input', debounce((e) => searchStudents(e.target.value), 300));
  studentSearch.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchStudents(studentSearch.value); } });

  function reset() {
    memberData = null; bookData = null; issuing = false;
    bookSearch.value = ''; studentSearch.value = '';
    bookResults.innerHTML = ''; studentResults.innerHTML = '';
    wrap.querySelector('#student-card').innerHTML = '';
    preview.classList.add('hidden');
    previewEmpty.classList.remove('hidden');
    dueInput.value = toInputDate(addDays(new Date(), settings.loanDays || 14));
    banner.classList.add('hidden');
    issueBtn.disabled = true;
    bookSearch.focus();
  }

  // Pre-fill from query when arriving from another screen:
  //   ?book=<title term|id>    -> search by title, or load a specific book by id
  //   ?member=<admissionNo|id> -> load that student into the right panel
  async function loadBookParam(val) {
    if (/^[a-f\d]{24}$/i.test(val)) {
      try {
        const res = await api.get('/books/' + val, { signal: ctx.signal });
        if (res.data && res.data.book) { selectBook(res.data.book); return; }
      } catch { /* fall through to a title search */ }
    }
    bookSearch.value = val;
    searchBooks(val);
  }

  async function loadMemberParam(val) {
    try {
      let adm = val;
      // Accept either an admission number or a raw member ObjectId.
      if (/^[a-f\d]{24}$/i.test(val)) {
        const r = await api.get('/members/' + val, { signal: ctx.signal });
        adm = r.data.member.admissionNo;
      }
      await pickStudent(adm);
      // The student panel lives inside #preview, which is normally revealed only
      // after a book is picked. Show it now so a member-first arrival is visible.
      previewEmpty.classList.add('hidden');
      preview.classList.remove('hidden');
      const bc = wrap.querySelector('#book-card');
      if (bc && !bc.innerHTML.trim()) {
        bc.innerHTML = `<p class="text-sm text-slate-400 py-2">${escapeHtml(t('issue.pickBookHint'))}</p>`;
      }
      evaluate();
    } catch { /* the librarian can search manually */ }
  }

  if (ctx.query.book) loadBookParam(ctx.query.book);
  if (ctx.query.member) loadMemberParam(ctx.query.member);
  bookSearch.focus();

  return function unmount() {};
}
