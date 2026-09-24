// public/js/components/formField.js
// Builds consistent form fields with inline validation messages.
import { escapeHtml, uid } from '../core/utils.js';
import { t } from '../core/i18n.js';

const baseInput = 'w-full rounded-input border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:border-primary focus:ring-2 focus:ring-primary/20 min-h-[44px]';

function label(labelText, id, required) {
  return `<label for="${id}" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">${escapeHtml(labelText)}${required ? ' <span class="text-danger">*</span>' : ''}</label>`;
}

function errorSlot(id) {
  return `<p class="field-error hidden mt-1 text-xs text-danger" id="${id}-error"></p>`;
}

// Wrap a control in a labelled field with an error slot.
function field(labelText, id, controlHtml, required) {
  return `<div class="form-field" data-field="${id}">
    ${labelText ? label(labelText, id, required) : ''}
    ${controlHtml}
    ${errorSlot(id)}
  </div>`;
}

export const formField = {
  text({ name, label: lbl, value = '', placeholder = '', required = false, type = 'text', min, max, step, disabled = false, hint = '' }) {
    const id = name;
    const attrs = [
      `type="${type}"`, `name="${name}"`, `id="${id}"`, `value="${escapeHtml(value)}"`,
      placeholder ? `placeholder="${escapeHtml(placeholder)}"` : '',
      required ? 'required' : '', min != null ? `min="${min}"` : '', max != null ? `max="${max}"` : '',
      step != null ? `step="${step}"` : '', disabled ? 'disabled' : ''
    ].filter(Boolean).join(' ');
    const hintHtml = hint ? `<p class="mt-1 text-xs text-slate-400">${escapeHtml(hint)}</p>` : '';
    return field(lbl, id, `<input class="${baseInput}" ${attrs} />${hintHtml}`, required);
  },
  textarea({ name, label: lbl, value = '', placeholder = '', required = false, rows = 3 }) {
    const id = name;
    return field(lbl, id, `<textarea class="${baseInput}" name="${name}" id="${id}" rows="${rows}" ${required ? 'required' : ''} placeholder="${escapeHtml(placeholder)}">${escapeHtml(value)}</textarea>`, required);
  },
  select({ name, label: lbl, value = '', options = [], required = false, placeholder = '' }) {
    const id = name;
    const opts = [`<option value="">${escapeHtml(placeholder || t('common.selectOption'))}</option>`,
      ...options.map((o) => {
        const val = typeof o === 'string' ? o : o.value;
        const text = typeof o === 'string' ? o : o.label;
        return `<option value="${escapeHtml(val)}" ${String(val) === String(value) ? 'selected' : ''}>${escapeHtml(text)}</option>`;
      })].join('');
    return field(lbl, id, `<select class="${baseInput}" name="${name}" id="${id}" ${required ? 'required' : ''}>${opts}</select>`, required);
  },
  file({ name, label: lbl, accept = 'image/*', hint = '' }) {
    const id = name;
    return field(lbl, id, `<input type="file" accept="${accept}" name="${name}" id="${id}" class="block w-full text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:px-4 file:py-2 file:rounded-input file:border-0 file:bg-primary-50 file:text-primary file:font-medium hover:file:bg-primary-100 file:cursor-pointer" />${hint ? `<p class="mt-1 text-xs text-slate-400">${escapeHtml(hint)}</p>` : ''}`, false);
  },
  checkbox({ name, label: lbl, checked = false }) {
    const id = name;
    return `<div class="flex items-center gap-2">
      <input type="checkbox" id="${id}" name="${name}" ${checked ? 'checked' : ''} class="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary" />
      <label for="${id}" class="text-sm text-slate-700 dark:text-slate-300">${escapeHtml(lbl)}</label>
    </div>`;
  }
};

// Show/clear an inline field error.
export function setFieldError(formEl, name, message) {
  const wrap = formEl.querySelector(`[data-field="${name}"]`);
  if (!wrap) return;
  const err = wrap.querySelector('.field-error');
  const input = wrap.querySelector('input,select,textarea');
  if (message) {
    if (err) { err.textContent = message; err.classList.remove('hidden'); }
    if (input) input.classList.add('border-danger');
  } else {
    if (err) { err.textContent = ''; err.classList.add('hidden'); }
    if (input) input.classList.remove('border-danger');
  }
}

export function clearErrors(formEl) {
  formEl.querySelectorAll('.field-error').forEach((e) => { e.textContent = ''; e.classList.add('hidden'); });
  formEl.querySelectorAll('input,select,textarea').forEach((i) => i.classList.remove('border-danger'));
}

// Apply a fieldErrors map from the API onto a form.
export function applyFieldErrors(formEl, fieldErrors = {}) {
  clearErrors(formEl);
  for (const [k, v] of Object.entries(fieldErrors)) setFieldError(formEl, k, v);
}

// Read all named inputs from a form into a plain object.
export function readForm(formEl) {
  const data = {};
  formEl.querySelectorAll('[name]').forEach((el) => {
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else if (el.type === 'file') { /* handled separately */ }
    else data[el.name] = el.value.trim();
  });
  return data;
}
