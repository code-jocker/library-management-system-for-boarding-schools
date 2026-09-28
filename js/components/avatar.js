// public/js/components/avatar.js
import { escapeHtml, initials } from '../core/utils.js';

const SIZES = { xs: 'w-7 h-7 text-xs', sm: 'w-9 h-9 text-sm', md: 'w-12 h-12 text-base', lg: 'w-20 h-20 text-2xl' };

/**
 * Photo or initials fallback.
 * @param {object} o { src, name, size }
 */
export function avatar({ src, name = '', size = 'md' }) {
  const cls = SIZES[size] || SIZES.md;
  if (src) {
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(name)}" loading="lazy" class="${cls} rounded-full object-cover border border-slate-200 dark:border-slate-600" />`;
  }
  return `<span class="${cls} rounded-full bg-primary text-white flex items-center justify-center font-semibold flex-shrink-0" aria-label="${escapeHtml(name)}">${escapeHtml(initials(name))}</span>`;
}

// Book cover with placeholder fallback.
export function bookCover({ src, title = '', size = 'md' }) {
  const dims = { sm: 'w-10 h-14', md: 'w-14 h-20', lg: 'w-24 h-32' }[size] || 'w-14 h-20';
  if (src) {
    return `<img src="${escapeHtml(src)}" alt="${escapeHtml(title)}" loading="lazy" class="${dims} rounded object-cover border border-slate-200 dark:border-slate-600 bg-slate-100" />`;
  }
  return `<div class="${dims} rounded border border-slate-200 dark:border-slate-600 bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-400">
      <i data-lucide="book" class="w-6 h-6"></i>
    </div>`;
}
