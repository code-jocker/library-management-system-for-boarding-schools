// public/js/views/books.js
import { api, invalidateCache } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getState } from '../core/store.js';
import { escapeHtml, buildQuery, compressImage } from '../core/utils.js';
import { navigate } from '../core/router.js';
import { pageHeader, BTN } from '../components/pageHeader.js';
import { renderFilterBar } from '../components/filterBar.js';
import { dataTable } from '../components/dataTable.js';
import { skeletonCards, skeletonTable } from '../components/skeleton.js';
import { openModal, closeModal } from '../components/modal.js';
import { confirmDialog } from '../components/confirm.js';
import { formField, readForm, applyFieldErrors, clearErrors } from '../components/formField.js';
import { toast } from '../components/toast.js';
import { badge } from '../components/badge.js';
import { bookCover } from '../components/avatar.js';
import { openImportModal } from '../components/importModal.js';
import { emptyState } from '../components/emptyState.js';
import { renderPagination } from '../components/pagination.js';

const f = formField;

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const q = { ...ctx.query };
  let categories = [];

  host.innerHTML = '';
  host.appendChild(pageHeader({
    title: t('books.title'),
    crumbs: ctx.defaultCrumbs,
    actions: [
      { label: t('books.importBooks'), icon: 'upload', variant: 'outline', id: 'import-btn', onClick: openImport },
      { label: t('books.addBook'), icon: 'plus', variant: 'primary', id: 'add-btn', onClick: () => openBookForm() }
    ]
  }));

  const controls = document.createElement('div');
  controls.className = 'mb-4 flex flex-col gap-3';
  controls.innerHTML = `
    <div class="flex flex-wrap items-center gap-2 justify-end">
      <button id="view-table" class="${viewBtnCls(q.view !== 'grid')}" title="${escapeHtml(t('books.tableView'))}"><i data-lucide="list" class="w-4 h-4"></i></button>
      <button id="view-grid" class="${viewBtnCls(q.view === 'grid')}" title="${escapeHtml(t('books.gridView'))}"><i data-lucide="layout-grid" class="w-4 h-4"></i></button>
    </div>`;
  host.appendChild(controls);

  const filterHost = document.createElement('div');
  filterHost.className = 'mb-4';
  host.appendChild(filterHost);

  const listHost = document.createElement('div');
  host.appendChild(listHost);

  if (window.lucide) window.lucide.createIcons();

  // Load category options once (cached).
  try {
    const res = await api.get('/categories', { signal: ctx.signal });
    categories = (res.data && res.data.items) || [];
  } catch { categories = []; }
  const langRes = await api.get('/books/meta/options', { signal: ctx.signal }).catch(() => ({ data: { languages: [] } }));

  renderFilterBar(filterHost, {
    search: { placeholder: t('common.searchPlaceholder'), value: q.q || '' },
    selects: [
      { name: 'category', label: t('books.category'), value: q.category || '', options: categories.map((c) => ({ value: c._id, label: c.name })) },
      { name: 'language', label: t('books.language'), value: q.language || '', options: (langRes.data.languages || []).map((l) => ({ value: l, label: l })) },
      { name: 'availability', label: t('books.availability'), value: q.availability || '', options: [{ value: 'available', label: t('status.available') }, { value: 'unavailable', label: t('status.borrowed') }] }
    ],
    onChange: (vals) => {
      q.q = vals.q; q.category = vals.category; q.language = vals.language; q.availability = vals.availability;
      q.page = 1;
      ctx.setQuery(q);
      load();
    }
  });

  controls.querySelector('#view-table').addEventListener('click', () => { q.view = ''; ctx.setQuery(q); load(); controls.querySelector('#view-table').className = viewBtnCls(true); controls.querySelector('#view-grid').className = viewBtnCls(false); });
  controls.querySelector('#view-grid').addEventListener('click', () => { q.view = 'grid'; ctx.setQuery(q); load(); controls.querySelector('#view-grid').className = viewBtnCls(true); controls.querySelector('#view-table').className = viewBtnCls(false); });

  async function load() {
    listHost.innerHTML = q.view === 'grid' ? skeletonCards(8) : skeletonTable(8, 6);
    const qs = buildQuery({ ...q, limit: q.view === 'grid' ? 24 : 20 });
    try {
      const res = await api.get(`/books${qs}`, { signal: ctx.signal });
      const data = res.data;
      if (q.view === 'grid') renderGrid(listHost, data);
      else renderTable(listHost, data);
    } catch (err) {
      listHost.innerHTML = `<div class="p-6 text-danger">${escapeHtml(err.message)}</div>`;
    }
  }

  function renderTable(container, data) {
    dataTable(container, {
      columns: [
        { key: 'title', label: t('books.bookTitle'), sortable: true, render: (b) => `<div class="flex items-center gap-3">${bookCover({ src: b.cover, title: b.title, size: 'sm' })}<div class="min-w-0"><a href="#/books/${b._id}" class="font-medium text-slate-800 dark:text-slate-100 hover:text-primary truncate block">${escapeHtml(b.title)}</a><p class="text-xs text-slate-400 truncate">${escapeHtml(b.author)}</p></div></div>` },
        { key: 'isbn', label: t('books.isbn'), render: (b) => escapeHtml(b.isbn) },
        { key: 'category', label: t('books.category'), render: (b) => b.category ? escapeHtml(b.category.name) : '<span class="text-slate-400">—</span>' },
        { key: 'language', label: t('books.language'), render: (b) => escapeHtml(b.language || '') },
        { key: 'availableCopies', label: t('books.availability'), sortable: true, render: (b) => b.availableCopies > 0 ? badge('available', { label: `${b.availableCopies}/${b.totalCopies}` }) : badge('borrowed', { label: `0/${b.totalCopies}` }) }
      ],
      rows: data.items,
      page: data.page, pages: data.pages, total: data.total,
      onPage: (p) => { q.page = p; ctx.setQuery(q); load(); },
      sortKey: q.sort, sortDir: q.sort && q.sort.startsWith('-') ? 'desc' : 'asc',
      onSort: (key, dir) => { q.sort = dir === 'desc' ? '-' + key : key; ctx.setQuery(q); load(); },
      actions: (b) => [
        { label: t('common.view'), icon: 'eye', onClick: () => navigate('/books/' + b._id) },
        { label: t('common.edit'), icon: 'pencil', onClick: () => openBookForm(b) },
        { divider: true },
        { label: t('common.delete'), icon: 'trash', danger: true, onClick: () => removeBook(b) }
      ],
      empty: { title: t('books.noBooks'), message: '', actionLabel: t('books.addBook'), actionId: 'add', onAction: () => openBookForm() },
      stackedRender: (b) => `<div class="flex items-center gap-3">${bookCover({ src: b.cover, title: b.title, size: 'md' })}
        <div class="min-w-0 flex-1"><a href="#/books/${b._id}" class="font-medium text-slate-800 dark:text-slate-100">${escapeHtml(b.title)}</a>
        <p class="text-xs text-slate-400 truncate">${escapeHtml(b.author)}</p>
        <div class="mt-1">${b.availableCopies > 0 ? badge('available', { label: `${b.availableCopies}/${b.totalCopies}` }) : badge('borrowed', { label: `0/${b.totalCopies}` })}</div></div>
        <div data-mobile-actions></div></div>`
    });
  }

  function renderGrid(container, data) {
    if (!data.items.length) {
      container.innerHTML = `<div class="bg-white dark:bg-slate-800 rounded-card shadow-soft">${emptyState({ title: t('books.noBooks'), actionLabel: t('books.addBook'), actionId: 'add' })}</div>`;
      const btn = container.querySelector('.empty-action');
      if (btn) btn.addEventListener('click', () => openBookForm());
      return;
    }
    container.innerHTML = `<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-4">
      ${data.items.map((b) => `
        <div class="bg-white dark:bg-slate-800 rounded-card shadow-soft overflow-hidden group">
          <a href="#/books/${b._id}" class="block">
            <div class="aspect-[3/4] bg-slate-100 dark:bg-slate-700 flex items-center justify-center overflow-hidden">
              ${b.cover ? `<img src="${escapeHtml(b.cover)}" alt="${escapeHtml(b.title)}" loading="lazy" class="w-full h-full object-cover" />` : `<i data-lucide="book" class="w-10 h-10 text-slate-300"></i>`}
            </div>
          </a>
          <div class="p-3">
            <a href="#/books/${b._id}" class="font-medium text-sm text-slate-800 dark:text-slate-100 line-clamp-2 hover:text-primary">${escapeHtml(b.title)}</a>
            <p class="text-xs text-slate-400 truncate mt-0.5">${escapeHtml(b.author)}</p>
            <div class="mt-2">${b.availableCopies > 0 ? badge('available', { label: `${b.availableCopies}/${b.totalCopies}` }) : badge('borrowed', { label: `0/${b.totalCopies}` })}</div>
          </div>
        </div>`).join('')}
    </div>`;
    const pag = document.createElement('div');
    pag.className = 'mt-4';
    container.appendChild(pag);
    renderPagination(pag, { page: data.page, pages: data.pages, total: data.total, onChange: (p) => { q.page = p; ctx.setQuery(q); load(); } });
    if (window.lucide) window.lucide.createIcons();
  }

  // ---- Add / Edit modal ----
  function openBookForm(book) {
    const isEdit = !!book;
    const catOptions = categories.map((c) => ({ value: c._id, label: c.name }));
    const langs = Array.from(new Set([...(langRes.data.languages || []), 'English', 'French', 'Kinyarwanda']));
    let coverData = book ? book.cover || '' : '';

    const modalId = openModal({
      title: isEdit ? t('books.editBook') : t('books.addBook'),
      size: 'lg',
      body: `<form id="book-form" class="grid sm:grid-cols-2 gap-4" novalidate>
        <div class="sm:col-span-2">${f.text({ name: 'title', label: t('books.bookTitle'), value: book?.title || '', required: true })}</div>
        ${f.text({ name: 'author', label: t('books.author'), value: book?.author || '', required: true })}
        ${f.text({ name: 'isbn', label: t('books.isbn'), value: book?.isbn || '', required: true })}
        ${f.select({ name: 'category', label: t('books.category'), value: book?.category?._id || book?.category || '', options: catOptions })}
        ${f.select({ name: 'language', label: t('books.language'), value: book?.language || 'English', options: langs })}
        ${f.text({ name: 'publisher', label: t('books.publisher'), value: book?.publisher || '' })}
        ${f.text({ name: 'year', label: t('books.year'), value: book?.year || '', type: 'number', min: 1000, max: 2200 })}
        ${f.text({ name: 'edition', label: t('books.edition'), value: book?.edition || '' })}
        ${f.text({ name: 'shelfLocation', label: t('books.shelfLocation'), value: book?.shelfLocation || '' })}
        ${f.text({ name: 'totalCopies', label: t('books.totalCopies'), value: book?.totalCopies ?? 1, type: 'number', min: 0, required: true })}
        ${f.text({ name: 'replacementValue', label: t('books.replacementValue'), value: book?.replacementValue ?? 0, type: 'number', min: 0 })}
        <div class="sm:col-span-2">${f.textarea({ name: 'description', label: t('books.description'), value: book?.description || '', rows: 3 })}</div>
        <div class="sm:col-span-2">
          ${f.file({ name: 'cover', label: t('books.cover'), hint: 'Compressed automatically to under 100 KB.' })}
          <div id="cover-preview" class="mt-2">${coverData ? `<img src="${escapeHtml(coverData)}" class="w-16 h-24 object-cover rounded border" />` : ''}</div>
        </div>
      </form>`,
      actions: [
        { label: t('common.cancel'), variant: 'ghost', onClick: () => closeModal(modalId) },
        { label: t('common.save'), variant: 'primary', onClick: submit }
      ]
    });

    const root = document.getElementById(modalId);
    const form = root.querySelector('#book-form');

    // Cover upload -> compress -> preview.
    root.querySelector('[name="cover"]').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        coverData = await compressImage(file);
        root.querySelector('#cover-preview').innerHTML = `<img src="${escapeHtml(coverData)}" class="w-16 h-24 object-cover rounded border" />`;
      } catch (err) { toast(err.message, 'error'); }
    });

    async function submit() {
      clearErrors(form);
      const data = readForm(form);
      if (coverData) data.cover = coverData;
      // Numeric coercion.
      data.totalCopies = parseInt(data.totalCopies, 10) || 0;
      data.year = data.year ? parseInt(data.year, 10) : null;
      data.replacementValue = data.replacementValue ? Number(data.replacementValue) : 0;
      if (!data.category) data.category = null;
      try {
        if (isEdit) { await api.put('/books/' + book._id, data); toast(t('books.updated'), 'success'); }
        else { await api.post('/books', data); toast(t('books.added'), 'success'); }
        invalidateCache('/books');
        closeModal(modalId);
        load();
      } catch (err) {
        if (err.fieldErrors) applyFieldErrors(form, err.fieldErrors);
        else toast(err.message, 'error');
      }
    }
  }

  async function removeBook(book) {
    const ok = await confirmDialog({ title: t('books.deleteConfirm'), message: `"${escapeHtml(book.title)}"` });
    if (!ok) return;
    try {
      await api.del('/books/' + book._id);
      toast(t('books.deleted'), 'success');
      invalidateCache('/books');
      load();
    } catch (err) { toast(err.message, 'error'); }
  }

  function openImport() {
    openImportModal({
      kind: 'books',
      templateColumns: [
        { key: 'title', label: 'title', sample: 'Things Fall Apart' },
        { key: 'author', label: 'author', sample: 'Chinua Achebe' },
        { key: 'isbn', label: 'isbn', sample: 'LIT-9001' },
        { key: 'category', label: 'category', sample: 'Literature & Novels' },
        { key: 'publisher', label: 'publisher', sample: 'Heinemann' },
        { key: 'year', label: 'year', sample: 1958 },
        { key: 'language', label: 'language', sample: 'English' },
        { key: 'totalCopies', label: 'totalCopies', sample: 3 },
        { key: 'shelfLocation', label: 'shelfLocation', sample: 'LIT-9001' },
        { key: 'replacementValue', label: 'replacementValue', sample: 6000 }
      ],
      onDone: () => { invalidateCache('/books'); load(); }
    });
  }

  await load();

  return function unmount() {};
}

function viewBtnCls(active) {
  return `p-2 rounded-input min-w-[44px] min-h-[44px] flex items-center justify-center ${active ? 'bg-primary text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-300 dark:border-slate-600 hover:bg-slate-100'}`;
}
