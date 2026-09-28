// public/js/components/toast.js
// Lightweight toast notifications rendered into #toast-root.
import { uid } from '../core/utils.js';

const ICONS = {
  success: 'check-circle',
  error: 'alert-circle',
  warning: 'alert-triangle',
  info: 'info'
};
const COLORS = {
  success: 'border-success bg-white dark:bg-slate-800',
  error: 'border-danger bg-white dark:bg-slate-800',
  warning: 'border-warning bg-white dark:bg-slate-800',
  info: 'border-primary bg-white dark:bg-slate-800'
};
const ICON_COLORS = {
  success: 'text-success', error: 'text-danger', warning: 'text-warning', info: 'text-primary'
};

/**
 * @param {string} message
 * @param {'success'|'error'|'warning'|'info'} [type]
 * @param {number} [duration] ms, 0 = sticky
 */
export function toast(message, type = 'success', duration = 3800) {
  const root = document.getElementById('toast-root');
  if (!root) return;
  const id = uid('toast');
  const el = document.createElement('div');
  el.id = id;
  el.className = `pointer-events-auto flex items-start gap-3 border-l-4 rounded-card shadow-card px-4 py-3 ${COLORS[type] || COLORS.info}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.innerHTML = `
    <span class="${ICON_COLORS[type] || ICON_COLORS.info} mt-0.5"><i data-lucide="${ICONS[type] || ICONS.info}" class="w-5 h-5"></i></span>
    <p class="flex-1 text-sm text-slate-700 dark:text-slate-200">${message}</p>
    <button class="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close"><i data-lucide="x" class="w-4 h-4"></i></button>`;
  root.appendChild(el);
  if (window.lucide) window.lucide.createIcons();

  const remove = () => {
    el.style.opacity = '0';
    el.style.transform = 'translateX(12px)';
    el.style.transition = 'all .2s';
    setTimeout(() => el.remove(), 200);
  };
  el.querySelector('button').addEventListener('click', remove);
  if (duration > 0) setTimeout(remove, duration);
  return remove;
}

export const toastSuccess = (m) => toast(m, 'success');
export const toastError = (m) => toast(m, 'error');
export const toastWarning = (m) => toast(m, 'warning');
export const toastInfo = (m) => toast(m, 'info');
