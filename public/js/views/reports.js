// public/js/views/reports.js
// Report centre: pick a report, filter by date range / class / term, then
// Print, export PDF or export CSV. The API returns a generic
// { title, columns:[string], rows:[{col:val}] } shape for every report.
import { api } from '../core/api.js';
import { t } from '../core/i18n.js';
import { getState } from '../core/store.js';
import { escapeHtml, buildQuery } from '../core/utils.js';
import { pageHeader, card, BTN } from '../components/pageHeader.js';
import { formField, readForm } from '../components/formField.js';
import { printReport, exportReportPDF, exportReportCSV } from '../print/report.js';

const f = formField;

const REPORTS = [
  { key: 'booksIssued', path: '/reports/books-issued' },
  { key: 'overdue', path: '/reports/overdue' },
  { key: 'finesCollected', path: '/reports/fines-collected' },
  { key: 'mostBorrowed', path: '/reports/most-borrowed' },
  { key: 'unreturnedByClass', path: '/reports/unreturned-by-class' },
  { key: 'inventory', path: '/reports/inventory' },
  { key: 'lostDamaged', path: '/reports/lost-damaged' }
];

export async function mount(ctx) {
  const host = document.getElementById('view-container');
  const settings = getState().settings || {};
  const q = { ...ctx.query };
  let currentReport = null;
  let currentMeta = '';

  host.innerHTML = '';
  host.appendChild(pageHeader({ title: t('reports.title'), crumbs: ctx.defaultCrumbs }));

  const wrap = document.createElement('div');
  wrap.className = 'space-y-4';
  host.appendChild(wrap);

  const classOptions = (settings.classLevels || []).map((c) => ({ value: c, label: c }));

  wrap.innerHTML = `
    ${card(`<form id="report-form" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      ${f.select({ name: 'report', label: t('common.filter'), value: q.report || REPORTS[0].key, options: REPORTS.map((r) => ({ value: r.key, label: t('reports.' + r.key) })), required: true })}
      ${f.text({ name: 'from', label: t('reports.from'), type: 'date', value: q.from || '' })}
      ${f.text({ name: 'to', label: t('reports.to'), type: 'date', value: q.to || '' })}
      ${f.select({ name: 'classLevel', label: t('members.classLevel'), value: q.classLevel || '', options: classOptions, placeholder: t('members.classLevel') })}
      <div class="sm:col-span-2 lg:col-span-4 flex flex-wrap items-center gap-2">
        <button type="submit" id="gen" class="${BTN.primary}"><i data-lucide="play" class="w-4 h-4"></i>${escapeHtml(t('reports.generate'))}</button>
        <button type="button" id="rpt-print" class="${BTN.outline}" disabled><i data-lucide="printer" class="w-4 h-4"></i>${escapeHtml(t('common.print'))}</button>
        <button type="button" id="rpt-pdf" class="${BTN.outline}" disabled><i data-lucide="file-down" class="w-4 h-4"></i>${escapeHtml(t('common.exportPDF'))}</button>
        <button type="button" id="rpt-csv" class="${BTN.outline}" disabled><i data-lucide="download" class="w-4 h-4"></i>${escapeHtml(t('common.exportCSV'))}</button>
      </div>
    </form>`)}
    <div id="report-out"></div>`;
  if (window.lucide) window.lucide.createIcons();

  const form = wrap.querySelector('#report-form');
  const out = wrap.querySelector('#report-out');
  const btnPrint = wrap.querySelector('#rpt-print');
  const btnPdf = wrap.querySelector('#rpt-pdf');
  const btnCsv = wrap.querySelector('#rpt-csv');

  function setExportEnabled(on) {
    [btnPrint, btnPdf, btnCsv].forEach((b) => { b.disabled = !on; b.classList.toggle('opacity-50', !on); });
  }

  async function generate() {
    const data = readForm(form);
    const def = REPORTS.find((r) => r.key === data.report) || REPORTS[0];
    const query = { from: data.from, to: data.to, classLevel: data.classLevel };
    ctx.setQuery({ ...q, report: data.report, from: data.from, to: data.to, classLevel: data.classLevel });

    out.innerHTML = card(`<p class="text-sm text-slate-400">${escapeHtml(t('common.loading'))}</p>`);
    setExportEnabled(false);
    try {
      const res = await api.get(def.path + buildQuery(query), { signal: ctx.signal });
      currentReport = res.data;
      const parts = [];
      if (data.from) parts.push(`${t('reports.from')}: ${data.from}`);
      if (data.to) parts.push(`${t('reports.to')}: ${data.to}`);
      if (data.classLevel) parts.push(`${t('members.classLevel')}: ${data.classLevel}`);
      parts.push(`${settings.term || ''} ${settings.academicYear || ''}`.trim());
      currentMeta = parts.filter(Boolean).join(' · ');
      renderReport(res.data);
      setExportEnabled(true);
    } catch (err) {
      currentReport = null;
      out.innerHTML = card(`<p class="text-sm text-danger">${escapeHtml(err.message)}</p>`);
    }
  }

  function renderReport(report) {
    const columns = report.columns || [];
    const rows = report.rows || [];
    const head = `<tr>${columns.map((c) => `<th class="px-4 py-3 text-left font-semibold whitespace-nowrap">${escapeHtml(c)}</th>`).join('')}</tr>`;
    const body = rows.length
      ? rows.map((r, i) => `<tr class="${i % 2 ? 'bg-slate-50/60 dark:bg-slate-700/20' : ''}">${columns.map((c) => `<td class="px-4 py-2.5 text-sm whitespace-nowrap">${escapeHtml(r[c] != null ? r[c] : '')}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${columns.length}" class="px-4 py-10 text-center text-slate-400">${escapeHtml(t('common.noData'))}</td></tr>`;

    const collectedNote = report.collected != null
      ? `<p class="text-sm text-slate-500 mt-3">${escapeHtml(t('reports.collected'))}: <span class="font-semibold text-success">${escapeHtml(String(report.collected))}</span></p>`
      : '';

    out.innerHTML = card(`
      <div class="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h2 class="font-heading font-semibold text-lg text-slate-800 dark:text-slate-100">${escapeHtml(report.title || '')}</h2>
        <span class="text-xs text-slate-400">${escapeHtml(currentMeta)}</span>
      </div>
      <div class="overflow-x-auto rounded-input border border-slate-200 dark:border-slate-700">
        <table class="min-w-full text-slate-700 dark:text-slate-200">
          <thead class="bg-slate-100 dark:bg-slate-700/50 text-xs uppercase tracking-wide text-slate-500 dark:text-slate-300 sticky top-0">${head}</thead>
          <tbody class="divide-y divide-slate-100 dark:divide-slate-700">${body}</tbody>
        </table>
      </div>
      <p class="text-sm text-slate-500 mt-3">${rows.length} ${escapeHtml(t('common.results'))}</p>
      ${collectedNote}`);
  }

  form.addEventListener('submit', (e) => { e.preventDefault(); generate(); });
  btnPrint.addEventListener('click', () => { if (currentReport) printReport(currentReport, { subtitle: currentMeta }); });
  btnPdf.addEventListener('click', () => { if (currentReport) exportReportPDF(currentReport, { subtitle: currentMeta }); });
  btnCsv.addEventListener('click', () => { if (currentReport) exportReportCSV(currentReport); });

  setExportEnabled(false);
  await generate();

  return function unmount() {};
}
