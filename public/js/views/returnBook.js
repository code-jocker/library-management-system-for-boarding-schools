// public/js/views/returnBook.js
// Return desk without a scanner: search the student by name or admission number,
// see every book they currently have out, and process each return in place.
// Renew / Mark lost / Mark damaged are available per loan. Fines and reservation
// holds are surfaced automatically from the API response.
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getState, set } from '../core/store.js';
import { escapeHtml, formatDate, formatMoney } from '../core/utils.js';
import { pageHeader, card, BTN } from '../components/pageHeader.js';
import { avatar, bookCover } from '../components/avatar.js';
import { toast } from '../components/toast.js';
import { confirmDialog } from '../components/confirm.js';

const inputCls = 'w-full rounded-input border-2 border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-4 py-3 text-base min-h-[52px] focus:border-primary focus:ring-2 focus:ring-primary/20';

function debounce(fn, ms = 300) {
  let id;
  return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const settings = getState().settings || {};
  let currentMember = null;

  host.innerHTML = '';
  host.appendChild(pageHeader({ title: t('return.title'), crumbs: ctx.defaultCrumbs }));

  const wrap = document.createElement('div');
  wrap.innerHTML = `
    ${card(`<label for="member-search" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">${escapeHtml(t('return.findStudent'))}</label>
      <div class="relative">
        <i data-lucide="user-search" class="w-5 h-5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
        <input id="member-search" class="${inputCls} pl-11" autocomplete="off" placeholder="${escapeHtml(t('return.studentPlaceholder'))}" />
      </div>
      <div id="member-results" class="mt-3 max-h-64 overflow-auto scroll-slim space-y-2"></div>`)}
    <div id="loans-panel" class="mt-6"></div>`;
  host.appendChild(wrap);
  if (window.lucide) window.lucide.createIcons();

  const searchInput = wrap.querySelector('#member-search');
  const resultsEl = wrap.querySelector('#member-results');
  const panel = wrap.querySelector('#loans-panel');

  // ---- Student search ----
  async function searchMembers(term) {
    const q = term.trim();
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }
    resultsEl.innerHTML = `<p class="text-sm text-slate-400 py-2">${escapeHtml(t('common.loading'))}</p>`;
    try {
      const res = await api.get('/members?q=' + encodeURIComponent(q) + '&limit=10', { signal: ctx.signal });
      const items = res.data.items || [];
      if (!items.length) {
        resultsEl.innerHTML = `<p class="text-sm text-slate-400 py-2">${escapeHtml(t('members.noMembers'))}</p>`;
        return;
      }
      resultsEl.innerHTML = items.map((m) => `
        <button data-id="${escapeHtml(m._id)}" class="w-full text-left flex items-center gap-3 p-2 rounded-input border border-slate-200 dark:border-slate-600 hover:border-primary hover:bg-primary-50/40 dark:hover:bg-slate-700/40 transition">
          ${avatar({ src: m.photo, name: m.fullName, size: 'sm' })}
          <div class="min-w-0 flex-1">
            <p class="font-medium text-slate-800 dark:text-slate-100 truncate">${escapeHtml(m.fullName)}</p>
            <p class="text-xs text-slate-400 truncate">${escapeHtml(m.admissionNo)} · ${escapeHtml([m.classLevel, m.stream].filter(Boolean).join(' '))}</p>
          </div>
        </button>`).join('');
      if (window.lucide) window.lucide.createIcons();
      resultsEl.querySelectorAll('[data-id]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const found = items.find((x) => x._id === btn.getAttribute('data-id'));
          if (found) selectMember(found);
        });
      });
    } catch (err) {
      if (err.name !== 'AbortError') resultsEl.innerHTML = `<p class="text-sm text-danger py-2">${escapeHtml(err.message)}</p>`;
    }
  }

  async function selectMember(m) {
    currentMember = m;
    resultsEl.innerHTML = '';
    searchInput.value = '';
    panel.innerHTML = `<p class="text-sm text-slate-400 py-4 text-center">${escapeHtml(t('common.loading'))}</p>`;
    try {
      const res = await api.get('/transactions?memberId=' + encodeURIComponent(m._id) + '&limit=50', { signal: ctx.signal });
      const open = (res.data.items || []).filter((x) => ['borrowed', 'overdue'].includes(x.status));
      renderLoans(m, open);
    } catch (err) {
      panel.innerHTML = `<p class="text-sm text-danger py-4 text-center">${escapeHtml(err.message)}</p>`;
    }
  }

  function renderLoans(member, loans) {
    if (!loans.length) {
      panel.innerHTML = card(`<div class="text-center py-8 text-slate-400">
          <i data-lucide="check-circle" class="w-10 h-10 mx-auto mb-2 text-success opacity-70"></i>
          <p class="font-medium text-slate-600 dark:text-slate-300">${escapeHtml(member.fullName)}</p>
          <p class="text-sm">${escapeHtml(t('return.noOpenLoans'))}</p>
        </div>`);
      if (window.lucide) window.lucide.createIcons();
      return;
    }

    panel.innerHTML = `
      <div class="flex items-center gap-3 mb-3">
        ${avatar({ src: member.photo, name: member.fullName, size: 'md' })}
        <div class="min-w-0">
          <a href="#/members/${escapeHtml(member._id)}" class="font-heading font-semibold text-slate-800 dark:text-slate-100 hover:text-primary inline-flex items-center gap-1.5">${escapeHtml(member.fullName)}<i data-lucide="external-link" class="w-4 h-4 text-slate-400"></i></a>
          <p class="text-xs text-slate-400">${escapeHtml(member.admissionNo)} · ${escapeHtml([member.classLevel, member.stream].filter(Boolean).join(' '))}</p>
        </div>
        <span class="ml-auto text-sm text-slate-500 flex-shrink-0">${escapeHtml(t('return.openLoans', { n: loans.length }))}</span>
      </div>
      <div class="space-y-4">
        ${loans.map((loan) => loanCard(loan)).join('')}
      </div>`;
    if (window.lucide) window.lucide.createIcons();

    loans.forEach((loan) => {
      const el = panel.querySelector(`[data-loan="${loan._id}"]`);
      if (!el) return;
      el.querySelector('[data-act="return"]').addEventListener('click', () => doReturn(loan, el));
      const renew = el.querySelector('[data-act="renew"]');
      if (renew) renew.addEventListener('click', () => doRenew(loan));
      el.querySelector('[data-act="lost"]').addEventListener('click', () => doLost(loan));
      el.querySelector('[data-act="damaged"]').addEventListener('click', () => doDamaged(loan));
    });
  }

  function loanCard(loan) {
    const book = loan.book || {};
    const isOverdue = new Date(loan.dueDate) < new Date();
    const days = isOverdue ? Math.floor((new Date() - new Date(loan.dueDate)) / 86400000) : 0;
    const fine = days * (settings.finePerDay || 0);
    const canRenew = (loan.renewCount || 0) < 2 && !isOverdue;
    const inner = `
      <div class="flex flex-col sm:flex-row gap-5">
        <div class="flex items-center gap-4 flex-1 min-w-0">
          ${bookCover({ src: book.cover, title: book.title || loan.bookTitle, size: 'lg' })}
          <div class="min-w-0">
            <p class="font-heading font-semibold text-lg text-slate-800 dark:text-slate-100 truncate">${escapeHtml(book.title || loan.bookTitle)}</p>
            <p class="text-sm text-slate-500 dark:text-slate-400">${escapeHtml(book.isbn || loan.bookIsbn || '')}</p>
            <p class="text-xs mt-1 ${isOverdue ? 'text-danger font-medium' : 'text-slate-400'}">${isOverdue ? escapeHtml(t('return.daysLate', { n: days })) : escapeHtml(t('transactions.due') + ' ' + formatDate(loan.dueDate))}</p>
          </div>
        </div>
        <div class="sm:w-52 space-y-2 text-sm">
          <div class="flex justify-between"><span class="text-slate-500">${escapeHtml(t('transactions.issued'))}</span><span class="font-medium">${escapeHtml(formatDate(loan.issueDate))}</span></div>
          <div class="flex justify-between"><span class="text-slate-500">${escapeHtml(t('transactions.due'))}</span><span class="font-medium">${escapeHtml(formatDate(loan.dueDate))}</span></div>
          <div class="flex justify-between pt-2 border-t border-slate-200 dark:border-slate-700">
            <span class="text-slate-500">${escapeHtml(t('return.fine'))}</span>
            <span class="font-semibold ${fine > 0 ? 'text-danger' : 'text-success'}">${fine > 0 ? escapeHtml(formatMoney(fine)) : escapeHtml(t('return.noFine'))}</span>
          </div>
        </div>
      </div>
      <div class="mt-5 flex flex-wrap gap-2">
        <button data-act="return" class="${BTN.primary}"><i data-lucide="check" class="w-4 h-4"></i>${escapeHtml(t('return.returnBook'))}</button>
        <button data-act="renew" class="${BTN.outline}" ${canRenew ? '' : 'disabled'}><i data-lucide="refresh-cw" class="w-4 h-4"></i>${escapeHtml(t('return.renew'))}</button>
        <button data-act="lost" class="${BTN.outline} text-danger"><i data-lucide="x-circle" class="w-4 h-4"></i>${escapeHtml(t('return.markLost'))}</button>
        <button data-act="damaged" class="${BTN.outline} text-warning"><i data-lucide="alert-triangle" class="w-4 h-4"></i>${escapeHtml(t('return.markDamaged'))}</button>
      </div>
      <div data-reservation class="hidden mt-4 p-3 rounded-input bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-300 text-sm text-yellow-800 dark:text-yellow-200 flex items-center gap-2">
        <i data-lucide="bookmark" class="w-4 h-4"></i><span></span>
      </div>`;
    return `<div data-loan="${escapeHtml(loan._id)}">${card(inner)}</div>`;
  }

  // ---- Actions ----
  async function doReturn(loan, el) {
    const btn = el.querySelector('[data-act="return"]');
    btn.disabled = true;
    try {
      const res = await api.post('/transactions/return', { transactionId: loan._id, condition: 'good' });
      toast(res.message || t('return.returned'), 'success');
      if (res.data.fine) toast(t('return.fine') + ': ' + formatMoney(res.data.fineAmount), 'warning');
      if (res.data.reservationAlert) {
        const alert = el.querySelector('[data-reservation]');
        alert.classList.remove('hidden');
        alert.querySelector('span').textContent = t('return.reservedAlert', { name: res.data.reservationAlert.memberName });
        if (window.lucide) window.lucide.createIcons();
      }
      set({ overdueCount: Math.max(0, getState().overdueCount - 1) });
      // Refresh the member's remaining loans after a short pause.
      setTimeout(() => selectMember(currentMember), res.data.reservationAlert ? 2500 : 500);
    } catch (err) { toast(err.message, 'error'); btn.disabled = false; }
  }

  async function doRenew(loan) {
    try {
      const res = await api.post('/transactions/renew', { transactionId: loan._id });
      toast(res.message || t('return.renewed'), 'success');
      selectMember(currentMember);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function doLost(loan) {
    const ok = await confirmDialog({ title: t('return.markLost'), message: t('common.confirmDelete'), confirmLabel: t('common.confirm'), variant: 'danger' });
    if (!ok) return;
    try {
      const res = await api.post('/transactions/mark-lost', { transactionId: loan._id });
      toast(res.message || t('return.markLost'), 'warning');
      if (res.data.fine) toast(t('return.fine') + ': ' + formatMoney(res.data.fineAmount), 'error');
      selectMember(currentMember);
    } catch (err) { toast(err.message, 'error'); }
  }

  async function doDamaged(loan) {
    const ok = await confirmDialog({ title: t('return.markDamaged'), message: t('common.confirmDelete'), confirmLabel: t('common.confirm'), variant: 'danger' });
    if (!ok) return;
    try {
      const res = await api.post('/transactions/mark-damaged', { transactionId: loan._id });
      toast(res.message || t('return.markDamaged'), 'warning');
      selectMember(currentMember);
    } catch (err) { toast(err.message, 'error'); }
  }

  searchInput.addEventListener('input', debounce((e) => searchMembers(e.target.value), 300));
  searchInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); searchMembers(searchInput.value); } });

  searchInput.focus();

  // Support arriving with ?member=<admissionNo|id> to auto-load that student.
  if (ctx.query.member) {
    try {
      const val = ctx.query.member;
      const res = /^[a-f\d]{24}$/i.test(val)
        ? await api.get('/members/' + val, { signal: ctx.signal })
        : await api.get('/members/lookup?admissionNo=' + encodeURIComponent(val), { signal: ctx.signal });
      if (res.data && res.data.member) selectMember(res.data.member);
    } catch { /* ignore; the librarian can search manually */ }
  }

  return function unmount() {};
}
