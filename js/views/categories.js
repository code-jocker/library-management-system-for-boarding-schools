// public/js/views/categories.js
import { api, invalidateCache } from '../core/api.js';
import { t } from '../core/i18n.js';
import { escapeHtml } from '../core/utils.js';
import { pageHeader, card, BTN } from '../components/pageHeader.js';
import { skeletonTable } from '../components/skeleton.js';
import { emptyState } from '../components/emptyState.js';
import { openModal, closeModal } from '../components/modal.js';
import { confirmDialog } from '../components/confirm.js';
import { formField, readForm, applyFieldErrors, clearErrors } from '../components/formField.js';
import { toast } from '../components/toast.js';
import { chip } from '../components/badge.js';

const f = formField;
const PALETTE = ['#1E3A8A', '#F59E0B', '#16A34A', '#DC2626', '#7C3AED', '#0891B2', '#DB2777', '#EA580C', '#4B5563'];

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  host.innerHTML = '';
  host.appendChild(pageHeader({
    title: t('categories.title'),
    crumbs: ctx.defaultCrumbs,
    actions: [{ label: t('categories.addCategory'), icon: 'plus', variant: 'primary', id: 'add-btn', onClick: () => openForm() }]
  }));

  const body = document.createElement('div');
  body.innerHTML = skeletonTable(4, 3);
  host.appendChild(body);

  async function load() {
    body.innerHTML = skeletonTable(4, 3);
    try {
      const res = await api.get('/categories', { signal: ctx.signal });
      render(res.data.items || []);
    } catch (err) {
      body.innerHTML = emptyState({ title: t('common.errorTitle'), message: err.message });
    }
  }

  function render(items) {
    if (!items.length) {
      body.innerHTML = card(emptyState({ title: t('categories.empty'), actionLabel: t('categories.addCategory'), actionId: 'add' }));
      body.querySelector('.empty-action').addEventListener('click', () => openForm());
      return;
    }
    body.innerHTML = `<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
      ${items.map((c) => `
        <div class="bg-white dark:bg-slate-800 rounded-card shadow-soft p-5 flex items-start justify-between gap-3">
          <div class="min-w-0">
            ${chip(c.name, c.color)}
            <p class="text-sm text-slate-500 dark:text-slate-400 mt-2 line-clamp-2">${escapeHtml(c.description || '')}</p>
            <p class="text-xs text-slate-400 mt-2"><i data-lucide="book-open" class="w-3 h-3 inline"></i> ${c.bookCount} ${escapeHtml(t('categories.bookCount').toLowerCase())}</p>
          </div>
          <div class="flex flex-col gap-1">
            <button data-edit="${c._id}" class="p-2 rounded-input text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-primary" title="${escapeHtml(t('common.edit'))}"><i data-lucide="pencil" class="w-4 h-4"></i></button>
            <button data-del="${c._id}" class="p-2 rounded-input text-slate-400 hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-danger" title="${escapeHtml(t('common.delete'))}"><i data-lucide="trash" class="w-4 h-4"></i></button>
          </div>
        </div>`).join('')}
    </div>`;
    if (window.lucide) window.lucide.createIcons();
    body.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => openForm(items.find((c) => c._id === b.getAttribute('data-edit')))));
    body.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => remove(items.find((c) => c._id === b.getAttribute('data-del')))));
  }

  function openForm(cat) {
    const isEdit = !!cat;
    const modalId = openModal({
      title: isEdit ? t('categories.title') + ' — ' + cat.name : t('categories.addCategory'),
      size: 'sm',
      body: `<form id="cat-form" novalidate>
        ${f.text({ name: 'name', label: t('categories.name'), value: cat?.name || '', required: true })}
        <div class="mt-3">${f.textarea({ name: 'description', label: t('categories.description'), value: cat?.description || '', rows: 2 })}</div>
        <div class="mt-3">
          <label class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">${escapeHtml(t('categories.color'))}</label>
          <div id="palette" class="flex flex-wrap gap-2">
            ${PALETTE.map((col) => `<button type="button" data-color="${col}" class="w-8 h-8 rounded-full border-2 ${(cat?.color || PALETTE[0]) === col ? 'border-slate-800 dark:border-white' : 'border-transparent'}" style="background:${col}"></button>`).join('')}
          </div>
          <input type="hidden" name="color" id="color-input" value="${escapeHtml(cat?.color || PALETTE[0])}" />
        </div>
      </form>`,
      actions: [
        { label: t('common.cancel'), variant: 'ghost', onClick: () => closeModal(modalId) },
        { label: t('common.save'), variant: 'primary', onClick: submit }
      ]
    });
    const root = document.getElementById(modalId);
    const form = root.querySelector('#cat-form');
    root.querySelectorAll('[data-color]').forEach((b) => b.addEventListener('click', () => {
      root.querySelectorAll('[data-color]').forEach((x) => x.classList.replace('border-slate-800', 'border-transparent'));
      b.classList.remove('border-transparent'); b.classList.add('border-slate-800');
      root.querySelector('#color-input').value = b.getAttribute('data-color');
    }));

    async function submit() {
      clearErrors(form);
      const data = readForm(form);
      try {
        if (isEdit) { await api.put('/categories/' + cat._id, data); toast(t('categories.updated'), 'success'); }
        else { await api.post('/categories', data); toast(t('categories.added'), 'success'); }
        invalidateCache('/categories');
        closeModal(modalId);
        load();
      } catch (err) {
        if (err.fieldErrors) applyFieldErrors(form, err.fieldErrors);
        else toast(err.message, 'error');
      }
    }
  }

  async function remove(cat) {
    const ok = await confirmDialog({ title: t('categories.deleteConfirm'), message: `"${escapeHtml(cat.name)}"` });
    if (!ok) return;
    try {
      await api.del('/categories/' + cat._id);
      toast(t('categories.deleted'), 'success');
      invalidateCache('/categories');
      load();
    } catch (err) { toast(err.message, 'error'); }
  }

  await load();
  return function unmount() {};
}
