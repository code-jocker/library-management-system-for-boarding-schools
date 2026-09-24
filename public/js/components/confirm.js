// public/js/components/confirm.js
// Required confirmation before any destructive action.
import { openModal, closeModal } from './modal.js';
import { t } from '../core/i18n.js';

/**
 * @param {object} opts { title, message, confirmLabel, cancelLabel, variant }
 * @returns {Promise<boolean>}
 */
export function confirmDialog(opts = {}) {
  const {
    title = t('common.confirm'),
    message = t('common.confirmDelete'),
    confirmLabel = t('common.delete'),
    cancelLabel = t('common.cancel'),
    variant = 'danger'
  } = opts;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (val) => { if (!settled) { settled = true; resolve(val); } };

    const id = openModal({
      title,
      size: 'sm',
      body: `<p class="text-slate-600 dark:text-slate-300 text-sm">${message}</p>`,
      actions: [
        { label: cancelLabel, variant: 'ghost', onClick: (el) => { closeModal(id); finish(false); } },
        { label: confirmLabel, variant, onClick: (el) => { closeModal(id); finish(true); } }
      ],
      dismissible: true
    });
    // If closed via backdrop/Esc, treat as cancel.
    const obs = new MutationObserver(() => {
      if (!document.getElementById(id)) { finish(false); obs.disconnect(); }
    });
    obs.observe(document.getElementById('modal-root'), { childList: true });
  });
}

export default confirmDialog;
