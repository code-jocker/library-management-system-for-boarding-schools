// public/js/views/dashboard.js
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { escapeHtml, formatMoney, formatDate, buildQuery } from '../core/utils.js';
import { navigate } from '../core/router.js';
import { pageHeader, card, BTN } from '../components/pageHeader.js';
import { statCard } from '../components/statCard.js';
import { skeletonTable } from '../components/skeleton.js';
import { emptyState } from '../components/emptyState.js';
import { bookCover, avatar } from '../components/avatar.js';
import { barChart, doughnutChart, destroyChart } from '../components/charts.js';
import { toast } from '../components/toast.js';
import { set } from '../core/store.js';

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  let monthlyChart = null;
  let categoryChart = null;

  host.innerHTML = '';
  host.appendChild(pageHeader({
    title: t('dashboard.title'),
    crumbs: ctx.defaultCrumbs,
    actions: [
      { label: t('nav.issue'), icon: 'log-in', variant: 'primary', id: 'qa-issue', onClick: () => navigate('/issue') },
      { label: t('nav.return'), icon: 'log-out', variant: 'secondary', id: 'qa-return', onClick: () => navigate('/return') }
    ]
  }));

  const body = document.createElement('div');
  body.innerHTML = skeletonTable(3, 4);
  host.appendChild(body);

  try {
    const res = await api.get('/dashboard', { signal: ctx.signal });
    const d = res.data;
    render(body, d);
  } catch (err) {
    body.innerHTML = emptyState({ title: t('common.errorTitle'), message: err.message });
  }

  function render(container, d) {
    const s = d.stats;
    container.innerHTML = `
      <!-- Stat cards -->
      <div class="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
        ${statCard({ label: t('dashboard.totalBooks'), value: s.totalTitles, icon: 'book-open', tone: 'primary', sub: `${s.totalCopies} copies` })}
        ${statCard({ label: t('dashboard.available'), value: s.available, icon: 'check-circle', tone: 'success' })}
        ${statCard({ label: t('dashboard.borrowed'), value: s.borrowed, icon: 'bookmark', tone: 'info' })}
        ${statCard({ label: t('dashboard.overdue'), value: s.overdue, icon: 'alert-triangle', tone: 'danger' })}
        ${statCard({ label: t('dashboard.totalMembers'), value: s.totalMembers, icon: 'users', tone: 'primary' })}
        ${statCard({ label: t('dashboard.unpaidFines'), value: formatMoney(s.unpaidFines), icon: 'badge-dollar-sign', tone: 'warning' })}
      </div>

      <div class="grid lg:grid-cols-3 gap-6 mb-6">
        <!-- Monthly chart -->
        ${card(`<h3 class="font-heading font-semibold text-slate-800 dark:text-slate-100 mb-4">${escapeHtml(t('dashboard.borrowPerMonth'))}</h3>
          <div class="h-64"><canvas id="monthly-chart"></canvas></div>`, { className: 'lg:col-span-2' })}
        <!-- Category chart -->
        ${card(`<h3 class="font-heading font-semibold text-slate-800 dark:text-slate-100 mb-4">${escapeHtml(t('dashboard.byCategory'))}</h3>
          <div class="h-64"><canvas id="category-chart"></canvas></div>`)}
      </div>

      <div class="grid lg:grid-cols-3 gap-6">
        <!-- Most borrowed -->
        ${card(`<h3 class="font-heading font-semibold text-slate-800 dark:text-slate-100 mb-4">${escapeHtml(t('dashboard.mostBorrowed'))}</h3>
          <div id="top-books" class="space-y-3"></div>`)}
        <!-- Due today -->
        ${card(`<h3 class="font-heading font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2"><i data-lucide="clock" class="w-4 h-4 text-warning"></i>${escapeHtml(t('dashboard.dueToday'))}</h3>
          <div id="due-today" class="space-y-2 max-h-80 overflow-y-auto scroll-slim"></div>`)}
        <!-- Overdue -->
        ${card(`<h3 class="font-heading font-semibold text-slate-800 dark:text-slate-100 mb-4 flex items-center gap-2"><i data-lucide="alert-triangle" class="w-4 h-4 text-danger"></i>${escapeHtml(t('dashboard.overdueList'))}</h3>
          <div id="overdue-list" class="space-y-2 max-h-80 overflow-y-auto scroll-slim"></div>`)}
      </div>`;
    if (window.lucide) window.lucide.createIcons();

    // Charts.
    monthlyChart = barChart(container.querySelector('#monthly-chart'), d.monthly.map((m) => m.label), d.monthly.map((m) => m.count), t('dashboard.borrowed'));
    categoryChart = doughnutChart(container.querySelector('#category-chart'), d.byCategory.map((c) => c.name), d.byCategory.map((c) => c.copies), d.byCategory.map((c) => c.color));

    // Most borrowed.
    const topEl = container.querySelector('#top-books');
    topEl.innerHTML = d.topBooks.length ? d.topBooks.map((b, i) => `
      <a href="#/books/${b.bookId}" class="flex items-center gap-3 p-2 rounded-input hover:bg-slate-50 dark:hover:bg-slate-700/50">
        <span class="text-slate-300 font-bold text-lg w-5 text-center">${i + 1}</span>
        ${bookCover({ src: b.cover, title: b.title, size: 'sm' })}
        <div class="min-w-0 flex-1"><p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">${escapeHtml(b.title)}</p>
        <p class="text-xs text-slate-400">${escapeHtml(b.count + ' ' + t('dashboard.borrowed').toLowerCase())}</p></div>
      </a>`).join('') : emptyState({ title: t('common.noData') });

    // Due today + overdue with one-click Return.
    renderLoanList(container.querySelector('#due-today'), d.dueToday, t('dashboard.noDueToday'), false);
    renderLoanList(container.querySelector('#overdue-list'), d.overdueList, t('dashboard.noOverdue'), true);
    if (window.lucide) window.lucide.createIcons();

    // Wire Return buttons.
    container.querySelectorAll('[data-return-txn]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        try {
          const r = await api.post('/transactions/return', { transactionId: btn.getAttribute('data-return-txn') });
          toast(r.message || t('return.returned'), 'success');
          set({ overdueCount: Math.max(0, (d.overdueList.length || 0) - 1) });
          navigate('/dashboard', { replace: true });
        } catch (e) { toast(e.message, 'error'); btn.disabled = false; }
      });
    });

    set({ overdueCount: d.stats.overdue });
  }

  function renderLoanList(el, items, emptyMsg, showFine) {
    if (!items.length) { el.innerHTML = `<p class="text-sm text-slate-400 text-center py-6">${escapeHtml(emptyMsg)}</p>`; return; }
    el.innerHTML = items.map((l) => `
      <div class="flex items-center gap-3 p-2 rounded-input border border-slate-100 dark:border-slate-700">
        ${bookCover({ src: l.book && l.book.cover, title: l.bookTitle, size: 'sm' })}
        <div class="min-w-0 flex-1">
          <p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">${escapeHtml(l.book ? l.book.title : l.bookTitle)}</p>
          <p class="text-xs text-slate-400 truncate">${escapeHtml(l.member ? l.member.fullName : l.memberName)} · ${escapeHtml(formatDate(l.dueDate))}</p>
          ${showFine ? `<p class="text-xs text-danger font-medium">${escapeHtml(l.daysOverdue + ' ' + t('overdue.daysLate').toLowerCase() + ' · ' + formatMoney(l.fineSoFar))}</p>` : ''}
        </div>
        <button data-return-txn="${l._id}" class="shrink-0 px-3 py-2 rounded-input bg-primary text-white text-xs font-medium hover:bg-primary-700 min-h-[40px]" title="${escapeHtml(t('dashboard.returnNow'))}">
          ${escapeHtml(t('dashboard.returnNow'))}
        </button>
      </div>`).join('');
  }

  return function unmount() {
    destroyChart(monthlyChart);
    destroyChart(categoryChart);
  };
}
