// public/js/components/filterBar.js
// Reusable filter bar (search box + select filters). Emits a flat object.
import { escapeHtml } from '../core/utils.js';
import { t } from '../core/i18n.js';
import { debounce } from '../core/utils.js';

const selectCls = 'rounded-input border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2 text-sm min-h-[44px] text-slate-700 dark:text-slate-200';

/**
 * @param {HTMLElement} host
 * @param {object} o
 *   search: { placeholder, value }
 *   selects: [{ name, label, value, options:[{value,label}] }]
 *   onChange(values)  called debounced on search, immediately on select
 */
export function renderFilterBar(host, { search, selects = [], onChange, extraHtml = '' }) {
  const values = {};
  if (search) values.q = search.value || '';
  selects.forEach((s) => { values[s.name] = s.value || ''; });

  host.innerHTML = `
    <div class="flex flex-wrap items-end gap-3">
      ${search ? `<div class="flex-1 min-w-[200px]">
        <label for="fb-search" class="sr-only">${escapeHtml(t('common.search'))}</label>
        <div class="relative">
          <i data-lucide="search" class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"></i>
          <input id="fb-search" type="search" value="${escapeHtml(search.value || '')}" placeholder="${escapeHtml(search.placeholder || t('common.searchPlaceholder'))}"
            class="w-full ${selectCls} pl-9" />
        </div>
      </div>` : ''}
      ${selects.map((s) => `<div>
        <label for="fb-${s.name}" class="sr-only">${escapeHtml(s.label)}</label>
        <select id="fb-${s.name}" data-name="${s.name}" class="${selectCls}">
          <option value="">${escapeHtml(s.placeholder || s.label)}: ${escapeHtml(t('common.all'))}</option>
          ${s.options.map((o) => `<option value="${escapeHtml(o.value)}" ${String(o.value) === String(s.value) ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
        </select>
      </div>`).join('')}
      ${extraHtml}
    </div>`;
  if (window.lucide) window.lucide.createIcons();

  const emit = () => onChange(values);
  const debouncedEmit = debounce(emit, 350);

  if (search) {
    host.querySelector('#fb-search').addEventListener('input', (e) => { values.q = e.target.value; debouncedEmit(); });
  }
  selects.forEach((s) => {
    host.querySelector(`[data-name="${s.name}"]`).addEventListener('change', (e) => { values[s.name] = e.target.value; emit(); });
  });

  return {
    getValues: () => ({ ...values }),
    focusSearch: () => { const el = host.querySelector('#fb-search'); if (el) el.focus(); }
  };
}
