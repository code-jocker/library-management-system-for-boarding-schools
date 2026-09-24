// public/js/views/notFound.js
import { t } from '../core/i18n.js';
import { escapeHtml } from '../core/utils.js';
import { navigate } from '../core/router.js';

export function mount(ctx) {
  const host = document.getElementById('view-container');
  host.innerHTML = `
    <div class="min-h-[60vh] flex flex-col items-center justify-center text-center p-6">
      <svg viewBox="0 0 200 140" class="w-56 text-slate-300 dark:text-slate-600 mb-6" fill="none" stroke="currentColor" stroke-width="3">
        <rect x="40" y="20" width="120" height="90" rx="8"/>
        <path d="M40 45h120M60 20v90"/>
        <circle cx="120" cy="78" r="16"/><path d="M132 90l16 16"/>
      </svg>
      <h1 class="font-heading text-3xl font-bold text-slate-800 dark:text-slate-100 mb-2">404</h1>
      <p class="text-lg text-slate-600 dark:text-slate-300 mb-1">${escapeHtml(t('notFound.title'))}</p>
      <p class="text-sm text-slate-500 dark:text-slate-400 mb-6 max-w-sm">${escapeHtml(t('notFound.message'))}</p>
      <button id="home-btn" class="inline-flex items-center gap-2 px-5 py-3 rounded-input bg-primary text-white font-medium hover:bg-primary-700 min-h-[44px]">
        <i data-lucide="home" class="w-4 h-4"></i>${escapeHtml(t('notFound.goHome'))}
      </button>
    </div>`;
  if (window.lucide) window.lucide.createIcons();
  host.querySelector('#home-btn').addEventListener('click', () => navigate('/dashboard'));
  return () => {};
}
