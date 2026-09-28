// public/js/components/globalSearch.js
// Debounced quick-search across books and members with a live dropdown.
import { api } from '../core/api.js';
import { escapeHtml, debounce } from '../core/utils.js';
import { t } from '../core/i18n.js';
import { bookCover, avatar } from './avatar.js';

export function mountGlobalSearch(input, resultsHost) {
  let abort = null;
  let isOpen = false;

  const close = () => { isOpen = false; resultsHost.classList.add('hidden'); resultsHost.innerHTML = ''; };

  const run = debounce(async (q) => {
    if (q.length < 2) { close(); return; }
    if (abort) abort.abort();
    abort = new AbortController();
    try {
      const [books, members] = await Promise.all([
        api.get(`/books?q=${encodeURIComponent(q)}&limit=5`, { signal: abort.signal }),
        api.get(`/members?q=${encodeURIComponent(q)}&limit=5`, { signal: abort.signal })
      ]);
      const b = (books.data && books.data.items) || [];
      const m = (members.data && members.data.items) || [];
      if (!b.length && !m.length) {
        resultsHost.innerHTML = `<div class="px-4 py-6 text-center text-sm text-slate-500">${escapeHtml(t('common.noData'))}</div>`;
        resultsHost.classList.remove('hidden'); isOpen = true; return;
      }
      let html = '';
      if (b.length) {
        html += `<div class="px-3 py-2 text-xs uppercase tracking-wide text-slate-400">${escapeHtml(t('nav.books'))}</div>`;
        html += b.map((x) => `<a href="#/books/${x._id}" class="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50">
            ${bookCover({ src: x.cover, title: x.title, size: 'sm' })}
            <div class="min-w-0"><p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">${escapeHtml(x.title)}</p>
            <p class="text-xs text-slate-400 truncate">${escapeHtml(x.author)} · ${escapeHtml(x.isbn)}</p></div></a>`).join('');
      }
      if (m.length) {
        html += `<div class="px-3 py-2 text-xs uppercase tracking-wide text-slate-400 border-t border-slate-100 dark:border-slate-700">${escapeHtml(t('nav.members'))}</div>`;
        html += m.map((x) => `<a href="#/members/${x._id}" class="flex items-center gap-3 px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-700/50">
            ${avatar({ src: x.photo, name: x.fullName, size: 'sm' })}
            <div class="min-w-0"><p class="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">${escapeHtml(x.fullName)}</p>
            <p class="text-xs text-slate-400 truncate">${escapeHtml(x.admissionNo)} · ${escapeHtml(x.classLevel || '')}</p></div></a>`).join('');
      }
      resultsHost.innerHTML = html;
      resultsHost.classList.remove('hidden');
      isOpen = true;
      if (window.lucide) window.lucide.createIcons();
    } catch (e) {
      if (e.name !== 'AbortError' && e.status !== undefined) { /* 401 handled globally */ }
    }
  }, 300);

  input.addEventListener('input', (e) => run(e.target.value.trim()));
  input.addEventListener('focus', (e) => { if (e.target.value.trim().length >= 2) run(e.target.value.trim()); });

  const onDocClick = (e) => {
    if (isOpen && !resultsHost.contains(e.target) && e.target !== input) close();
  };
  document.addEventListener('click', onDocClick);

  // "/" shortcut focuses the search.
  const onKey = (e) => {
    if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
      e.preventDefault(); input.focus();
    }
    if (e.key === 'Escape' && isOpen) close();
  };
  document.addEventListener('keydown', onKey);

  return function unmount() {
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
    if (abort) abort.abort();
  };
}
