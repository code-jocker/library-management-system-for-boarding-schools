// public/js/components/emptyState.js
import { escapeHtml } from '../core/utils.js';

/**
 * @param {object} o { title, message, icon, actionLabel, actionHref, actionId }
 */
export function emptyState({ title, message = '', icon = 'inbox', actionLabel = '', actionHref = '', actionId = '' }) {
  const svg = `<svg viewBox="0 0 120 90" class="w-32 h-24 text-slate-300 dark:text-slate-600" fill="none" stroke="currentColor" stroke-width="3">
      <rect x="18" y="26" width="84" height="52" rx="6"/>
      <path d="M18 40h84M44 26v52"/>
      <circle cx="70" cy="56" r="9"/>
    </svg>`;
  const action = actionLabel
    ? (actionHref
        ? `<a href="${actionHref}" class="inline-flex items-center gap-2 px-4 py-2 rounded-input bg-primary text-white font-medium hover:bg-primary-700 min-h-[44px]">${escapeHtml(actionLabel)}</a>`
        : `<button data-action="${escapeHtml(actionId)}" class="empty-action inline-flex items-center gap-2 px-4 py-2 rounded-input bg-primary text-white font-medium hover:bg-primary-700 min-h-[44px]">${escapeHtml(actionLabel)}</button>`)
    : '';
  return `
    <div class="flex flex-col items-center justify-center text-center py-14 px-4">
      ${svg}
      <h3 class="mt-4 font-heading font-semibold text-lg text-slate-700 dark:text-slate-200">${escapeHtml(title)}</h3>
      ${message ? `<p class="mt-1 text-sm text-slate-500 dark:text-slate-400 max-w-sm">${escapeHtml(message)}</p>` : ''}
      ${action ? `<div class="mt-5">${action}</div>` : ''}
    </div>`;
}
