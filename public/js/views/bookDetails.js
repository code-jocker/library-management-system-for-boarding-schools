// public/js/views/bookDetails.js
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { escapeHtml, formatDate } from '../core/utils.js';
import { navigate } from '../core/router.js';
import { pageHeader, card, BTN } from '../components/pageHeader.js';
import { skeletonTable } from '../components/skeleton.js';
import { emptyState } from '../components/emptyState.js';
import { bookCover } from '../components/avatar.js';
import { badge } from '../components/badge.js';
import { dataTable } from '../components/dataTable.js';

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const id = ctx.params.id;
  host.innerHTML = '';

  const header = pageHeader({ title: t('nav.bookDetails'), crumbs: [{ label: t('nav.books'), href: '/books' }, { label: t('nav.bookDetails') }] });
  host.appendChild(header);
  const body = document.createElement('div');
  body.innerHTML = skeletonTable(4, 4);
  host.appendChild(body);

  try {
    const res = await api.get('/books/' + id, { signal: ctx.signal });
    const { book, loans, reservationCount } = res.data;
    header.querySelector('h1').textContent = book.title;
    render(body, book, loans, reservationCount);
  } catch (err) {
    body.innerHTML = emptyState({ title: t('common.errorTitle'), message: err.message });
  }

  function render(container, book, loans, reservationCount) {
    const rows = [
      [t('books.author'), book.author],
      [t('books.isbn'), book.isbn],
      [t('books.category'), book.category ? book.category.name : '—'],
      [t('books.publisher'), book.publisher || '—'],
      [t('books.year'), book.year || '—'],
      [t('books.edition'), book.edition || '—'],
      [t('books.language'), book.language || '—'],
      [t('books.shelfLocation'), book.shelfLocation || '—'],
      [t('books.replacementValue'), book.replacementValue ? String(book.replacementValue) : '—']
    ];
    container.innerHTML = `
      <div class="grid lg:grid-cols-3 gap-6">
        ${card(`<div class="flex flex-col items-center text-center">
          ${bookCover({ src: book.cover, title: book.title, size: 'lg' })}
          <div class="mt-4">${book.availableCopies > 0 ? badge('available') : badge('borrowed')}</div>
          <p class="mt-2 text-sm text-slate-600 dark:text-slate-300">${escapeHtml(t('books.copiesAvailable', { n: book.availableCopies, t: book.totalCopies }))}</p>
          ${reservationCount ? `<p class="mt-1 text-xs text-secondary font-medium">${reservationCount} ${escapeHtml(t('nav.reservations').toLowerCase())}</p>` : ''}
          <div class="mt-4 w-full space-y-2">
            <a href="#/issue?book=${book._id}" class="${BTN.primary} w-full justify-center"><i data-lucide="log-in" class="w-4 h-4"></i>${escapeHtml(t('nav.issue'))}</a>
          </div>
        </div>`)}
        ${card(`<h2 class="font-heading font-semibold text-slate-800 dark:text-slate-100 mb-4">${escapeHtml(book.title)}</h2>
          <dl class="space-y-2">
            ${rows.map(([k, v]) => `<div class="flex justify-between gap-3 text-sm border-b border-slate-100 dark:border-slate-700 pb-2">
              <dt class="text-slate-500 dark:text-slate-400">${escapeHtml(k)}</dt>
              <dd class="text-slate-800 dark:text-slate-100 font-medium text-right">${escapeHtml(String(v))}</dd></div>`).join('')}
          </dl>
          ${book.description ? `<p class="mt-4 text-sm text-slate-600 dark:text-slate-300">${escapeHtml(book.description)}</p>` : ''}`, { className: 'lg:col-span-2' })}
      </div>

      <div class="mt-6">
        <h3 class="font-heading font-semibold text-slate-800 dark:text-slate-100 mb-3">${escapeHtml(t('books.loanHistory'))}</h3>
        <div id="history"></div>
      </div>`;
    if (window.lucide) window.lucide.createIcons();

    dataTable(container.querySelector('#history'), {
      columns: [
        { key: 'memberName', label: t('transactions.member'), render: (l) => l.member ? `<a href="#/members/${l.member._id}" class="text-primary hover:underline">${escapeHtml(l.member.fullName)}</a>` : escapeHtml(l.memberName) },
        { key: 'issueDate', label: t('transactions.issued'), render: (l) => escapeHtml(formatDate(l.issueDate)) },
        { key: 'dueDate', label: t('transactions.due'), render: (l) => escapeHtml(formatDate(l.dueDate)) },
        { key: 'returnDate', label: t('transactions.returned'), render: (l) => l.returnDate ? escapeHtml(formatDate(l.returnDate)) : '<span class="text-slate-400">—</span>' },
        { key: 'status', label: t('transactions.status'), render: (l) => badge(l.status) }
      ],
      rows: loans,
      empty: { title: t('transactions.empty') }
    });
  }

  return function unmount() {};
}
