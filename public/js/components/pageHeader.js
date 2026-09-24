// public/js/components/pageHeader.js
// Shared page heading + action buttons + breadcrumb wiring for views.
import { escapeHtml } from '../core/utils.js';

/**
 * @param {object} o
 *  title, crumbs (array), actions: [{ label, icon, variant, onClick, id, href }]
 * @returns {HTMLElement} the header element (already appended to nothing)
 */
export function pageHeader({ title, crumbs = [], actions = [] }) {
  const el = document.createElement('div');
  el.className = 'mb-5';
  const btnCls = (v) => {
    const base = 'inline-flex items-center gap-2 px-4 py-2.5 rounded-input text-sm font-medium min-h-[44px] transition-colors';
    if (v === 'primary') return `${base} bg-primary text-white hover:bg-primary-700`;
    if (v === 'secondary') return `${base} bg-secondary text-white hover:bg-secondary-600`;
    if (v === 'danger') return `${base} bg-danger text-white hover:bg-red-700`;
    if (v === 'outline') return `${base} border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700`;
    return `${base} bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200`;
  };

  el.innerHTML = `
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h1 data-page-heading class="font-heading font-semibold text-2xl text-slate-800 dark:text-slate-100">${escapeHtml(title)}</h1>
      <div class="flex flex-wrap items-center gap-2">
        ${actions.map((a) => a.href
          ? `<a href="${escapeHtml(a.href)}" class="${btnCls(a.variant)}">${a.icon ? `<i data-lucide="${a.icon}" class="w-4 h-4"></i>` : ''}${escapeHtml(a.label)}</a>`
          : `<button ${a.id ? `id="${a.id}"` : ''} data-action="${escapeHtml(a.id || '')}" class="${btnCls(a.variant)}">${a.icon ? `<i data-lucide="${a.icon}" class="w-4 h-4"></i>` : ''}${escapeHtml(a.label)}</button>`
        ).join('')}
      </div>
    </div>`;
  if (window.lucide) window.lucide.createIcons();

  // Wire action clicks.
  actions.forEach((a) => {
    if (a.href || !a.onClick) return;
    const btn = el.querySelector(`[data-action="${a.id || ''}"]`);
    if (btn) btn.addEventListener('click', a.onClick);
  });

  // Set breadcrumbs via the global hook installed by shell.js.
  if (window.__setCrumbs && crumbs.length) window.__setCrumbs(crumbs);
  return el;
}

// A simple section card wrapper.
export function card(innerHtml, { padding = true, className = '' } = {}) {
  return `<div class="bg-white dark:bg-slate-800 rounded-card shadow-soft ${padding ? 'p-5' : ''} ${className}">${innerHtml}</div>`;
}

// Standard primary/ghost button classes reused across views.
export const BTN = {
  primary: 'inline-flex items-center gap-2 px-4 py-2.5 rounded-input text-sm font-medium min-h-[44px] bg-primary text-white hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed',
  secondary: 'inline-flex items-center gap-2 px-4 py-2.5 rounded-input text-sm font-medium min-h-[44px] bg-secondary text-white hover:bg-secondary-600 disabled:opacity-50',
  danger: 'inline-flex items-center gap-2 px-4 py-2.5 rounded-input text-sm font-medium min-h-[44px] bg-danger text-white hover:bg-red-700 disabled:opacity-50',
  outline: 'inline-flex items-center gap-2 px-4 py-2.5 rounded-input text-sm font-medium min-h-[44px] border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700',
  ghost: 'inline-flex items-center gap-2 px-4 py-2.5 rounded-input text-sm font-medium min-h-[44px] bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200'
};
