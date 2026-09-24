// public/js/components/breadcrumbs.js
import { escapeHtml } from '../core/utils.js';
import { t } from '../core/i18n.js';

/**
 * @param {Array<string|{label,href}>} crumbs  translation keys or {label,href}
 */
export function breadcrumbs(crumbs = []) {
  if (!crumbs.length) return '';
  const parts = crumbs.map((c, i) => {
    const label = typeof c === 'string' ? t(c) : escapeHtml(c.label || '');
    const href = typeof c === 'object' ? c.href : null;
    const isLast = i === crumbs.length - 1;
    if (isLast || !href) {
      return `<span class="text-slate-500 dark:text-slate-400 font-medium">${label}</span>`;
    }
    return `<a href="#${href}" class="text-primary hover:underline">${label}</a>`;
  });
  return `<nav aria-label="Breadcrumb"><ol class="flex items-center gap-2 text-sm flex-wrap">
    ${parts.map((p) => `<li class="flex items-center gap-2">${p}</li>`).join('<li class="text-slate-300"><i data-lucide="chevron-right" class="w-4 h-4"></i></li>')}
  </ol></nav>`;
}
