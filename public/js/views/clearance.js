// public/js/views/clearance.js
// End-of-term clearance: students who still hold books or owe fines, and
// students who are cleared (with printable clearance certificates).
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getState } from '../core/store.js';
import { escapeHtml, formatMoney, buildQuery } from '../core/utils.js';
import { pageHeader, card, BTN } from '../components/pageHeader.js';
import { renderFilterBar } from '../components/filterBar.js';
import { renderTabs } from '../components/tabs.js';
import { avatar } from '../components/avatar.js';
import { emptyState } from '../components/emptyState.js';
import { skeletonTable } from '../components/skeleton.js';
import { toast } from '../components/toast.js';
import { printClearanceCertificate, printClearanceCertificatesBulk } from '../print/certificate.js';

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const settings = getState().settings || {};
  const q = { ...ctx.query };
  let activeTab = q.tab === 'cleared' ? 'cleared' : 'pending';
  let data = { pending: [], cleared: [], settings };

  host.innerHTML = '';
  host.appendChild(pageHeader({
    title: t('clearance.title'),
    crumbs: ctx.defaultCrumbs,
    actions: [{ id: 'bulk', label: t('clearance.printBulk'), icon: 'printer', variant: 'outline', onClick: bulkPrint }]
  }));

  const filterHost = document.createElement('div');
  filterHost.className = 'mb-4';
  host.appendChild(filterHost);

  const tabsHost = document.createElement('div');
  tabsHost.className = 'mb-4';
  host.appendChild(tabsHost);

  const listHost = document.createElement('div');
  host.appendChild(listHost);

  const strOpts = (settings.streams || []).map((s) => ({ value: s, label: s }));
  const clsOpts = (settings.classLevels || []).map((c) => ({ value: c, label: c }));
  const dormOpts = (settings.dormitories || []).map((d) => ({ value: d, label: d }));

  renderFilterBar(filterHost, {
    selects: [
      { name: 'classLevel', label: t('members.classLevel'), value: q.classLevel || '', options: clsOpts, placeholder: t('members.classLevel') },
      { name: 'stream', label: t('members.stream'), value: q.stream || '', options: strOpts, placeholder: t('members.stream') },
      { name: 'dormitory', label: t('members.dormitory'), value: q.dormitory || '', options: dormOpts, placeholder: t('members.dormitory') }
    ],
    onChange: (vals) => { Object.assign(q, vals); ctx.setQuery(q); load(); }
  });

  function drawTabs() {
    renderTabs(tabsHost, {
      tabs: [
        { key: 'pending', label: `${t('clearance.pending')} (${data.pending.length})` },
        { key: 'cleared', label: `${t('clearance.cleared')} (${data.cleared.length})` }
      ],
      active: activeTab,
      onChange: (key) => { activeTab = key; q.tab = key; ctx.setQuery(q); drawTabs(); renderList(); }
    });
  }

  async function load() {
    listHost.innerHTML = skeletonTable(6, 3);
    try {
      const res = await api.get('/clearance' + buildQuery({ classLevel: q.classLevel, stream: q.stream, dormitory: q.dormitory }), { signal: ctx.signal });
      data = res.data;
      drawTabs();
      renderList();
    } catch (err) {
      listHost.innerHTML = card(`<p class="text-sm text-danger">${escapeHtml(err.message)}</p>`);
    }
  }

  function renderList() {
    const rows = activeTab === 'cleared' ? data.cleared : data.pending;
    if (!rows.length) {
      listHost.innerHTML = emptyState({
        title: activeTab === 'cleared' ? t('clearance.emptyCleared') : t('clearance.emptyPending'),
        icon: activeTab === 'cleared' ? 'check-circle' : 'clipboard-check'
      });
      return;
    }

    listHost.innerHTML = card(`
      <ul class="divide-y divide-slate-100 dark:divide-slate-700">
        ${rows.map((r) => {
          const m = r.member;
          const detail = activeTab === 'cleared'
            ? `<span class="text-success text-sm font-medium">${escapeHtml(t('clearance.cleared'))}</span>`
            : `<div class="flex flex-wrap gap-2 text-xs">
                ${r.bookCount ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-blue-50 text-blue-700"><i data-lucide="book" class="w-3 h-3"></i>${escapeHtml(t('clearance.holdsBooks', { n: r.bookCount }))}</span>` : ''}
                ${r.fineTotal ? `<span class="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-red-50 text-red-700"><i data-lucide="banknote" class="w-3 h-3"></i>${escapeHtml(t('clearance.owesFines', { amount: formatMoney(r.fineTotal) }))}</span>` : ''}
              </div>`;
          return `<li class="py-3 flex flex-wrap items-center gap-3">
            ${avatar({ src: m.photo, name: m.fullName, size: 'sm' })}
            <div class="min-w-0 flex-1">
              <a href="#/members/${m._id}" class="font-medium text-slate-800 dark:text-slate-100 hover:text-primary">${escapeHtml(m.fullName)}</a>
              <p class="text-xs text-slate-400">${escapeHtml(m.admissionNo)}${m.classLevel ? ' · ' + escapeHtml(m.classLevel) : ''}${m.stream ? ' ' + escapeHtml(m.stream) : ''}${m.dormitory ? ' · ' + escapeHtml(m.dormitory) : ''}</p>
              ${activeTab === 'pending' && r.books && r.books.length ? `<p class="text-xs text-slate-400 mt-0.5 truncate">${escapeHtml(r.books.join(', '))}</p>` : ''}
            </div>
            <div class="flex items-center gap-3">
              ${detail}
              ${activeTab === 'cleared' ? `<button class="${BTN.outline}" data-cert="${m._id}"><i data-lucide="printer" class="w-4 h-4"></i>${escapeHtml(t('clearance.printCert'))}</button>` : ''}
            </div>
          </li>`;
        }).join('')}
      </ul>`);
    if (window.lucide) window.lucide.createIcons();

    listHost.querySelectorAll('[data-cert]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try { await printClearanceCertificate(btn.getAttribute('data-cert')); }
        catch (err) { toast(err.message, 'error'); }
      });
    });
  }

  function bulkPrint() {
    const members = data.cleared.map((r) => r.member);
    if (!members.length) { toast(t('clearance.emptyCleared'), 'warning'); return; }
    printClearanceCertificatesBulk(members, data.settings || settings);
  }

  drawTabs();
  await load();
  return function unmount() {};
}
