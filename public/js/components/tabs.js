// public/js/components/tabs.js
import { escapeHtml, uid } from '../core/utils.js';

/**
 * Simple tabs. Renders a tab bar into `host` and calls onChange(key).
 * @param {HTMLElement} host
 * @param {object} o { tabs:[{key,label}], active, onChange }
 */
export function renderTabs(host, { tabs, active, onChange }) {
  const groupId = uid('tabs');
  host.innerHTML = `<div class="flex gap-1 border-b border-slate-200 dark:border-slate-700 overflow-x-auto" role="tablist">
    ${tabs.map((tb) => `<button role="tab" data-key="${escapeHtml(tb.key)}" aria-selected="${tb.key === active}"
      class="px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 -mb-px transition-colors min-h-[44px]
      ${tb.key === active ? 'border-primary text-primary' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'}">${escapeHtml(tb.label)}</button>`).join('')}
  </div>`;
  host.querySelectorAll('button[role="tab"]').forEach((b) => {
    b.addEventListener('click', () => onChange(b.getAttribute('data-key')));
  });
}
