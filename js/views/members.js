// public/js/views/members.js
import { api, invalidateCache } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getState } from '../core/store.js';
import { escapeHtml, buildQuery, compressImage } from '../core/utils.js';
import { navigate } from '../core/router.js';
import { pageHeader } from '../components/pageHeader.js';
import { renderFilterBar } from '../components/filterBar.js';
import { dataTable } from '../components/dataTable.js';
import { skeletonTable } from '../components/skeleton.js';
import { emptyState } from '../components/emptyState.js';
import { openModal, closeModal } from '../components/modal.js';
import { confirmDialog } from '../components/confirm.js';
import { formField, readForm, applyFieldErrors, clearErrors } from '../components/formField.js';
import { toast } from '../components/toast.js';
import { badge } from '../components/badge.js';
import { avatar } from '../components/avatar.js';
import { openImportModal } from '../components/importModal.js';
import { printLibraryCard } from '../print/libraryCard.js';

const f = formField;

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const q = { ...ctx.query };
  const settings = getState().settings || {};
  const selectedIds = new Set();

  host.innerHTML = '';
  host.appendChild(pageHeader({
    title: t('members.title'),
    crumbs: ctx.defaultCrumbs,
    actions: [
      { label: t('members.importMembers'), icon: 'upload', variant: 'outline', id: 'import-btn', onClick: openImport },
      { label: t('members.addMember'), icon: 'plus', variant: 'primary', id: 'add-btn', onClick: () => openForm() }
    ]
  }));

  const filterHost = document.createElement('div');
  filterHost.className = 'mb-4';
  host.appendChild(filterHost);

  // Bulk-action bar: hidden until at least one row is selected.
  const bulkBar = document.createElement('div');
  bulkBar.className = 'hidden mb-4 flex flex-wrap items-center gap-3 p-3 rounded-card bg-primary-50 dark:bg-slate-700/50 border border-primary/20';
  bulkBar.innerHTML = `
    <span id="bulk-count" class="text-sm font-medium text-slate-700 dark:text-slate-200"></span>
    <button id="bulk-delete" class="inline-flex items-center gap-2 px-4 py-2 rounded-input bg-danger text-white text-sm font-medium min-h-[44px] hover:bg-red-700">
      <i data-lucide="trash-2" class="w-4 h-4"></i><span>${escapeHtml(t('members.deleteSelected'))}</span>
    </button>
    <button id="bulk-clear" class="inline-flex items-center gap-2 px-3 py-2 rounded-input text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700 min-h-[44px]">
      ${escapeHtml(t('common.clearSelection'))}
    </button>`;
  host.appendChild(bulkBar);

  const listHost = document.createElement('div');
  host.appendChild(listHost);

  function updateBulkBar() {
    const n = selectedIds.size;
    bulkBar.classList.toggle('hidden', n === 0);
    if (n) bulkBar.querySelector('#bulk-count').textContent = t('members.selectedCount', { n });
  }

  bulkBar.querySelector('#bulk-delete').addEventListener('click', bulkDelete);
  bulkBar.querySelector('#bulk-clear').addEventListener('click', () => {
    selectedIds.clear();
    updateBulkBar();
    load();
  });

  async function bulkDelete() {
    const ids = Array.from(selectedIds);
    if (!ids.length) return;
    const ok = await confirmDialog({
      title: t('members.deleteSelectedConfirm'),
      message: t('members.selectedCount', { n: ids.length }),
      confirmLabel: t('common.delete'),
      variant: 'danger'
    });
    if (!ok) return;
    try {
      const res = await api.post('/members/bulk-delete', { ids });
      toast(res.message || t('members.deleted'), res.data && res.data.skipped ? 'warning' : 'success');
      selectedIds.clear();
      invalidateCache('/members');
      updateBulkBar();
      load();
    } catch (err) { toast(err.message, 'error'); }
  }

  renderFilterBar(filterHost, {
    search: { placeholder: t('common.searchPlaceholder'), value: q.q || '' },
    selects: [
      { name: 'classLevel', label: t('members.classLevel'), value: q.classLevel || '', options: (settings.classLevels || []).map((c) => ({ value: c, label: c })) },
      { name: 'stream', label: t('members.stream'), value: q.stream || '', options: (settings.streams || []).map((c) => ({ value: c, label: c })) },
      { name: 'dormitory', label: t('members.dormitory'), value: q.dormitory || '', options: (settings.dormitories || []).map((c) => ({ value: c, label: c })) },
      { name: 'memberType', label: t('members.memberType'), value: q.memberType || '', options: [{ value: 'student', label: t('members.student') }, { value: 'teacher', label: t('members.teacher') }] },
      { name: 'status', label: t('members.status'), value: q.status || '', options: [{ value: 'active', label: t('members.active') }, { value: 'inactive', label: t('members.inactive') }, { value: 'graduated', label: t('members.graduated') }] }
    ],
    onChange: (vals) => { Object.assign(q, vals); q.page = 1; ctx.setQuery(q); load(); }
  });

  async function load() {
    listHost.innerHTML = skeletonTable(8, 6);
    try {
      const res = await api.get('/members' + buildQuery({ ...q, limit: 20 }), { signal: ctx.signal });
      renderTable(listHost, res.data);
    } catch (err) {
      listHost.innerHTML = `<div class="p-6 text-danger">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderTable(container, data) {
    dataTable(container, {
      selectable: true,
      selected: selectedIds,
      onSelectionChange: (ids) => { selectedIds.clear(); ids.forEach((id) => selectedIds.add(id)); updateBulkBar(); },
      columns: [
        { key: 'fullName', label: t('members.fullName'), sortable: true, render: (m) => `<div class="flex items-center gap-3">${avatar({ src: m.photo, name: m.fullName, size: 'sm' })}<div class="min-w-0"><a href="#/members/${m._id}" class="font-medium text-slate-800 dark:text-slate-100 hover:text-primary truncate block">${escapeHtml(m.fullName)}</a><p class="text-xs text-slate-400">${escapeHtml(m.admissionNo)}</p></div></div>` },
        { key: 'classLevel', label: t('members.classLevel'), render: (m) => escapeHtml([m.classLevel, m.stream].filter(Boolean).join(' ')) || '—' },
        { key: 'dormitory', label: t('members.dormitory'), render: (m) => escapeHtml(m.dormitory || '—') },
        { key: 'memberType', label: t('members.memberType'), render: (m) => escapeHtml(m.memberType === 'teacher' ? t('members.teacher') : t('members.student')) },
        { key: 'guardianPhone', label: t('members.guardianPhone'), render: (m) => escapeHtml(m.guardianPhone || '—') },
        { key: 'status', label: t('members.status'), render: (m) => badge(m.status) }
      ],
      rows: data.items,
      page: data.page, pages: data.pages, total: data.total,
      onPage: (p) => { q.page = p; ctx.setQuery(q); load(); },
      sortKey: q.sort, sortDir: q.sort && q.sort.startsWith('-') ? 'desc' : 'asc',
      onSort: (key, dir) => { const map = { fullName: 'name', admissionNo: 'admission', classLevel: 'name' }; q.sort = (dir === 'desc' ? '-' : '') + (map[key] || key); ctx.setQuery(q); load(); },
      actions: (m) => [
        { label: t('common.view'), icon: 'eye', onClick: () => navigate('/members/' + m._id) },
        { label: t('common.edit'), icon: 'pencil', onClick: () => openForm(m) },
        { label: t('members.printCard'), icon: 'id-card', onClick: () => printLibraryCard(m._id) },
        { divider: true },
        { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => remove(m) }
      ],
      empty: { title: t('members.noMembers'), actionLabel: t('members.addMember'), actionId: 'add', onAction: () => openForm() },
      stackedRender: (m) => `<div class="flex items-center gap-3">${avatar({ src: m.photo, name: m.fullName, size: 'md' })}
        <div class="min-w-0 flex-1"><a href="#/members/${m._id}" class="font-medium text-slate-800 dark:text-slate-100">${escapeHtml(m.fullName)}</a>
        <p class="text-xs text-slate-400">${escapeHtml(m.admissionNo)} · ${escapeHtml(m.classLevel || '')}</p>
        <div class="mt-1">${badge(m.status)}</div></div><div data-mobile-actions></div></div>`
    });
  }

  function openForm(member) {
    const isEdit = !!member;
    let photoData = member ? member.photo || '' : '';
    const modalId = openModal({
      title: isEdit ? t('members.editMember') : t('members.addMember'),
      size: 'lg',
      body: `<form id="mem-form" class="grid sm:grid-cols-2 gap-4" novalidate>
        ${f.text({ name: 'admissionNo', label: t('members.admissionNo'), value: member?.admissionNo || '', placeholder: isEdit ? '' : t('members.admissionAuto'), hint: isEdit ? '' : t('members.admissionAutoHint') })}
        ${f.text({ name: 'fullName', label: t('members.fullName'), value: member?.fullName || '', required: true })}
        ${f.select({ name: 'gender', label: t('members.gender'), value: member?.gender || '', options: [{ value: 'Male', label: t('members.male') }, { value: 'Female', label: t('members.female') }, { value: 'Other', label: t('members.other') }] })}
        ${f.select({ name: 'memberType', label: t('members.memberType'), value: member?.memberType || 'student', options: [{ value: 'student', label: t('members.student') }, { value: 'teacher', label: t('members.teacher') }] })}
        ${f.select({ name: 'classLevel', label: t('members.classLevel'), value: member?.classLevel || '', options: (settings.classLevels || []).map((c) => ({ value: c, label: c })) })}
        ${f.select({ name: 'stream', label: t('members.stream'), value: member?.stream || '', options: (settings.streams || []).map((c) => ({ value: c, label: c })) })}
        ${f.select({ name: 'dormitory', label: t('members.dormitory'), value: member?.dormitory || '', options: (settings.dormitories || []).map((c) => ({ value: c, label: c })) })}
        ${f.select({ name: 'status', label: t('members.status'), value: member?.status || 'active', options: [{ value: 'active', label: t('members.active') }, { value: 'inactive', label: t('members.inactive') }, { value: 'graduated', label: t('members.graduated') }] })}
        ${f.text({ name: 'phone', label: t('members.phone'), value: member?.phone || '' })}
        ${f.text({ name: 'guardianName', label: t('members.guardianName'), value: member?.guardianName || '' })}
        ${f.text({ name: 'guardianPhone', label: t('members.guardianPhone'), value: member?.guardianPhone || '' })}
        ${f.text({ name: 'borrowingLimit', label: t('settings.borrowingLimit') + ' (' + t('common.optional') + ')', value: member?.borrowingLimit ?? '', type: 'number', min: 0 })}
        <div class="sm:col-span-2">
          ${f.file({ name: 'photo', label: t('members.photo'), hint: 'Compressed automatically to under 100 KB.' })}
          <div id="photo-preview" class="mt-2">${photoData ? `<img src="${escapeHtml(photoData)}" class="w-16 h-16 rounded-full object-cover border" />` : ''}</div>
        </div>
      </form>`,
      actions: [
        { label: t('common.cancel'), variant: 'ghost', onClick: () => closeModal(modalId) },
        { label: t('common.save'), variant: 'primary', onClick: submit }
      ]
    });

    const root = document.getElementById(modalId);
    const form = root.querySelector('#mem-form');
    root.querySelector('[name="photo"]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        photoData = await compressImage(file, { maxDim: 400 });
        root.querySelector('#photo-preview').innerHTML = `<img src="${escapeHtml(photoData)}" class="w-16 h-16 rounded-full object-cover border" />`;
      } catch (err) { toast(err.message, 'error'); }
    });

    async function submit() {
      clearErrors(form);
      const data = readForm(form);
      if (photoData) data.photo = photoData;
      data.borrowingLimit = data.borrowingLimit ? parseInt(data.borrowingLimit, 10) : null;
      try {
        if (isEdit) { await api.put('/members/' + member._id, data); toast(t('members.updated'), 'success'); }
        else { await api.post('/members', data); toast(t('members.added'), 'success'); }
        invalidateCache('/members');
        closeModal(modalId);
        load();
      } catch (err) {
        if (err.fieldErrors) applyFieldErrors(form, err.fieldErrors);
        else toast(err.message, 'error');
      }
    }
  }

  async function remove(member) {
    const ok = await confirmDialog({ title: t('members.deleteConfirm'), message: `"${escapeHtml(member.fullName)}"` });
    if (!ok) return;
    try {
      await api.del('/members/' + member._id);
      toast(t('members.deleted'), 'success');
      invalidateCache('/members');
      load();
    } catch (err) { toast(err.message, 'error'); }
  }

  function openImport() {
    openImportModal({
      kind: 'members',
      templateColumns: [
        { key: 'fullName', label: 'fullName', sample: 'Aline Ingabire' },
        { key: 'classLevel', label: 'classLevel', sample: 'S1' },
        { key: 'stream', label: 'stream', sample: 'A' },
        { key: 'dormitory', label: 'dormitory', sample: 'Nyagatare' },
        { key: 'gender', label: 'gender', sample: 'Female' },
        { key: 'memberType', label: 'memberType', sample: 'student' },
        { key: 'guardianName', label: 'guardianName', sample: 'Jean Ingabire' },
        { key: 'guardianPhone', label: 'guardianPhone', sample: '+250788100001' },
        { key: 'phone', label: 'phone', sample: '' },
        { key: 'admissionNo', label: 'admissionNo (optional)', sample: '' }
      ],
      onDone: () => { invalidateCache('/members'); load(); }
    });
  }

  await load();
  return function unmount() {};
}
