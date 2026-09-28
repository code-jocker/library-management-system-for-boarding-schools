// public/js/views/fines.js
import { api, invalidateCache } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getState } from '../core/store.js';
import { escapeHtml, formatDate, formatMoney, buildQuery } from '../core/utils.js';
import { navigate } from '../core/router.js';
import { pageHeader, BTN } from '../components/pageHeader.js';
import { renderFilterBar } from '../components/filterBar.js';
import { dataTable } from '../components/dataTable.js';
import { skeletonTable } from '../components/skeleton.js';
import { badge } from '../components/badge.js';
import { openModal, closeModal } from '../components/modal.js';
import { confirmDialog } from '../components/confirm.js';
import { formField, readForm, applyFieldErrors, clearErrors } from '../components/formField.js';
import { toast } from '../components/toast.js';
import { printFineReceipt } from '../print/receipt.js';

const f = formField;

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const q = { ...ctx.query };
  const settings = getState().settings || {};

  host.innerHTML = '';
  host.appendChild(pageHeader({ title: t('fines.title'), crumbs: ctx.defaultCrumbs }));

  const filterHost = document.createElement('div');
  filterHost.className = 'mb-4';
  host.appendChild(filterHost);
  const listHost = document.createElement('div');
  host.appendChild(listHost);

  renderFilterBar(filterHost, {
    search: { placeholder: t('common.searchPlaceholder'), value: q.q || '' },
    selects: [
      { name: 'status', label: t('common.status'), value: q.status || '', options: ['unpaid', 'partial', 'paid', 'waived'].map((s) => ({ value: s, label: t('fines.status' + s.charAt(0).toUpperCase() + s.slice(1)) })) }
    ],
    onChange: (vals) => { Object.assign(q, vals); q.page = 1; ctx.setQuery(q); load(); }
  });

  async function load() {
    listHost.innerHTML = skeletonTable(8, 6);
    try {
      const res = await api.get('/fines' + buildQuery({ ...q, limit: 20 }), { signal: ctx.signal });
      render(res.data);
    } catch (err) {
      listHost.innerHTML = `<div class="p-6 text-danger">${escapeHtml(err.message)}</div>`;
    }
  }

  function render(data) {
    dataTable(listHost, {
      columns: [
        { key: 'receiptNo', label: t('fines.receipt'), render: (fi) => `<span class="font-mono text-xs text-slate-500">${escapeHtml(fi.receiptNo)}</span>` },
        { key: 'member', label: t('transactions.member'), render: (fi) => fi.member ? `<a href="#/members/${fi.member._id}" class="text-primary hover:underline">${escapeHtml(fi.member.fullName)}</a><p class="text-xs text-slate-400">${escapeHtml(fi.member.admissionNo)}</p>` : escapeHtml(fi.memberName) },
        { key: 'reason', label: t('fines.reason'), render: (fi) => escapeHtml(fi.reason) },
        { key: 'amount', label: t('common.amount'), render: (fi) => escapeHtml(formatMoney(fi.amount)) },
        { key: 'balance', label: t('fines.balance'), render: (fi) => { const bal = fi.amount - fi.paidAmount; return `<span class="${bal > 0 ? 'text-danger font-semibold' : 'text-success'}">${escapeHtml(formatMoney(bal))}</span>`; } },
        { key: 'status', label: t('common.status'), render: (fi) => badge(fi.status) }
      ],
      rows: data.items,
      page: data.page, pages: data.pages, total: data.total,
      onPage: (p) => { q.page = p; ctx.setQuery(q); load(); },
      actions: (fi) => {
        const items = [];
        if (fi.status === 'unpaid' || fi.status === 'partial') items.push({ label: t('fines.pay'), icon: 'banknote', onClick: () => openPay(fi) });
        if (fi.status !== 'paid' && fi.status !== 'waived') items.push({ label: t('fines.waive'), icon: 'slash', onClick: () => openWaive(fi) });
        items.push({ label: t('fines.printReceipt'), icon: 'printer', onClick: () => printFineReceipt(fi._id) });
        return items;
      },
      empty: { title: t('fines.empty') },
      stackedRender: (fi) => `<div class="min-w-0">
        <div class="flex justify-between"><span class="font-mono text-xs text-slate-400">${escapeHtml(fi.receiptNo)}</span>${badge(fi.status)}</div>
        <p class="font-medium text-slate-800 dark:text-slate-100 mt-1">${escapeHtml(fi.member ? fi.member.fullName : fi.memberName)}</p>
        <p class="text-xs text-slate-400">${escapeHtml(fi.reason)} · ${escapeHtml(formatMoney(fi.amount))}</p>
        <div class="flex justify-end mt-2" data-mobile-actions></div></div>`
    });
  }

  function openPay(fine) {
    const balance = fine.amount - fine.paidAmount;
    const modalId = openModal({
      title: t('fines.pay'),
      size: 'sm',
      body: `<div class="mb-4 p-3 rounded-input bg-slate-50 dark:bg-slate-700/40 text-sm">
          <div class="flex justify-between"><span class="text-slate-500">${escapeHtml(t('common.amount'))}</span><span class="font-medium">${escapeHtml(formatMoney(fine.amount))}</span></div>
          <div class="flex justify-between"><span class="text-slate-500">${escapeHtml(t('fines.balance'))}</span><span class="font-semibold text-danger">${escapeHtml(formatMoney(balance))}</span></div>
        </div>
        <form id="pay-form" novalidate>
          ${f.text({ name: 'amount', label: t('fines.payAmount'), value: balance, type: 'number', min: 1, max: balance, required: true })}
          <div class="mt-3">${f.select({ name: 'method', label: t('fines.method'), value: 'cash', options: [{ value: 'cash', label: t('fines.cash') }, { value: 'mobile-money', label: t('fines.mobileMoney') }, { value: 'bank', label: t('fines.bank') }, { value: 'other', label: t('fines.otherMethod') }] })}</div>
          <div class="mt-3">${f.textarea({ name: 'note', label: t('common.notes'), rows: 2 })}</div>
        </form>`,
      actions: [
        { label: t('common.cancel'), variant: 'ghost', onClick: () => closeModal(modalId) },
        { label: t('common.save'), variant: 'primary', onClick: submit }
      ]
    });
    const root = document.getElementById(modalId);
    const form = root.querySelector('#pay-form');
    async function submit() {
      clearErrors(form);
      const data = readForm(form);
      try {
        const res = await api.post('/fines/pay', { fineId: fine._id, amount: Number(data.amount), method: data.method, note: data.note });
        toast(res.message || t('fines.partial'), 'success');
        closeModal(modalId);
        load();
      } catch (err) {
        if (err.fieldErrors) applyFieldErrors(form, err.fieldErrors);
        else toast(err.message, 'error');
      }
    }
  }

  function openWaive(fine) {
    const modalId = openModal({
      title: t('fines.waive'),
      size: 'sm',
      body: `<form id="waive-form" novalidate>
        <p class="text-sm text-slate-600 dark:text-slate-300 mb-3">${escapeHtml(formatMoney(fine.amount))} · ${escapeHtml(fine.member ? fine.member.fullName : fine.memberName)}</p>
        ${f.textarea({ name: 'reason', label: t('fines.waiveReason'), rows: 3, required: true })}
      </form>`,
      actions: [
        { label: t('common.cancel'), variant: 'ghost', onClick: () => closeModal(modalId) },
        { label: t('fines.waive'), variant: 'danger', onClick: submit }
      ]
    });
    const root = document.getElementById(modalId);
    const form = root.querySelector('#waive-form');
    async function submit() {
      clearErrors(form);
      const data = readForm(form);
      try {
        await api.post('/fines/waive', { fineId: fine._id, reason: data.reason });
        toast(t('fines.waived'), 'success');
        closeModal(modalId);
        load();
      } catch (err) {
        if (err.fieldErrors) applyFieldErrors(form, err.fieldErrors);
        else toast(err.message, 'error');
      }
    }
  }

  await load();
  return function unmount() {};
}
