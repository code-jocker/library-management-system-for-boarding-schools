// public/js/views/login.js
// Split-screen login. Left: branding. Right: form card.
import { api } from '../core/api.js';
import { setSession } from '../core/auth.js';
import { getState, set } from '../core/store.js';
import { t } from '../core/i18n.js';
import { escapeHtml } from '../core/utils.js';
import { navigate } from '../core/router.js';
import { toast } from '../components/toast.js';

export function mount(ctx) {
  const host = document.getElementById('view-container');
  const s = getState().settings || {};

  host.innerHTML = `
    <div class="min-h-screen grid lg:grid-cols-2">
      <!-- Left: branding -->
      <div class="hidden lg:flex flex-col justify-center items-center bg-primary text-white p-12 relative overflow-hidden">
        <div class="absolute -top-20 -right-20 w-72 h-72 bg-white/5 rounded-full"></div>
        <div class="absolute -bottom-24 -left-16 w-80 h-80 bg-secondary/10 rounded-full"></div>
        <div class="relative text-center max-w-md">
          ${s.logo ? `<img src="${escapeHtml(s.logo)}" alt="" class="w-24 h-24 rounded-card mx-auto mb-6 bg-white/10 p-2 object-contain" />`
                   : `<div class="w-24 h-24 rounded-card mx-auto mb-6 bg-white/15 flex items-center justify-center"><i data-lucide="library" class="w-12 h-12"></i></div>`}
          <h2 class="font-heading text-3xl font-bold mb-2">${escapeHtml(s.schoolName || t('app.name'))}</h2>
          <p class="text-white/70 text-lg mb-8">${escapeHtml(s.motto || t('app.motto'))}</p>
          <svg viewBox="0 0 200 120" class="w-full max-w-xs mx-auto text-white/30" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="20" y="30" width="160" height="70" rx="6"/>
            <path d="M20 50h160M60 30v70M100 30v70M140 30v70"/>
            <path d="M70 20h60l10 10H60z"/>
          </svg>
          <p class="text-white/60 text-sm mt-8">${escapeHtml(t('app.tagline'))}</p>
        </div>
      </div>

      <!-- Right: form -->
      <div class="flex items-center justify-center p-6 bg-surface dark:bg-slate-900">
        <div class="w-full max-w-md">
          <div class="bg-white dark:bg-slate-800 rounded-card shadow-card p-8">
            <div class="text-center mb-8">
              ${s.logo ? `<img src="${escapeHtml(s.logo)}" alt="" class="w-16 h-16 rounded-card mx-auto mb-3 object-contain lg:hidden" />` : ''}
              <h1 class="font-heading text-2xl font-semibold text-slate-800 dark:text-slate-100">${escapeHtml(t('app.name'))}</h1>
              <p class="text-slate-500 dark:text-slate-400 text-sm mt-1">${escapeHtml(t('auth.loginTitle'))}</p>
            </div>

            <form id="login-form" novalidate>
              <div id="form-error" class="hidden mb-4 p-3 rounded-input bg-red-50 dark:bg-red-900/20 border border-red-200 text-danger text-sm"></div>

              <div class="mb-4">
                <label for="username" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">${escapeHtml(t('auth.username'))}</label>
                <input id="username" name="username" type="text" autocomplete="username" required
                  class="w-full rounded-input border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 text-sm min-h-[44px] focus:border-primary focus:ring-2 focus:ring-primary/20" />
              </div>

              <div class="mb-4">
                <label for="password" class="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">${escapeHtml(t('auth.password'))}</label>
                <div class="relative">
                  <input id="password" name="password" type="password" autocomplete="current-password" required
                    class="w-full rounded-input border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 px-3 py-2.5 pr-11 text-sm min-h-[44px] focus:border-primary focus:ring-2 focus:ring-primary/20" />
                  <button type="button" id="toggle-pw" class="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 p-1" aria-label="${escapeHtml(t('auth.showPassword'))}">
                    <i data-lucide="eye" class="w-5 h-5"></i>
                  </button>
                </div>
              </div>

              <label class="flex items-center gap-2 mb-6 text-sm text-slate-600 dark:text-slate-300">
                <input id="remember" type="checkbox" class="w-4 h-4 rounded border-slate-300 text-primary focus:ring-primary" />
                ${escapeHtml(t('auth.rememberMe'))}
              </label>

              <button id="submit-btn" type="submit" class="w-full inline-flex justify-center items-center gap-2 px-4 py-3 rounded-input bg-primary text-white font-medium hover:bg-primary-700 min-h-[44px] disabled:opacity-60">
                <span id="btn-label">${escapeHtml(t('auth.signIn'))}</span>
                <i data-lucide="loader-2" class="w-4 h-4 hidden animate-spin" id="btn-spin"></i>
              </button>
            </form>
          </div>
          <p class="text-center text-xs text-slate-400 mt-6">${escapeHtml(t('auth.librarian'))} · ${escapeHtml(s.schoolName || '')}</p>
        </div>
      </div>
    </div>`;

  if (window.lucide) window.lucide.createIcons();

  const form = host.querySelector('#login-form');
  const errBox = host.querySelector('#form-error');
  const btn = host.querySelector('#submit-btn');
  const spin = host.querySelector('#btn-spin');
  const label = host.querySelector('#btn-label');

  // Show/hide password.
  host.querySelector('#toggle-pw').addEventListener('click', () => {
    const pw = host.querySelector('#password');
    const isPw = pw.type === 'password';
    pw.type = isPw ? 'text' : 'password';
    host.querySelector('#toggle-pw i').setAttribute('data-lucide', isPw ? 'eye-off' : 'eye');
    if (window.lucide) window.lucide.createIcons();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    errBox.classList.add('hidden');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', {
        username: host.querySelector('#username').value.trim(),
        password: host.querySelector('#password').value
      });
      setSession(res.data.token, res.data.user, host.querySelector('#remember').checked);
      set({ user: res.data.user });
      toast(`${t('auth.welcome')}, ${res.data.user.fullName}`, 'success');
      navigate(res.data.user.mustChangePassword ? '/change-password' : '/dashboard', { replace: true });
    } catch (err) {
      errBox.textContent = err.message || t('errors.generic');
      errBox.classList.remove('hidden');
      setLoading(false);
    }
  });

  function setLoading(on) {
    btn.disabled = on;
    spin.classList.toggle('hidden', !on);
    label.textContent = on ? t('auth.signingIn') : t('auth.signIn');
  }

  host.querySelector('#username').focus();

  return () => {}; // no timers/charts to clean up
}
