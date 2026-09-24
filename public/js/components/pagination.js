// public/js/components/pagination.js
import { t } from '../core/i18n.js';

/**
 * Renders a pagination bar. Calls onChange(page) on click.
 * @param {HTMLElement} host
 * @param {object} o { page, pages, total, onChange }
 */
export function renderPagination(host, { page, pages, total, onChange }) {
  if (!host) return;
  if (pages <= 1) {
    host.innerHTML = total ? `<p class="text-sm text-slate-500 dark:text-slate-400">${t('common.showing')} ${total} ${t('common.results')}</p>` : '';
    return;
  }
  const btn = (label, target, { active = false, disabled = false } = {}) =>
    `<button data-page="${target}" ${disabled ? 'disabled' : ''} class="min-w-[40px] h-10 px-3 rounded-input text-sm font-medium ${active ? 'bg-primary text-white' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}">${label}</button>`;

  let window_ = [];
  const span = 1;
  for (let p = page - span; p <= page + span; p++) if (p >= 1 && p <= pages) window_.push(p);
  if (window_[0] > 1) window_ = [1, '…', ...window_];
  if (window_[window_.length - 1] < pages) window_ = [...window_, '…', pages];

  host.innerHTML = `
    <div class="flex items-center justify-between gap-3 flex-wrap">
      <p class="text-sm text-slate-500 dark:text-slate-400">${t('common.page')} ${page} ${t('common.of')} ${pages} · ${total} ${t('common.results')}</p>
      <div class="flex items-center gap-1">
        ${btn('‹', page - 1, { disabled: page <= 1 })}
        ${window_.map((p) => p === '…' ? `<span class="px-1 text-slate-400">…</span>` : btn(p, p, { active: p === page })).join('')}
        ${btn('›', page + 1, { disabled: page >= pages })}
      </div>
    </div>`;

  host.querySelectorAll('button[data-page]').forEach((b) => {
    b.addEventListener('click', () => {
      const target = parseInt(b.getAttribute('data-page'), 10);
      if (!Number.isNaN(target) && target >= 1 && target <= pages) onChange(target);
    });
  });
}
