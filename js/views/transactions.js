// public/js/views/transactions.js
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getState } from '../core/store.js';
import { escapeHtml, formatDate, buildQuery, exportCSV } from '../core/utils.js';
import { navigate } from '../core/router.js';
import { pageHeader, BTN } from '../components/pageHeader.js';
import { renderFilterBar } from '../components/filterBar.js';
import { dataTable } from '../components/dataTable.js';
import { skeletonTable } from '../components/skeleton.js';
import { badge } from '../components/badge.js';
import { bookCover } from '../components/avatar.js';

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const q = { ...ctx.query };
  const settings = getState().settings || {};

  host.innerHTML = '';
  host.appendChild(pageHeader({
    title: t('transactions.title'),
    crumbs: ctx.defaultCrumbs,
    actions: [{ label: t('common.exportCSV'), icon: 'download', variant: 'outline', id: 'csv', onClick: exportCsv }]
  }));

  const filterHost = document.createElement('div');
  filterHost.className = 'mb-4';
  host.appendChild(filterHost);
  const listHost = document.createElement('div');
  host.appendChild(listHost);

  renderFilterBar(filterHost, {
    search: { placeholder: t('common.searchPlaceholder'), value: q.q || '' },
    selects: [
      { name: 'status', label: t('transactions.status'), value: q.status || '', options: ['borrowed', 'returned', 'overdue', 'lost', 'damaged'].map((s) => ({ value: s, label: t('status.' + s) })) }
    ],
    extraHtml: `
      <div><label for="f-from" class="sr-only">${escapeHtml(t('reports.from'))}</label>
        <input id="f-from" type="date" value="${escapeHtml(q.from || '')}" class="rounded-input border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm min-h-[44px]" title="${escapeHtml(t('reports.from'))}" /></div>
      <div><label for="f-to" class="sr-only">${escapeHtml(t('reports.to'))}</label>
        <input id="f-to" type="date" value="${escapeHtml(q.to || '')}" class="rounded-input border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm min-h-[44px]" title="${escapeHtml(t('reports.to'))}" /></div>`,
    onChange: (vals) => { Object.assign(q, vals); q.page = 1; ctx.setQuery(q); load(); }
  });
  filterHost.querySelector('#f-from').addEventListener('change', (e) => { q.from = e.target.value; q.page = 1; ctx.setQuery(q); load(); });
  filterHost.querySelector('#f-to').addEventListener('change', (e) => { q.to = e.target.value; q.page = 1; ctx.setQuery(q); load(); });

  async function load() {
    listHost.innerHTML = skeletonTable(10, 6);
    try {
      const res = await api.get('/transactions' + buildQuery({ ...q, limit: 20 }), { signal: ctx.signal });
      render(res.data);
    } catch (err) {
      listHost.innerHTML = `<div class="p-6 text-danger">${escapeHtml(err.message)}</div>`;
    }
  }

  function render(data) {
    dataTable(listHost, {
      columns: [
        { key: 'book', label: t('transactions.book'), render: (l) => `<div class="flex items-center gap-2">${bookCover({ src: l.book && l.book.cover, title: l.bookTitle, size: 'sm' })}<div class="min-w-0"><p class="font-medium text-slate-800 dark:text-slate-100 truncate">${escapeHtml(l.book ? l.book.title : l.bookTitle)}</p><p class="text-xs text-slate-400">${escapeHtml(l.book ? l.book.isbn : l.bookIsbn)}</p></div></div>` },
        { key: 'member', label: t('transactions.member'), render: (l) => l.member ? `<a href="#/members/${l.member._id}" class="text-primary hover:underline">${escapeHtml(l.member.fullName)}</a><p class="text-xs text-slate-400">${escapeHtml(l.member.admissionNo)}</p>` : escapeHtml(l.memberName) },
        { key: 'class', label: t('members.classLevel'), render: (l) => escapeHtml(l.member ? l.member.classLevel || '—' : '—') },
        { key: 'issueDate', label: t('transactions.issued'), render: (l) => escapeHtml(formatDate(l.issueDate)) },
        { key: 'dueDate', label: t('transactions.due'), render: (l) => escapeHtml(formatDate(l.dueDate)) },
        { key: 'returnDate', label: t('transactions.returned'), render: (l) => l.returnDate ? escapeHtml(formatDate(l.returnDate)) : '<span class="text-slate-400">—</span>' },
        { key: 'status', label: t('transactions.status'), sortable: false, render: (l) => badge(l.status) }
      ],
      rows: data.items,
      page: data.page, pages: data.pages, total: data.total,
      onPage: (p) => { q.page = p; ctx.setQuery(q); load(); },
      actions: (l) => [
        ...(l.member ? [{ label: t('common.view'), icon: 'user', onClick: () => navigate('/members/' + l.member._id) }] : []),
        ...(l.book ? [{ label: t('nav.bookDetails'), icon: 'book-open', onClick: () => navigate('/books/' + l.book._id) }] : [])
      ],
      empty: { title: t('transactions.empty') },
      stackedRender: (l) => `<div class="flex items-center gap-3">${bookCover({ src: l.book && l.book.cover, title: l.bookTitle, size: 'md' })}
        <div class="min-w-0 flex-1"><p class="font-medium text-slate-800 dark:text-slate-100 truncate">${escapeHtml(l.book ? l.book.title : l.bookTitle)}</p>
        <p class="text-xs text-slate-400">${escapeHtml(l.member ? l.member.fullName : l.memberName)}</p>
        <p class="text-xs text-slate-400">${escapeHtml(formatDate(l.issueDate))} → ${escapeHtml(formatDate(l.dueDate))}</p>
        <div class="mt-1">${badge(l.status)}</div></div><div data-mobile-actions></div></div>`
    });
  }

  async function exportCsv() {
    try {
      const res = await api.get('/transactions' + buildQuery({ ...q, limit: 2000 }), { signal: ctx.signal });
      const rows = (res.data.items || []).map((l) => ({
        Book: l.book ? l.book.title : l.bookTitle,
        ISBN: l.book ? l.book.isbn : l.bookIsbn,
        Member: l.member ? l.member.fullName : l.memberName,
        'Admission No': l.member ? l.member.admissionNo : l.memberAdmissionNo,
        Class: l.member ? l.member.classLevel : '',
        Issued: formatDate(l.issueDate),
        Due: formatDate(l.dueDate),
        Returned: l.returnDate ? formatDate(l.returnDate) : '',
        Status: l.status
      }));
      exportCSV('transactions.csv', rows);
    } catch (err) { /* toast handled by api layer */ }
  }

  await load();
  return function unmount() {};
}
