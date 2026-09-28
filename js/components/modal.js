// public/js/components/modal.js
// Accessible modal: focus trap, Esc to close, restored focus on close.
import { uid } from '../core/utils.js';

const stack = [];
let lastFocused = null;

/**
 * @param {object} opts
 *  title, body (HTML string), actions [{label, variant, onClick, id}],
 *  size ('sm'|'md'|'lg'|'xl'), dismissible (bool), onOpen(el)
 * @returns {string} modal id
 */
export function openModal(opts = {}) {
  const id = uid('modal');
  const {
    title = '',
    body = '',
    actions = [],
    size = 'md',
    dismissible = true,
    onOpen
  } = opts;

  if (!lastFocused) lastFocused = document.activeElement;

  const sizeClass = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl', xl: 'max-w-4xl' }[size] || 'max-w-lg';

  const overlay = document.createElement('div');
  overlay.id = id;
  overlay.className = 'fixed inset-0 z-[9000] flex items-center justify-center p-4';
  overlay.innerHTML = `
    <div class="absolute inset-0 bg-slate-900/50 backdrop-blur-sm modal-backdrop"></div>
    <div class="relative w-full ${sizeClass} bg-white dark:bg-slate-800 rounded-card shadow-card max-h-[90vh] flex flex-col" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="flex items-start justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-700">
        <h2 class="font-heading font-semibold text-lg text-slate-800 dark:text-slate-100">${title}</h2>
        ${dismissible ? '<button class="modal-close text-slate-400 hover:text-slate-600 dark:hover:text-slate-200" aria-label="Close"><i data-lucide="x" class="w-5 h-5"></i></button>' : ''}
      </div>
      <div class="px-5 py-4 overflow-y-auto flex-1 modal-body">${body}</div>
      ${actions.length ? `<div class="flex flex-wrap justify-end gap-2 px-5 py-4 border-t border-slate-200 dark:border-slate-700 modal-actions"></div>` : ''}
    </div>`;

  document.getElementById('modal-root').appendChild(overlay);
  if (window.lucide) window.lucide.createIcons();

  // Build action buttons.
  if (actions.length) {
    const actionsEl = overlay.querySelector('.modal-actions');
    actions.forEach((a) => {
      const btn = document.createElement('button');
      btn.className = btnClass(a.variant);
      btn.textContent = a.label;
      if (a.id) btn.id = a.id;
      btn.addEventListener('click', () => a.onClick && a.onClick(overlay, btn));
      actionsEl.appendChild(btn);
    });
  }

  // Backdrop click + Esc close (if dismissible).
  if (dismissible) {
    overlay.querySelector('.modal-backdrop').addEventListener('click', () => closeModal(id));
    const closeBtn = overlay.querySelector('.modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => closeModal(id));
  }
  overlay._keyHandler = (e) => {
    if (e.key === 'Escape' && dismissible) { e.stopPropagation(); closeModal(id); }
    if (e.key === 'Tab') trapFocus(overlay, e);
  };
  document.addEventListener('keydown', overlay._keyHandler);

  stack.push(id);
  // Focus first input or the dialog.
  const focusTarget = overlay.querySelector('input,select,textarea,button.modal-close') || overlay.querySelector('[role="dialog"]');
  if (focusTarget) focusTarget.focus();
  if (onOpen) onOpen(overlay);
  return id;
}

function btnClass(variant) {
  const base = 'px-4 py-2 rounded-input font-medium text-sm transition-colors min-h-[44px] w-full sm:w-auto';
  if (variant === 'primary') return `${base} bg-primary text-white hover:bg-primary-700`;
  if (variant === 'danger') return `${base} bg-danger text-white hover:bg-red-700`;
  if (variant === 'success') return `${base} bg-success text-white hover:bg-green-700`;
  if (variant === 'secondary') return `${base} bg-secondary text-white hover:bg-secondary-600`;
  return `${base} bg-slate-100 text-slate-700 hover:bg-slate-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600`;
}

export function getModalEl(id) {
  return document.getElementById(id);
}

export function closeModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  document.removeEventListener('keydown', el._keyHandler);
  el.remove();
  const idx = stack.indexOf(id);
  if (idx > -1) stack.splice(idx, 1);
  if (stack.length === 0 && lastFocused) {
    try { lastFocused.focus(); } catch {}
    lastFocused = null;
  }
}

export function closeAllModals() {
  [...stack].forEach(closeModal);
  stack.length = 0;
}

function trapFocus(container, e) {
  const focusables = container.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])');
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}
