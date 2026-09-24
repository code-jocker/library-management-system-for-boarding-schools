// public/js/views/reservations.js
// Reservation queue: list, create (member + book), fulfill held copies, cancel.
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { escapeHtml, formatDate, buildQuery, debounce } from '../core/utils.js';
import { pageHeader, BTN } from '../components/pageHeader.js';
import { renderFilterBar } from '../components/filterBar.js';
import { dataTable } from '../components/dataTable.js';
import { skeletonTable } from '../components/skeleton.js';
import { badge } from '../components/badge.js';
import { avatar } from '../components/avatar.js';
import { openModal, closeModal } from '../components/modal.js';
import { confirmDialog } from '../components/confirm.js';
import { toast } from '../components/toast.js';

const STATUSES = ['waiting', 'ready', 'fulfilled', 'cancelled', 'expired'];

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const q = { ...ctx.query };

  host.innerHTML = '';
  host.appendChild(pageHeader({
    title: t('reservations.title'),
    crumbs: ctx.defaultCrumbs,
    actions: [{ id: 'new-res', label: t('reservations.reserve'), icon: 'bookmark-plus', variant: 'primary', onClick: openReserve }]
  }));

  const filterHost = document.createElement('div');
  filterHost.className = 'mb-4';
  host.appendChild(filterHost);
  const listHost = document.createElement('div');
  host.appendChild(listHost);

  renderFilterBar(filterHost, {
    selects: [{
      name: 'status',
      label: t('common.status'),
      value: q.status || '',
      options: STATUSES.map((s) => ({ value: s, label: t('reservations.status' + s.charAt(0).toUpperCase() + s.slice(1)) }))
    }],
    onChange: (vals) => { Object.assign(q, vals); q.page = 1; ctx.setQuery(q); load(); }
  });

  async function load() {
    listHost.innerHTML = skeletonTable(6, 5);
    try {
      const res = await api.get('/reservations' + buildQuery({ ...q, limit: 20 }), { signal: ctx.signal });
      render(res.data);
    } catch (err) {
      listHost.innerHTML = `<div class="p-6 text-danger">${escapeHtml(err.message)}</div>`;
    }
  }

  function render(data) {
    dataTable(listHost, {
      columns: [
        { key: 'member', label: t('transactions.member'), render: (r) => r.member ? `<div class="flex items-center gap-2">${avatar({ src: r.member.photo, name: r.member.fullName, size: 'sm' })}<div><a href="#/members/${r.member._id}" class="text-primary hover:underline font-medium">${escapeHtml(r.member.fullName)}</a><p class="text-xs text-slate-400">${escapeHtml(r.member.admissionNo)}${r.member.classLevel ? ' · ' + escapeHtml(r.member.classLevel) : ''}</p></div></div>` : escapeHtml(r.memberName) },
        { key: 'book', label: t('nav.books'), render: (r) => r.book ? `<a href="#/books/${r.book._id}" class="text-primary hover:underline">${escapeHtml(r.book.title)}</a><p class="text-xs text-slate-400">${escapeHtml(r.book.isbn)}</p>` : escapeHtml(r.bookTitle) },
        { key: 'status', label: t('common.status'), render: (r) => badge(r.status) },
        { key: 'createdAt', label: t('activity.when'), render: (r) => escapeHtml(formatDate(r.createdAt)) },
        { key: 'expiresAt', label: t('reservations.holdUntil'), render: (r) => r.status === 'ready' && r.expiresAt ? `<span class="text-xs text-slate-500">${escapeHtml(formatDate(r.expiresAt))}</span>` : '<span class="text-slate-300">—</span>' }
      ],
      rows: data.items,
      page: data.page, pages: data.pages, total: data.total,
      onPage: (p) => { q.page = p; ctx.setQuery(q); load(); },
      actions: (r) => {
        const items = [];
        if (r.status === 'ready') items.push({ label: t('reservations.fulfill'), icon: 'check-circle', onClick: () => doFulfill(r) });
        if (r.status === 'waiting' || r.status === 'ready') items.push({ label: t('reservations.cancel'), icon: 'x-circle', onClick: () => doCancel(r) });
        return items;
      },
      empty: { title: t('reservations.empty') },
      stackedRender: (r) => `<div class="min-w-0">
        <div class="flex justify-between items-start gap-2">
          <div class="min-w-0"><p class="font-medium text-slate-800 dark:text-slate-100 truncate">${escapeHtml(r.member ? r.member.fullName : r.memberName)}</p>
          <p class="text-xs text-slate-400 truncate">${escapeHtml(r.book ? r.book.title : r.bookTitle)}</p></div>
          ${badge(r.status)}
        </div>
        <div class="flex justify-end mt-2" data-mobile-actions></div></div>`
    });
  }

  async function doFulfill(r) {
    const ok = await confirmDialog({ title: t('reservations.fulfill'), message: `${escapeHtml(r.member ? r.member.fullName : r.memberName)} · ${escapeHtml(r.book ? r.book.title : r.bookTitle)}`, variant: 'primary', confirmLabel: t('reservations.fulfill') });
    if (!ok) return;
    try {
      const res = await api.post(`/reservations/${r._id}/fulfill`);
      toast(res.message || t('reservations.fulfilled'), 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  }

  async function doCancel(r) {
    const ok = await confirmDialog({ title: t('reservations.cancel'), message: `${escapeHtml(r.member ? r.member.fullName : r.memberName)} · ${escapeHtml(r.book ? r.book.title : r.bookTitle)}`, variant: 'danger', confirmLabel: t('reservations.cancel') });
    if (!ok) return;
    try {
      const res = await api.post(`/reservations/${r._id}/cancel`);
      toast(res.message || t('reservations.cancelled'), 'success');
      load();
    } catch (err) { toast(err.message, 'error'); }
  }

  function openReserve() {
    let member = null;
    let book = null;
    const modalId = openModal({
      title: t('reservations.reserve'),
      size: 'md',
      body: `<div class="space-y-4">
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">${escapeHtml(t('members.admissionNo'))}</label>
          <div class="flex gap-2">
            <input id="res-adm" type="text" autocomplete="off" class="flex-1 rounded-input border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm min-h-[44px]" placeholder="${escapeHtml(t('members.admissionNo'))}" />
            <button id="res-adm-go" class="${BTN.primary}">${escapeHtml(t('common.search'))}</button>
          </div>
          <div id="res-member" class="mt-3"></div>
        </div>
        <div>
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">${escapeHtml(t('nav.books'))}</label>
          <input id="res-book-q" type="text" autocomplete="off" class="w-full rounded-input border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm min-h-[44px]" placeholder="${escapeHtml(t('common.searchPlaceholder'))}" />
          <div id="res-book-results" class="mt-2 max-h-56 overflow-y-auto space-y-1"></div>
        </div>
      </div>`,
      actions: [
        { label: t('common.cancel'), variant: 'ghost', onClick: () => closeModal(modalId) },
        { label: t('reservations.reserve'), variant: 'primary', id: 'res-submit', onClick: submit }
      ]
    });

    const root = document.getElementById(modalId);
    const admInput = root.querySelector('#res-adm');
    const memberBox = root.querySelector('#res-member');
    const bookQ = root.querySelector('#res-book-q');
    const bookResults = root.querySelector('#res-book-results');

    async function lookupMember() {
      const no = admInput.value.trim();
      if (!no) return;
      memberBox.innerHTML = `<p class="text-sm text-slate-400">${escapeHtml(t('common.loading'))}</p>`;
      try {
        const res = await api.get('/members/lookup' + buildQuery({ admissionNo: no }));
        member = res.data.member;
        memberBox.innerHTML = `<div class="flex items-center gap-3 p-3 rounded-input bg-slate-50 dark:bg-slate-700/40">
          ${avatar({ src: member.photo, name: member.fullName, size: 'md' })}
          <div><p class="font-medium text-slate-800 dark:text-slate-100">${escapeHtml(member.fullName)}</p>
          <p class="text-xs text-slate-500">${escapeHtml(member.admissionNo)}${member.classLevel ? ' · ' + escapeHtml(member.classLevel) : ''}</p></div></div>`;
      } catch (err) {
        member = null;
        memberBox.innerHTML = `<p class="text-sm text-danger">${escapeHtml(err.message)}</p>`;
      }
    }

    const searchBooks = debounce(async () => {
      const term = bookQ.value.trim();
      if (term.length < 2) { bookResults.innerHTML = ''; return; }
      try {
        const res = await api.get('/books' + buildQuery({ q: term, limit: 8 }));
        const items = res.data.items || [];
        if (!items.length) { bookResults.innerHTML = `<p class="text-sm text-slate-400 p-2">${escapeHtml(t('books.noBooks'))}</p>`; return; }
        bookResults.innerHTML = items.map((b) => `<button type="button" data-id="${b._id}" class="res-book w-full text-left px-3 py-2 rounded-input hover:bg-slate-100 dark:hover:bg-slate-700 flex justify-between items-center gap-2">
          <span class="min-w-0"><span class="block text-sm font-medium text-slate-800 dark:text-slate-100 truncate">${escapeHtml(b.title)}</span>
          <span class="block text-xs text-slate-400 truncate">${escapeHtml(b.author || '')} · ${escapeHtml(b.isbn)}</span></span>
          ${b.availableCopies > 0 ? badge('available') : badge('borrowed')}
        </button>`).join('');
        bookResults.querySelectorAll('.res-book').forEach((btn) => {
          btn.addEventListener('click', () => {
            const found = items.find((x) => x._id === btn.getAttribute('data-id'));
            book = found;
            bookResults.querySelectorAll('.res-book').forEach((b) => b.classList.remove('ring-2', 'ring-primary'));
            btn.classList.add('ring-2', 'ring-primary');
          });
        });
      } catch (err) {
        bookResults.innerHTML = `<p class="text-sm text-danger p-2">${escapeHtml(err.message)}</p>`;
      }
    }, 350);

    root.querySelector('#res-adm-go').addEventListener('click', lookupMember);
    admInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); lookupMember(); } });
    bookQ.addEventListener('input', searchBooks);

    async function submit() {
      if (!member) { toast(t('reservations.selectMember'), 'warning'); return; }
      if (!book) { toast(t('reservations.selectBook'), 'warning'); return; }
      try {
        const res = await api.post('/reservations', { bookId: book._id, memberId: member._id });
        toast(res.message || t('reservations.created'), 'success');
        closeModal(modalId);
        load();
      } catch (err) { toast(err.message, 'error'); }
    }

    setTimeout(() => admInput.focus(), 60);
  }

  await load();
  return function unmount() {};
}
