// public/js/views/profile.js
// Librarian profile (contact details + photo) and change password.
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getState } from '../core/store.js';
import { updateUser } from '../core/auth.js';
import { escapeHtml, compressImage } from '../core/utils.js';
import { pageHeader, card, BTN } from '../components/pageHeader.js';
import { formField, readForm, applyFieldErrors, clearErrors, setFieldError } from '../components/formField.js';
import { avatar } from '../components/avatar.js';
import { toast } from '../components/toast.js';

const f = formField;

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const user = getState().user || {};

  host.innerHTML = '';
  host.appendChild(pageHeader({ title: t('profile.title'), crumbs: ctx.defaultCrumbs }));

  const grid = document.createElement('div');
  grid.className = 'grid grid-cols-1 lg:grid-cols-2 gap-4';
  host.appendChild(grid);

  // ---- Profile details ----
  grid.innerHTML = `
    ${card(`<div class="flex items-center gap-4 mb-5">
        <div id="pf-avatar">${avatar({ src: user.avatar, name: user.fullName, size: 'lg' })}</div>
        <div class="flex-1">
          <h2 class="font-heading font-semibold text-lg text-slate-800 dark:text-slate-100">${escapeHtml(user.fullName || '')}</h2>
          <p class="text-sm text-slate-400">${escapeHtml(user.username || '')} · ${escapeHtml(t('auth.librarian'))}</p>
        </div>
      </div>
      <form id="profile-form" novalidate class="space-y-4">
        ${f.text({ name: 'fullName', label: t('profile.fullName'), value: user.fullName || '', required: true })}
        ${f.text({ name: 'email', label: t('profile.email'), value: user.email || '', type: 'email' })}
        ${f.text({ name: 'phone', label: t('profile.phone'), value: user.phone || '' })}
        ${f.file({ name: 'avatar', label: t('profile.avatar') })}
        <div class="flex justify-end">
          <button type="submit" id="save-profile" class="${BTN.primary}"><i data-lucide="save" class="w-4 h-4"></i>${escapeHtml(t('common.save'))}</button>
        </div>
      </form>`)}

    ${card(`<h2 class="font-heading font-semibold text-lg mb-4 text-slate-800 dark:text-slate-100">${escapeHtml(t('profile.changePassword'))}</h2>
      <form id="pw-form" novalidate class="space-y-4">
        <p class="text-sm text-slate-500 dark:text-slate-400">${escapeHtml(t('auth.strengthHint'))}</p>
        ${f.text({ name: 'currentPassword', label: t('auth.currentPassword'), type: 'password', required: true })}
        ${f.text({ name: 'newPassword', label: t('auth.newPassword'), type: 'password', required: true })}
        ${f.text({ name: 'confirmPassword', label: t('auth.confirmPassword'), type: 'password', required: true })}
        <div class="flex justify-end">
          <button type="submit" id="save-pw" class="${BTN.primary}"><i data-lucide="key-round" class="w-4 h-4"></i>${escapeHtml(t('auth.changePassword'))}</button>
        </div>
      </form>`)}`;
  if (window.lucide) window.lucide.createIcons();

  // ---- Profile submit ----
  const pform = grid.querySelector('#profile-form');
  let avatarData = user.avatar || '';
  pform.querySelector('[name="avatar"]').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      avatarData = await compressImage(file, { maxDim: 300, quality: 0.8, targetKB: 120 });
      grid.querySelector('#pf-avatar').innerHTML = avatar({ src: avatarData, name: user.fullName, size: 'lg' });
    } catch (err) { toast(err.message, 'error'); }
  });

  pform.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(pform);
    const d = readForm(pform);
    const btn = grid.querySelector('#save-profile');
    btn.disabled = true;
    try {
      const res = await api.put('/auth/profile', { fullName: d.fullName, email: d.email, phone: d.phone, avatar: avatarData });
      updateUser(res.data.user);
      toast(res.message || t('profile.saved'), 'success');
    } catch (err) {
      if (err.fieldErrors) applyFieldErrors(pform, err.fieldErrors);
      else toast(err.message, 'error');
    } finally { btn.disabled = false; }
  });

  // ---- Password submit ----
  const wform = grid.querySelector('#pw-form');
  wform.addEventListener('submit', async (e) => {
    e.preventDefault();
    clearErrors(wform);
    const d = readForm(wform);
    if (d.newPassword !== d.confirmPassword) {
      setFieldError(wform, 'confirmPassword', t('auth.passwordsMustMatch'));
      return;
    }
    if ((d.newPassword || '').length < 8) {
      setFieldError(wform, 'newPassword', t('auth.passwordTooWeak'));
      return;
    }
    const btn = grid.querySelector('#save-pw');
    btn.disabled = true;
    try {
      await api.post('/auth/change-password', { currentPassword: d.currentPassword, newPassword: d.newPassword });
      toast(t('auth.passwordChanged'), 'success');
      wform.reset();
    } catch (err) {
      if (err.fieldErrors) applyFieldErrors(wform, err.fieldErrors);
      else toast(err.message, 'error');
    } finally { btn.disabled = false; }
  });

  return function unmount() {};
}
