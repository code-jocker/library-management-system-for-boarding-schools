// public/js/views/changePassword.js
// Forced on first login and available from the profile menu.
import { api } from '../core/api.js';
import { getStoredUser, updateUser } from '../core/auth.js';
import { set } from '../core/store.js';
import { t } from '../core/i18n.js';
import { escapeHtml } from '../core/utils.js';
import { navigate } from '../core/router.js';
import { toast } from '../components/toast.js';

function strength(pw) {
  let score = 0;
  if (pw.length >= 8) score++;
  if (pw.length >= 12) score++;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw)) score++;
  if (/[^A-Za-z0-9]/.test(pw)) score++;
  return Math.min(score, 5);
}

export function mount(ctx) {
  const host = document.getElementById('view-container');
  const user = getStoredUser() || {};
  const forced = !!user.mustChangePassword;

  host.innerHTML = `
    <div class="${forced ? 'min-h-screen flex items-center justify-center p-6 bg-surface dark:bg-slate-900' : 'max-w-lg mx-auto'}">
      <div class="w-full ${forced ? 'max-w-md' : ''}">
        <div class="bg-white dark:bg-slate-800 rounded-card shadow-card p-8">
          <div class="flex items-center gap-3 mb-6">
            <div class="w-11 h-11 rounded-card bg-primary-50 text-primary flex items-center justify-center"><i data-lucide="key-round" class="w-6 h-6"></i></div>
            <h1 class="font-heading text-xl font-semibold text-slate-800 dark:text-slate-100">${escapeHtml(t('auth.changePassword'))}</h1>
          </div>
          ${forced ? `<p class="text-sm text-slate-500 dark:text-slate-400 mb-6">${escapeHtml(t('auth.changePasswordIntro'))}</p>` : ''}

          <form id="pw-form" novalidate>
            <div id="form-error" class="hidden mb-4 p-3 rounded-input bg-red-50 dark:bg-red-900/20 border border-red-200 text-danger text-sm"></div>

            <div class="mb-4">
              <label for="currentPassword" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">${escapeHtml(t('auth.currentPassword'))}</label>
              <input id="currentPassword" name="currentPassword" type="password" autocomplete="current-password" required
                class="w-full rounded-input border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm min-h-[44px]" />
            </div>

            <div class="mb-2">
              <label for="newPassword" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">${escapeHtml(t('auth.newPassword'))}</label>
              <input id="newPassword" name="newPassword" type="password" autocomplete="new-password" required minlength="8"
                class="w-full rounded-input border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm min-h-[44px]" />
              <div class="mt-2 flex gap-1" id="strength-bars">
                ${[0,1,2,3,4].map(() => '<div class="h-1.5 flex-1 rounded bg-slate-200 dark:bg-slate-700"></div>').join('')}
              </div>
              <p class="text-xs text-slate-400 mt-1">${escapeHtml(t('auth.strengthHint'))}</p>
            </div>

            <div class="mb-6">
              <label for="confirmPassword" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">${escapeHtml(t('auth.confirmPassword'))}</label>
              <input id="confirmPassword" name="confirmPassword" type="password" autocomplete="new-password" required
                class="w-full rounded-input border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm min-h-[44px]" />
              <p id="match-msg" class="hidden text-xs text-danger mt-1">${escapeHtml(t('auth.passwordsMustMatch'))}</p>
            </div>

            <div class="flex gap-3">
              ${!forced ? `<button type="button" id="cancel-btn" class="flex-1 px-4 py-3 rounded-input bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-200 font-medium min-h-[44px]">${escapeHtml(t('common.cancel'))}</button>` : ''}
              <button type="submit" id="submit-btn" class="flex-1 px-4 py-3 rounded-input bg-primary text-white font-medium hover:bg-primary-700 min-h-[44px] disabled:opacity-60">${escapeHtml(t('common.save'))}</button>
            </div>
          </form>
        </div>
      </div>
    </div>`;

  if (window.lucide) window.lucide.createIcons();

  const form = host.querySelector('#pw-form');
  const errBox = host.querySelector('#form-error');
  const pw = host.querySelector('#newPassword');
  const confirm = host.querySelector('#confirmPassword');
  const matchMsg = host.querySelector('#match-msg');
  const bars = host.querySelector('#strength-bars').children;

  const colors = ['#DC2626', '#EA580C', '#F59E0B', '#16A34A', '#16A34A'];
  pw.addEventListener('input', () => {
    const sc = strength(pw.value);
    for (let i = 0; i < bars.length; i++) {
      bars[i].style.background = i < sc ? colors[sc - 1] : '';
      bars[i].classList.toggle('bg-slate-200', i >= sc);
    }
    matchMsg.classList.toggle('hidden', confirm.value === '' || confirm.value === pw.value);
  });
  confirm.addEventListener('input', () => {
    matchMsg.classList.toggle('hidden', confirm.value === '' || confirm.value === pw.value);
  });

  if (!forced) host.querySelector('#cancel-btn').addEventListener('click', () => navigate('/profile'));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    if (pw.value.length < 8) { errBox.textContent = t('auth.passwordTooWeak'); errBox.classList.remove('hidden'); return; }
    if (pw.value !== confirm.value) { matchMsg.classList.remove('hidden'); return; }
    const btn = host.querySelector('#submit-btn');
    btn.disabled = true;
    try {
      const res = await api.post('/auth/change-password', { currentPassword: host.querySelector('#currentPassword').value, newPassword: pw.value });
      updateUser(res.data.user);
      set({ user: res.data.user });
      toast(t('auth.passwordChanged'), 'success');
      navigate('/dashboard', { replace: true });
    } catch (err) {
      errBox.textContent = (err.fieldErrors && Object.values(err.fieldErrors)[0]) || err.message || t('errors.generic');
      errBox.classList.remove('hidden');
      btn.disabled = false;
    }
  });

  host.querySelector('#currentPassword').focus();
  return () => {};
}
