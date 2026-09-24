// public/js/views/memberProfile.js
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { escapeHtml, formatDate, formatMoney } from '../core/utils.js';
import { navigate } from '../core/router.js';
import { pageHeader, card, BTN } from '../components/pageHeader.js';
import { skeletonTable } from '../components/skeleton.js';
import { emptyState } from '../components/emptyState.js';
import { avatar, bookCover } from '../components/avatar.js';
import { badge } from '../components/badge.js';
import { dataTable } from '../components/dataTable.js';
import { renderTabs } from '../components/tabs.js';
import { printLibraryCard } from '../print/libraryCard.js';
import { printClearanceCertificate } from '../print/certificate.js';

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const id = ctx.params.id;
  host.innerHTML = '';

  const header = pageHeader({ title: t('nav.memberProfile'), crumbs: [{ label: t('nav.members'), href: '/members' }, { label: t('nav.memberProfile') }] });
  host.appendChild(header);
  const body = document.createElement('div');
  body.innerHTML = skeletonTable(5, 4);
  host.appendChild(body);

  try {
    const res = await api.get('/members/' + id, { signal: ctx.signal });
    render(body, header, res.data);
  } catch (err) {
    body.innerHTML = emptyState({ title: t('common.errorTitle'), message: err.message });
  }

  function render(container, hdr, data) {
    const { member, loans, fines, history, unpaidAmount, settings } = data;
    hdr.querySelector('h1').textContent = member.fullName;

    // Header action buttons.
    const actions = hdr.querySelector('.flex.flex-wrap.items-center.gap-2');
    if (actions) {
      actions.innerHTML = `
        <button id="print-card" class="${BTN.outline}"><i data-lucide="id-card" class="w-4 h-4"></i>${escapeHtml(t('members.printCard'))}</button>
        <button id="print-cert" class="${BTN.outline}"><i data-lucide="file-check" class="w-4 h-4"></i>${escapeHtml(t('members.clearanceCert'))}</button>
        <a href="#/issue?member=${encodeURIComponent(member.admissionNo)}" class="${BTN.primary}"><i data-lucide="log-in" class="w-4 h-4"></i>${escapeHtml(t('nav.issue'))}</a>`;
      hdr.querySelector('#print-card').addEventListener('click', () => printLibraryCard(member._id));
      hdr.querySelector('#print-cert').addEventListener('click', () => printClearanceCertificate(member._id));
      if (window.lucide) window.lucide.createIcons();
    }

    const info = [
      [t('members.admissionNo'), member.admissionNo],
      [t('members.gender'), member.gender],
      [t('members.memberType'), member.memberType === 'teacher' ? t('members.teacher') : t('members.student')],
      [t('members.classLevel'), [member.classLevel, member.stream].filter(Boolean).join(' ') || '—'],
      [t('members.dormitory'), member.dormitory || '—'],
      [t('members.phone'), member.phone || '—'],
      [t('members.guardianName'), member.guardianName || '—'],
      [t('members.guardianPhone'), member.guardianPhone || '—']
    ];

    // Activity summary computed from the member's full transaction history.
    const now = new Date();
    const totalBorrowed = history.length;
    const currentlyOut = loans.length;
    const overdueNow = loans.filter((l) => new Date(l.dueDate) < now && l.status !== 'returned').length;
    const summaryTiles = [
      { label: t('members.totalBorrowed'), value: totalBorrowed, tone: 'text-slate-800 dark:text-slate-100', icon: 'library' },
      { label: t('members.currentLoans'), value: currentlyOut, tone: 'text-primary', icon: 'book-open' },
      { label: t('dashboard.overdue'), value: overdueNow, tone: overdueNow ? 'text-danger' : 'text-success', icon: 'alert-circle' },
      { label: t('dashboard.unpaidFines'), value: formatMoney(unpaidAmount), tone: unpaidAmount > 0 ? 'text-danger' : 'text-success', icon: 'coins' }
    ];

    container.innerHTML = `
      <div class="grid lg:grid-cols-3 gap-6 mb-6">
        ${card(`<div class="flex flex-col items-center text-center">
          ${avatar({ src: member.photo, name: member.fullName, size: 'lg' })}
          <h2 class="mt-3 font-heading font-semibold text-lg text-slate-800 dark:text-slate-100">${escapeHtml(member.fullName)}</h2>
          <p class="text-sm text-slate-500 dark:text-slate-400">${escapeHtml(member.admissionNo)}</p>
          <div class="mt-2">${badge(member.status)}</div>
          ${unpaidAmount > 0 ? `<p class="mt-3 text-sm text-danger font-medium">${escapeHtml(formatMoney(unpaidAmount))} ${escapeHtml(t('fines.title').toLowerCase())}</p>` : `<p class="mt-3 text-sm text-success font-medium">No unpaid fines</p>`}
        </div>`)}
        ${card(`<h3 class="font-heading font-semibold text-slate-800 dark:text-slate-100 mb-4">${escapeHtml(member.fullName)}</h3>
          <dl class="space-y-2">
            ${info.map(([k, v]) => `<div class="flex justify-between gap-3 text-sm border-b border-slate-100 dark:border-slate-700 pb-2">
              <dt class="text-slate-500 dark:text-slate-400">${escapeHtml(k)}</dt>
              <dd class="text-slate-800 dark:text-slate-100 font-medium text-right">${escapeHtml(String(v))}</dd></div>`).join('')}
          </dl>`, { className: 'lg:col-span-2' })}
      </div>

      <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
        ${summaryTiles.map((s) => `
          <div class="rounded-card border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-4 flex items-center gap-3">
            <span class="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center flex-shrink-0">
              <i data-lucide="${s.icon}" class="w-4 h-4 text-slate-500 dark:text-slate-300"></i>
            </span>
            <div class="min-w-0">
              <p class="text-2xl font-heading font-semibold ${s.tone} truncate">${escapeHtml(String(s.value))}</p>
              <p class="text-xs text-slate-500 dark:text-slate-400 truncate">${escapeHtml(s.label)}</p>
            </div>
          </div>`).join('')}
      </div>

      <div id="tabs" class="mb-4"></div>
      <div id="tab-panel"></div>`;
    if (window.lucide) window.lucide.createIcons();

    const tabs = [
      { key: 'loans', label: t('members.currentLoans') },
      { key: 'history', label: t('members.borrowingHistory') },
      { key: 'fines', label: t('members.fines') }
    ];
    const tabsHost = container.querySelector('#tabs');
    const panel = container.querySelector('#tab-panel');
    let activeTab = 'loans';

    const drawTabs = () => renderTabs(tabsHost, { tabs, active: activeTab, onChange: (key) => { activeTab = key; drawTabs(); showTab(key); } });
    drawTabs();

    function showTab(key) {
      if (key === 'loans') {
        if (!loans.length) { panel.innerHTML = card(emptyState({ title: t('members.noLoans') })); return; }
        panel.innerHTML = `<div id="loans-table"></div>`;
        dataTable(panel.querySelector('#loans-table'), {
          columns: [
            { key: 'title', label: t('transactions.book'), render: (l) => `<div class="flex items-center gap-3">${bookCover({ src: l.book && l.book.cover, title: l.bookTitle, size: 'sm' })}<div><p class="font-medium text-slate-800 dark:text-slate-100">${escapeHtml(l.book ? l.book.title : l.bookTitle)}</p><p class="text-xs text-slate-400">${escapeHtml(l.book ? l.book.isbn : l.bookIsbn)}</p></div></div>` },
            { key: 'dueDate', label: t('transactions.due'), render: (l) => escapeHtml(formatDate(l.dueDate)) },
            { key: 'status', label: t('transactions.status'), render: (l) => badge(l.dueDate < new Date() && l.status !== 'returned' ? 'overdue' : l.status) },
            { key: 'actions', label: t('common.actions'), render: (l) => `<button data-ret="${l._id}" class="px-3 py-1.5 rounded-input bg-primary text-white text-xs font-medium hover:bg-primary-700">${escapeHtml(t('return.returnBook'))}</button>` }
          ],
          rows: loans,
          empty: { title: t('members.noLoans') }
        });
        panel.querySelectorAll('[data-ret]').forEach((b) => b.addEventListener('click', () => navigate('/return?member=' + encodeURIComponent(member.admissionNo))));
      } else if (key === 'history') {
        panel.innerHTML = `<div id="hist-table"></div>`;
        dataTable(panel.querySelector('#hist-table'), {
          columns: [
            { key: 'title', label: t('transactions.book'), render: (l) => escapeHtml(l.book ? l.book.title : l.bookTitle) },
            { key: 'issueDate', label: t('transactions.issued'), render: (l) => escapeHtml(formatDate(l.issueDate)) },
            { key: 'returnDate', label: t('transactions.returned'), render: (l) => l.returnDate ? escapeHtml(formatDate(l.returnDate)) : '—' },
            { key: 'status', label: t('transactions.status'), render: (l) => badge(l.status) }
          ],
          rows: history,
          empty: { title: t('transactions.empty') }
        });
      } else {
        panel.innerHTML = `<div id="fines-table"></div>`;
        dataTable(panel.querySelector('#fines-table'), {
          columns: [
            { key: 'receiptNo', label: t('fines.receipt'), render: (fi) => escapeHtml(fi.receiptNo) },
            { key: 'reason', label: t('fines.reason'), render: (fi) => escapeHtml(fi.reason) },
            { key: 'amount', label: t('common.amount'), render: (fi) => escapeHtml(formatMoney(fi.amount)) },
            { key: 'balance', label: t('fines.balance'), render: (fi) => escapeHtml(formatMoney(fi.amount - fi.paidAmount)) },
            { key: 'status', label: t('common.status'), render: (fi) => badge(fi.status) }
          ],
          rows: fines,
          empty: { title: t('fines.empty') }
        });
      }
      if (window.lucide) window.lucide.createIcons();
    }
    showTab('loans');
  }

  return function unmount() {};
}
