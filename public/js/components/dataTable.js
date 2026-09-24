// public/js/components/dataTable.js
// Reusable data table: sticky header, zebra rows, sortable columns, search box,
// row actions (View/Edit/Delete), pagination, and a stacked-card fallback on
// small screens. All cell HTML is produced by column.render so callers control
// escaping; plain values are escaped automatically.
import { escapeHtml } from '../core/utils.js';
import { t } from '../core/i18n.js';
import { renderPagination } from './pagination.js';
import { attachDropdown } from './dropdown.js';
import { emptyState } from './emptyState.js';

/**
 * @param {HTMLElement} host
 * @param {object} opts
 *  columns: [{ key, label, sortable, render(row), className }]
 *  rows: array
 *  rowId(row): string
 *  actions(row): [{ label, icon, onClick, danger }]  (rendered as a row menu)
 *  page, pages, total, onPage(page)
 *  empty: { title, message, actionLabel, actionId, onAction }
 *  onSort(key, dir)
 *  sortKey, sortDir
 *  stackedRender(row): optional custom small-screen card HTML
 *  selectable: when true, renders a leading checkbox column
 *  selected: Set/array of currently-selected rowIds
 *  onSelectionChange(idsArray): fired whenever the selection changes
 */
export function dataTable(host, opts) {
  const {
    columns = [], rows = [], rowId = (r) => r._id, actions = null,
    page = 1, pages = 1, total = 0, onPage = null,
    empty = null, onSort = null, sortKey = null, sortDir = 'asc',
    stackedRender = null,
    selectable = false, selected = null, onSelectionChange = null
  } = opts;

  host.innerHTML = '';

  if (!rows.length) {
    host.innerHTML = emptyState(empty || { title: t('common.noData') });
    if (empty && empty.actionId) {
      const btn = host.querySelector('.empty-action');
      if (btn && empty.onAction) btn.addEventListener('click', empty.onAction);
    }
    return { refresh: () => dataTable(host, opts) };
  }

  // Live selection set, seeded from the caller's `selected`.
  const sel = new Set((selected ? Array.from(selected) : []).map(String));
  const emit = () => { if (onSelectionChange) onSelectionChange(Array.from(sel)); };

  const wrap = document.createElement('div');
  wrap.className = 'bg-white dark:bg-slate-800 rounded-card shadow-soft overflow-hidden';

  // ---- Desktop table ----
  const scroll = document.createElement('div');
  scroll.className = 'overflow-x-auto scroll-slim';
  const table = document.createElement('table');
  table.className = 'w-full text-sm dt-sticky';

  const thead = document.createElement('thead');
  thead.innerHTML = `<tr class="text-left text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
    ${selectable ? `<th class="px-4 py-3 w-10"><input type="checkbox" data-select-all class="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/30 cursor-pointer" aria-label="${escapeHtml(t('common.selectAll') || 'Select all')}" /></th>` : ''}
    ${columns.map((c) => {
      const arrow = sortKey === c.key ? (sortDir === 'asc' ? '↑' : '↓') : '';
      return `<th class="px-4 py-3 font-semibold whitespace-nowrap ${c.sortable && onSort ? 'cursor-pointer select-none hover:text-slate-700' : ''} ${c.className || ''}"
        ${c.sortable && onSort ? `data-sort="${c.key}" role="button" tabindex="0" aria-sort="${sortKey === c.key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}"` : ''}>
        <span class="inline-flex items-center gap-1">${escapeHtml(c.label)}<span class="text-primary">${arrow}</span></span></th>`;
    }).join('')}
    ${actions ? `<th class="px-4 py-3 text-right font-semibold">${escapeHtml(t('common.actions'))}</th>` : ''}
  </tr>`;
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  rows.forEach((row, i) => {
    const tr = document.createElement('tr');
    const rid = String(rowId(row));
    tr.className = `border-b border-slate-100 dark:border-slate-700/60 hover:bg-slate-50 dark:hover:bg-slate-700/40 ${i % 2 ? 'bg-slate-50/40 dark:bg-slate-800/40' : ''} hidden sm:table-row`;
    tr.innerHTML =
      (selectable ? `<td class="px-4 py-3 align-middle"><input type="checkbox" data-row-check="${escapeHtml(rid)}" ${sel.has(rid) ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/30 cursor-pointer" aria-label="${escapeHtml(t('common.select') || 'Select')}" /></td>` : '') +
      columns.map((c) => {
        const val = c.render ? c.render(row) : escapeHtml(row[c.key]);
        return `<td class="px-4 py-3 align-middle ${c.className || ''}">${val}</td>`;
      }).join('') +
      (actions ? `<td class="px-4 py-3 text-right"></td>` : '');
    tbody.appendChild(tr);

    if (selectable) {
      const cb = tr.querySelector('[data-row-check]');
      cb.addEventListener('change', () => {
        if (cb.checked) sel.add(rid); else sel.delete(rid);
        syncSelectAll();
        emit();
      });
    }

    if (actions) {
      const cell = tr.querySelector('td:last-child');
      const btn = document.createElement('button');
      btn.className = 'inline-flex items-center justify-center w-9 h-9 rounded-input text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700';
      btn.setAttribute('aria-label', t('common.actions'));
      btn.setAttribute('title', t('common.actions'));
      btn.innerHTML = '<i data-lucide="more-vertical" class="w-4 h-4"></i>';
      cell.appendChild(btn);
      attachDropdown(btn, actions(row));
    }
  });
  table.appendChild(tbody);
  scroll.appendChild(table);

  // ---- Mobile stacked cards ----
  const cards = document.createElement('div');
  cards.className = 'sm:hidden divide-y divide-slate-100 dark:divide-slate-700';
  rows.forEach((row) => {
    const rid = String(rowId(row));
    const card = document.createElement('div');
    card.className = 'p-4 flex items-start gap-3';
    const checkHtml = selectable
      ? `<input type="checkbox" data-row-check="${escapeHtml(rid)}" ${sel.has(rid) ? 'checked' : ''} class="mt-1 w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary/30 cursor-pointer shrink-0" aria-label="${escapeHtml(t('common.select') || 'Select')}" />`
      : '';
    const bodyHtml = stackedRender ? stackedRender(row) : defaultStack(row, columns, actions);
    card.innerHTML = `${checkHtml}<div class="min-w-0 flex-1">${bodyHtml}</div>`;
    cards.appendChild(card);
    if (selectable) {
      const cb = card.querySelector('[data-row-check]');
      cb.addEventListener('change', () => {
        if (cb.checked) sel.add(rid); else sel.delete(rid);
        // Mirror the state onto the desktop row checkbox for the same id.
        const twin = wrap.querySelector(`tbody [data-row-check="${CSS.escape(rid)}"]`);
        if (twin) twin.checked = cb.checked;
        syncSelectAll();
        emit();
      });
    }
    if (actions && !stackedRender) {
      const holder = card.querySelector('[data-mobile-actions]');
      if (holder) {
        const btn = document.createElement('button');
        btn.className = 'inline-flex items-center gap-1 px-3 py-2 rounded-input bg-slate-100 dark:bg-slate-700 text-sm font-medium';
        btn.innerHTML = `<i data-lucide="more-vertical" class="w-4 h-4"></i>${escapeHtml(t('common.actions'))}`;
        holder.appendChild(btn);
        attachDropdown(btn, actions(row));
      }
    }
  });

  wrap.appendChild(scroll);
  wrap.appendChild(cards);
  host.appendChild(wrap);

  // ---- Select-all (desktop header) ----
  function syncSelectAll() {
    const all = wrap.querySelector('[data-select-all]');
    if (!all) return;
    const ids = rows.map((r) => String(rowId(r)));
    const checkedCount = ids.filter((id) => sel.has(id)).length;
    all.checked = checkedCount === ids.length && ids.length > 0;
    all.indeterminate = checkedCount > 0 && checkedCount < ids.length;
  }
  if (selectable) {
    const all = wrap.querySelector('[data-select-all]');
    if (all) {
      all.addEventListener('change', () => {
        rows.forEach((r) => {
          const rid = String(rowId(r));
          if (all.checked) sel.add(rid); else sel.delete(rid);
        });
        wrap.querySelectorAll('[data-row-check]').forEach((cb) => { cb.checked = all.checked; });
        emit();
      });
    }
    syncSelectAll();
  }

  // ---- Pagination ----
  if (onPage) {
    const pag = document.createElement('div');
    pag.className = 'px-4 py-3 border-t border-slate-200 dark:border-slate-700';
    host.appendChild(pag);
    renderPagination(pag, { page, pages, total, onChange: onPage });
  }

  // ---- Sort handlers ----
  if (onSort) {
    thead.querySelectorAll('[data-sort]').forEach((th) => {
      const handler = () => {
        const key = th.getAttribute('data-sort');
        const dir = sortKey === key && sortDir === 'asc' ? 'desc' : 'asc';
        onSort(key, dir);
      };
      th.addEventListener('click', handler);
      th.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handler(); } });
    });
  }

  if (window.lucide) window.lucide.createIcons();
  return { refresh: () => dataTable(host, opts) };
}

function defaultStack(row, columns, actions) {
  const lines = columns.slice(0, 5).map((c) => {
    const val = c.render ? c.render(row) : escapeHtml(row[c.key]);
    return `<div class="flex justify-between gap-3 py-1"><span class="text-xs uppercase tracking-wide text-slate-400">${escapeHtml(c.label)}</span><span class="text-sm text-slate-700 dark:text-slate-200 text-right">${val}</span></div>`;
  }).join('');
  return `${lines}${actions ? '<div class="flex justify-end mt-2" data-mobile-actions></div>' : ''}`;
}
