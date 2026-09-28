// public/js/views/settings.js
// Library settings (school details, circulation rules, lists) plus an
// activity-log viewer. Settings are cached in the API client and mirrored
// into the global store, so both are refreshed after a save.
import { api, invalidateCache } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getState, set } from '../core/store.js';
import { escapeHtml, compressImage, buildQuery, formatDateTime } from '../core/utils.js';
import { pageHeader, card, BTN } from '../components/pageHeader.js';
import { renderTabs } from '../components/tabs.js';
import { formField, readForm, applyFieldErrors, clearErrors } from '../components/formField.js';
import { renderFilterBar } from '../components/filterBar.js';
import { dataTable } from '../components/dataTable.js';
import { skeletonTable } from '../components/skeleton.js';
import { badge } from '../components/badge.js';
import { toast } from '../components/toast.js';

const f = formField;
const LANGS = [{ value: 'en', label: 'English' }, { value: 'rw', label: 'Ikinyarwanda' }];

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const q = { ...ctx.query };
  let activeTab = q.tab === 'activity' ? 'activity' : 'settings';
  let settings = getState().settings ? { ...getState().settings } : null;

  host.innerHTML = '';
  host.appendChild(pageHeader({ title: t('settings.title'), crumbs: ctx.defaultCrumbs }));

  const tabsHost = document.createElement('div');
  tabsHost.className = 'mb-4';
  host.appendChild(tabsHost);
  const body = document.createElement('div');
  host.appendChild(body);

  function drawTabs() {
    renderTabs(tabsHost, {
      tabs: [{ key: 'settings', label: t('settings.title') }, { key: 'activity', label: t('settings.activityLog') }],
      active: activeTab,
      onChange: (key) => { activeTab = key; q.tab = key; ctx.setQuery(q); drawTabs(); show(); }
    });
  }

  async function show() {
    if (activeTab === 'settings') renderSettings();
    else renderActivity();
  }

  // ---------- Settings form ----------
  function renderSettings() {
    if (!settings) { body.innerHTML = card(`<p class="text-sm text-slate-400">${escapeHtml(t('common.loading'))}</p>`); return; }
    const s = settings;
    body.innerHTML = `
      <form id="settings-form" novalidate class="space-y-4">
        ${card(`<h2 class="font-heading font-semibold text-lg mb-4 text-slate-800 dark:text-slate-100">${escapeHtml(t('settings.school'))}</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            ${f.text({ name: 'schoolName', label: t('settings.schoolName'), value: s.schoolName || '', required: true })}
            ${f.text({ name: 'motto', label: t('settings.motto'), value: s.motto || '' })}
            ${f.textarea({ name: 'address', label: t('settings.address'), value: s.address || '', rows: 2 })}
            <div class="space-y-4">
              ${f.text({ name: 'phone', label: t('settings.phone'), value: s.phone || '' })}
              ${f.text({ name: 'email', label: t('settings.email'), value: s.email || '', type: 'email' })}
            </div>
          </div>
          <div class="mt-4 flex items-center gap-4">
            <div id="logo-preview" class="w-20 h-20 rounded-card border border-slate-200 dark:border-slate-600 overflow-hidden bg-slate-50 dark:bg-slate-700 flex items-center justify-center">
              ${s.logo ? `<img src="${escapeHtml(s.logo)}" alt="${escapeHtml(t('settings.logo'))}" class="w-full h-full object-contain" />` : `<i data-lucide="image" class="w-6 h-6 text-slate-300"></i>`}
            </div>
            <div class="flex-1">${f.file({ name: 'logo', label: t('settings.logo'), hint: t('settings.logo') })}</div>
          </div>`)}

        ${card(`<h2 class="font-heading font-semibold text-lg mb-4 text-slate-800 dark:text-slate-100">${escapeHtml(t('settings.academic'))}</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            ${f.text({ name: 'academicYear', label: t('settings.academicYear'), value: s.academicYear || '' })}
            ${f.text({ name: 'term', label: t('settings.term'), value: s.term || '' })}
          </div>`)}

        ${card(`<h2 class="font-heading font-semibold text-lg mb-4 text-slate-800 dark:text-slate-100">${escapeHtml(t('settings.circulation'))}</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            ${f.text({ name: 'loanDays', label: t('settings.loanDays'), value: s.loanDays, type: 'number', min: 1, required: true })}
            ${f.text({ name: 'borrowingLimit', label: t('settings.borrowingLimit'), value: s.borrowingLimit, type: 'number', min: 1, required: true })}
            ${f.text({ name: 'teacherBorrowingLimit', label: t('settings.teacherLimit'), value: s.teacherBorrowingLimit, type: 'number', min: 1 })}
            ${f.text({ name: 'finePerDay', label: t('settings.finePerDay'), value: s.finePerDay, type: 'number', min: 0 })}
            ${f.text({ name: 'currency', label: t('settings.currency'), value: s.currency || '' })}
            ${f.text({ name: 'currencySymbol', label: t('settings.currencySymbol'), value: s.currencySymbol || '' })}
            ${f.text({ name: 'reservationHoldDays', label: t('settings.reservationHoldDays'), value: s.reservationHoldDays, type: 'number', min: 1 })}
            ${f.select({ name: 'defaultLanguage', label: t('settings.defaultLanguage'), value: s.defaultLanguage || 'en', options: LANGS })}
          </div>`)}

        ${card(`<h2 class="font-heading font-semibold text-lg mb-4 text-slate-800 dark:text-slate-100">${escapeHtml(t('settings.lists'))}</h2>
          <div class="space-y-4">
            ${f.text({ name: 'classLevels', label: t('settings.classLevels'), value: (s.classLevels || []).join(', ') })}
            ${f.text({ name: 'streams', label: t('settings.streams'), value: (s.streams || []).join(', ') })}
            ${f.text({ name: 'dormitories', label: t('settings.dormitories'), value: (s.dormitories || []).join(', ') })}
          </div>`)}

        <div class="flex justify-end">
          <button type="submit" id="save-settings" class="${BTN.primary}"><i data-lucide="save" class="w-4 h-4"></i>${escapeHtml(t('common.save'))}</button>
        </div>
      </form>`;
    if (window.lucide) window.lucide.createIcons();

    const form = body.querySelector('#settings-form');
    let logoData = s.logo || '';
    form.querySelector('[name="logo"]').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      try {
        logoData = await compressImage(file, { maxDim: 300, quality: 0.8, targetKB: 120 });
        form.querySelector('#logo-preview').innerHTML = `<img src="${logoData}" alt="${escapeHtml(t('settings.logo'))}" class="w-full h-full object-contain" />`;
      } catch (err) { toast(err.message, 'error'); }
    });

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      clearErrors(form);
      const d = readForm(form);
      const toList = (str) => String(str || '').split(',').map((x) => x.trim()).filter(Boolean);
      const payload = {
        schoolName: d.schoolName, motto: d.motto, address: d.address, phone: d.phone, email: d.email,
        academicYear: d.academicYear, term: d.term,
        loanDays: Number(d.loanDays), borrowingLimit: Number(d.borrowingLimit),
        teacherBorrowingLimit: Number(d.teacherBorrowingLimit), finePerDay: Number(d.finePerDay),
        currency: d.currency, currencySymbol: d.currencySymbol,
        reservationHoldDays: Number(d.reservationHoldDays), defaultLanguage: d.defaultLanguage,
        classLevels: toList(d.classLevels), streams: toList(d.streams), dormitories: toList(d.dormitories),
        logo: logoData
      };
      const btn = form.querySelector('#save-settings');
      btn.disabled = true;
      try {
        const res = await api.put('/settings', payload);
        settings = res.data.settings;
        invalidateCache('/settings');
        set({ settings });
        toast(res.message || t('settings.saved'), 'success');
      } catch (err) {
        if (err.fieldErrors) applyFieldErrors(form, err.fieldErrors);
        else toast(err.message, 'error');
      } finally { btn.disabled = false; }
    });
  }

  // ---------- Activity log ----------
  function renderActivity() {
    body.innerHTML = '';
    const filterHost = document.createElement('div');
    filterHost.className = 'mb-4';
    body.appendChild(filterHost);
    const listHost = document.createElement('div');
    body.appendChild(listHost);
    const aq = { page: 1 };

    renderFilterBar(filterHost, {
      search: { placeholder: t('common.searchPlaceholder'), value: '' },
      selects: [
        { name: 'action', label: t('activity.action'), value: '', options: [] },
        { name: 'entity', label: t('activity.entity'), value: '', options: [] }
      ],
      onChange: (vals) => { Object.assign(aq, vals); aq.page = 1; loadActivity(); }
    });

    async function loadActivity() {
      listHost.innerHTML = skeletonTable(8, 4);
      try {
        const res = await api.get('/activity' + buildQuery({ ...aq, limit: 30 }), { signal: ctx.signal });
        const d = res.data;
        // Populate filter dropdowns once with the distinct values.
        const fb = filterHost;
        fillSelect(fb.querySelector('[data-name="action"]'), d.actions, aq.action);
        fillSelect(fb.querySelector('[data-name="entity"]'), d.entities, aq.entity);

        dataTable(listHost, {
          columns: [
            { key: 'createdAt', label: t('activity.when'), render: (r) => `<span class="text-xs text-slate-500">${escapeHtml(formatDateTime(r.createdAt))}</span>` },
            { key: 'userName', label: t('activity.user'), render: (r) => escapeHtml(r.userName || '') },
            { key: 'action', label: t('activity.action'), render: (r) => badge(r.action, { label: r.action }) },
            { key: 'message', label: t('activity.message'), render: (r) => `<span class="text-sm text-slate-600 dark:text-slate-300">${escapeHtml(r.message || '')}</span>` }
          ],
          rows: d.items,
          page: d.page, pages: d.pages, total: d.total,
          onPage: (p) => { aq.page = p; loadActivity(); },
          empty: { title: t('activity.empty') },
          stackedRender: (r) => `<div class="min-w-0">
            <div class="flex justify-between gap-2"><span class="text-xs text-slate-400">${escapeHtml(formatDateTime(r.createdAt))}</span>${badge(r.action, { label: r.action })}</div>
            <p class="text-sm text-slate-700 dark:text-slate-200 mt-1">${escapeHtml(r.message || '')}</p>
            <p class="text-xs text-slate-400">${escapeHtml(r.userName || '')}</p></div>`
        });
      } catch (err) {
        listHost.innerHTML = card(`<p class="text-sm text-danger">${escapeHtml(err.message)}</p>`);
      }
    }

    function fillSelect(sel, values, current) {
      if (!sel) return;
      const label = sel.options[0] ? sel.options[0].textContent : '';
      sel.innerHTML = `<option value="">${escapeHtml(label)}</option>` +
        (values || []).map((v) => `<option value="${escapeHtml(v)}" ${v === current ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
    }

    loadActivity();
  }

  drawTabs();
  if (!settings) {
    try {
      const res = await api.get('/settings', { signal: ctx.signal });
      settings = res.data.settings;
      set({ settings });
    } catch (err) { toast(err.message, 'error'); }
  }
  await show();

  return function unmount() {};
}
