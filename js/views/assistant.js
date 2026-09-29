// public/js/views/assistant.js
// Library assistant: a chat surface over POST /api/assistant/chat.
// Conversation is kept in sessionStorage so it survives a view switch but not
// a browser restart. Answers come from the database; no API key required.
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getState } from '../core/store.js';
import { escapeHtml, uid } from '../core/utils.js';
import { pageHeader } from '../components/pageHeader.js';
import { toast } from '../components/toast.js';

const STORE_KEY = 'lms.assistant.thread';
const HISTORY_LIMIT = 40;

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const user = getState().user;

  host.innerHTML = '';
  host.appendChild(pageHeader({
    title: t('assistant.title'),
    crumbs: ctx.defaultCrumbs,
    actions: [
      { id: 'asst-clear', label: t('assistant.clear'), icon: 'eraser', variant: 'outline', onClick: clearThread }
    ]
  }));

  host.insertAdjacentHTML('beforeend', `
    <p class="text-sm text-slate-500 dark:text-slate-400 mb-4 max-w-2xl">${escapeHtml(t('assistant.intro'))}</p>
    <div class="bg-white dark:bg-slate-800 rounded-card shadow-soft flex flex-col overflow-hidden"
         style="height:calc(100vh - 20rem);min-height:24rem">
      <div id="asst-log" class="flex-1 overflow-y-auto scroll-slim p-4 space-y-4" role="log" aria-live="polite" aria-label="${escapeHtml(t('assistant.title'))}"></div>
      <div id="asst-suggest" class="px-4 pb-2 flex flex-wrap gap-2"></div>
      <form id="asst-form" class="border-t border-slate-200 dark:border-slate-700 p-3 flex items-end gap-2">
        <label for="asst-input" class="sr-only">${escapeHtml(t('assistant.placeholder'))}</label>
        <input id="asst-input" type="text" autocomplete="off" maxlength="1000"
          placeholder="${escapeHtml(t('assistant.placeholder'))}"
          class="flex-1 rounded-input border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2.5 text-sm min-h-[44px] text-slate-800 dark:text-slate-100" />
        <button type="submit" class="inline-flex items-center gap-2 px-4 py-2.5 rounded-input text-sm font-medium min-h-[44px] bg-primary text-white hover:bg-primary-700 disabled:opacity-50">
          <i data-lucide="send" class="w-4 h-4"></i>${escapeHtml(t('assistant.send'))}
        </button>
      </form>
    </div>`);

  const log = host.querySelector('#asst-log');
  const form = host.querySelector('#asst-form');
  const input = host.querySelector('#asst-input');
  const suggest = host.querySelector('#asst-suggest');
  const sendBtn = form.querySelector('button[type="submit"]');
  if (window.lucide) window.lucide.createIcons();

  let thread = loadThread();
  let busy = false;
  if (ctx.signal) ctx.signal.addEventListener('abort', () => { busy = false; }, { once: true });

  // First run: greet the librarian so the panel is never an empty box.
  if (!thread.length) {
    await ask('', { silent: true });
  } else {
    thread.forEach(renderMessage);
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = '';
    ask(text);
  });

  // Enter sends, Shift+Enter is not needed in a single-line input.
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { input.value = ''; }
  });

  renderSuggestions(suggest, (s) => { input.value = s; ask(s); });

  function renderMessage(m) {
    const wrap = document.createElement('div');
    if (m.role === 'user') {
      wrap.className = 'flex justify-end';
      wrap.innerHTML = `<div class="max-w-[85%] rounded-input rounded-br-sm bg-primary text-white px-4 py-2.5 text-sm whitespace-pre-wrap break-words">${escapeHtml(m.content)}</div>`;
    } else {
      wrap.className = 'flex justify-start';
      const books = (m.payload && m.payload.books) || [];
      const bookChips = books.length
        ? `<div class="mt-2 flex flex-wrap gap-2">${books.map((b) =>
            `<a href="#/books/${escapeHtml(b._id)}" class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-input bg-slate-100 dark:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600">
               <i data-lucide="book-open" class="w-3.5 h-3.5"></i>${escapeHtml(b.title)}
             </a>`).join('')}</div>`
        : '';
      wrap.innerHTML = `
        <div class="max-w-[85%] rounded-input rounded-bl-sm bg-slate-100 dark:bg-slate-700 px-4 py-2.5 text-sm text-slate-800 dark:text-slate-100">
          <div class="whitespace-pre-wrap break-words">${escapeHtml(m.content)}</div>
          ${bookChips}
        </div>`;
    }
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    if (window.lucide) window.lucide.createIcons();
  }

  function setBusy(on) {
    busy = on;
    sendBtn.disabled = on;
    input.disabled = on;
    if (on) {
      const dots = document.createElement('div');
      dots.id = 'asst-typing';
      dots.className = 'flex justify-start';
      dots.innerHTML = `<div class="rounded-input rounded-bl-sm bg-slate-100 dark:bg-slate-700 px-4 py-3 flex items-center gap-1">
        <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce"></span>
        <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style="animation-delay:.15s"></span>
        <span class="w-1.5 h-1.5 rounded-full bg-slate-400 animate-bounce" style="animation-delay:.3s"></span>
      </div>`;
      log.appendChild(dots);
      log.scrollTop = log.scrollHeight;
    } else {
      const dots = document.getElementById('asst-typing');
      if (dots) dots.remove();
    }
  }

  async function ask(text, { silent = false } = {}) {
    if (text) {
      thread.push({ id: uid('m'), role: 'user', content: text });
      renderMessage(thread[thread.length - 1]);
    }
    setBusy(true);
    try {
      const res = await api.post('/assistant/chat', {
        message: text || 'hello',
        admissionNo: (user && user.username) || ''
      }, { signal: ctx.signal });

      const data = (res && res.data) || {};
      const answer = data.answer || res.message || t('assistant.error');
      thread.push({ id: uid('m'), role: 'assistant', content: answer, payload: data.payload || null, suggestions: data.suggestions || [] });
      thread = thread.slice(-HISTORY_LIMIT);
      if (!silent) saveThread(thread);
      renderMessage(thread[thread.length - 1]);
      renderSuggestions(suggest, (s) => { input.value = s; ask(s); });
    } catch (err) {
      const msg = err && err.status === 429 ? t('assistant.tooMany') : (err && err.message) || t('assistant.error');
      thread.push({ id: uid('m'), role: 'assistant', content: msg, payload: null, suggestions: [] });
      renderMessage(thread[thread.length - 1]);
      if (!silent) toast(msg, 'error');
    } finally {
      setBusy(false);
      input.focus();
    }
  }

  function renderSuggestions(host2, onPick) {
    const last = [...thread].reverse().find((m) => m.role === 'assistant' && m.suggestions);
    const items = (last && last.suggestions) || t('assistant.defaultSuggestions');
    host2.innerHTML = items
      .map((s) => `<button type="button" class="px-3 py-1.5 rounded-full bg-slate-100 dark:bg-slate-700 text-xs font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-600">${escapeHtml(s)}</button>`)
      .join('');
    host2.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => onPick(b.textContent)));
  }

  function clearThread() {
    thread = [];
    saveThread(thread);
    log.innerHTML = '';
    ask('', { silent: true });
    input.focus();
  }

  return function unmount() {
    saveThread(thread);
  };
}

function loadThread() {
  try {
    const raw = sessionStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveThread(thread) {
  try {
    sessionStorage.setItem(STORE_KEY, JSON.stringify(thread));
  } catch {
    // A full or blocked sessionStorage must not break the chat.
  }
}
