// public/js/components/statCard.js
import { escapeHtml } from '../core/utils.js';

/**
 * @param {object} o { label, value, icon, tone, sub }
 * tone: 'primary'|'success'|'warning'|'danger'|'info'
 */
export function statCard({ label, value, icon = 'circle', tone = 'primary', sub = '' }) {
  const tones = {
    primary: 'bg-primary-50 text-primary',
    success: 'bg-green-50 text-success',
    warning: 'bg-orange-50 text-warning',
    danger: 'bg-red-50 text-danger',
    info: 'bg-slate-100 text-slate-600'
  };
  const t = tones[tone] || tones.primary;
  return `
    <div class="bg-white dark:bg-slate-800 rounded-card shadow-soft p-5 flex items-center gap-4">
      <div class="w-12 h-12 rounded-card ${t} flex items-center justify-center flex-shrink-0">
        <i data-lucide="${icon}" class="w-6 h-6"></i>
      </div>
      <div class="min-w-0">
        <p class="text-sm text-slate-500 dark:text-slate-400 truncate">${escapeHtml(label)}</p>
        <p class="text-2xl font-heading font-semibold text-slate-800 dark:text-slate-100">${escapeHtml(String(value))}</p>
        ${sub ? `<p class="text-xs text-slate-400 mt-0.5">${escapeHtml(sub)}</p>` : ''}
      </div>
    </div>`;
}
