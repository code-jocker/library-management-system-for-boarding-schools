// public/js/views/overdue.js
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { escapeHtml, formatDate, formatMoney, exportCSV } from '../core/utils.js';
import { navigate } from '../core/router.js';
import { pageHeader, card, BTN } from '../components/pageHeader.js';
import { renderFilterBar } from '../components/filterBar.js';
import { dataTable } from '../components/dataTable.js';
import { skeletonTable } from '../components/skeleton.js';
import { emptyState } from '../components/emptyState.js';
import { badge } from '../components/badge.js';
import { avatar, bookCover } from '../components/avatar.js';
import { toast } from '../components/toast.js';
import { printOverdueNotice } from '../print/overdueNotice.js';
import { getState } from '../core/store.js';

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const settings = getState().settings || {};
  let allRows = [];
  let filter = { classLevel: '', stream: '', dormitory: '' };

  host.innerHTML = '';
  host.appendChild(pageHeader({
    title: t('overdue.title'),
    crumbs: ctx.defaultCrumbs,
    actions: [
      { label: t('common.exportCSV'), icon: 'download', variant: 'outline', id: 'csv', onClick: () => exportCSV('overdue.csv', filtered()) },
      { label: t('overdue.printBulk'), icon: 'printer', variant: 'primary', id: 'bulk', onClick: () => printOverdueNotice(currentLoans()) }
    ]
  }));

  const filterHost = document.createElement('div');
  filterHost.className = 'mb-4';
  host.appendChild(filterHost);
  const listHost = document.createElement('div');
  host.appendChild(listHost);

  renderFilterBar(filterHost, {
    selects: [
      { name: 'classLevel', label: t('members.classLevel'), value: '', options: (settings.classLevels || []).map((c) => ({ value: c, label: c })) },
      { name: 'stream', label: t('members.stream'), value: '', options: (settings.streams || []).map((c) => ({ value: c, label: c })) },
      { name: 'dormitory', label: t('members.dormitory'), value: '', options: (settings.dormitories || []).map((c) => ({ value: c, label: c })) }
    ],
    onChange: (vals) => { filter = vals; render(); }
  });

  function passes(l) {
    const m = l.member || {};
    if (filter.classLevel && m.classLevel !== filter.classLevel) return false;
    if (filter.stream && m.stream !== filter.stream) return false;
    if (filter.dormitory && m.dormitory !== filter.dormitory) return false;
    return true;
  }
  function currentLoans() { return allRows.filter(passes); }
  function filtered() {
    return currentLoans().map((l) => ({
      Member: l.member ? l.member.fullName : l.memberName,
      'Admission No': l.member ? l.member.admissionNo : '',
      Class: l.member ? l.member.classLevel : '',
      Book: l.book ? l.book.title : l.bookTitle,
      Due: formatDate(l.dueDate),
      'Days Late': l.daysOverdue,
      'Fine So Far': l.fineSoFar,
      'Guardian Phone': l.member ? l.member.guardianPhone : ''
    }));
  }

  async function load() {
    listHost.innerHTML = skeletonTable(8, 6);
    try {
      const res = await api.get('/transactions/overdue', { signal: ctx.signal });
      allRows = res.data.items || [];
      render();
    } catch (err) {
      listHost.innerHTML = emptyState({ title: t('common.errorTitle'), message: err.message });
    }
  }

  function render() {
    const rows = currentLoans();
    if (!rows.length) {
      listHost.innerHTML = card(emptyState({ title: t('overdue.empty'), icon: 'check-circle' }));
      if (window.lucide) window.lucide.createIcons();
      return;
    }
    dataTable(listHost, {
      columns: [
        { key: 'member', label: t('transactions.member'), render: (l) => { const m = l.member || {}; return `<div class="flex items-center gap-3">${avatar({ src: m.photo, name: m.fullName || l.memberName, size: 'sm' })}<div class="min-w-0"><a href="#/members/${m._id || ''}" class="font-medium text-slate-800 dark:text-slate-100 hover:text-primary truncate block">${escapeHtml(m.fullName || l.memberName)}</a><p class="text-xs text-slate-400">${escapeHtml(m.admissionNo || l.memberAdmissionNo || '')} · ${escapeHtml(m.classLevel || '')}</p></div></div>`; } },
        { key: 'book', label: t('transactions.book'), render: (l) => `<div class="flex items-center gap-2">${bookCover({ src: l.book && l.book.cover, title: l.bookTitle, size: 'sm' })}<span class="text-sm text-slate-700 dark:text-slate-200">${escapeHtml(l.book ? l.book.title : l.bookTitle)}</span></div>` },
        { key: 'dueDate', label: t('transactions.due'), render: (l) => escapeHtml(formatDate(l.dueDate)) },
        { key: 'days', label: t('overdue.daysLate'), render: (l) => `<span class="text-danger font-semibold">${l.daysOverdue}</span>` },
        { key: 'fine', label: t('overdue.fineSoFar'), render: (l) => `<span class="font-medium">${escapeHtml(formatMoney(l.fineSoFar))}</span>` },
        { key: 'guardian', label: t('overdue.guardian'), render: (l) => escapeHtml(l.member ? l.member.guardianPhone || '—' : '—') }
      ],
      rows,
      actions: (l) => [
        { label: t('return.returnBook'), icon: 'check', onClick: () => navigate('/return?member=' + encodeURIComponent((l.member && l.member.admissionNo) || l.memberAdmissionNo || '')) },
        { label: t('overdue.printNotice'), icon: 'printer', onClick: () => printOverdueNotice([l]) }
      ],
      empty: { title: t('overdue.empty') }
    });
  }

  await load();
  return function unmount() {};
}
