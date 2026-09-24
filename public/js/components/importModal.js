// public/js/components/importModal.js
// Shared bulk-import flow: template download -> file parse -> preview with
// row-level validation -> confirm commit -> summary.
import { api, invalidateCache } from '../core/api.js';
import { t } from '../core/i18n.js';
import { escapeHtml, download } from '../core/utils.js';
import { openModal, closeModal } from './modal.js';
import { toast } from './toast.js';

/**
 * @param {object} opts
 *  kind: 'books' | 'members'
 *  templateColumns: [{ key, label, sample }]
 *  onDone(summary)
 */
export function openImportModal({ kind, templateColumns, onDone }) {
  const endpointBase = `/import/${kind}`;
  let parsedRows = [];
  let previewData = null;

  const id = openModal({
    title: `${t('import.title')} — ${kind === 'books' ? t('books.title') : t('members.title')}`,
    size: 'xl',
    body: `
      <div class="space-y-4">
        <div class="p-4 rounded-input bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600">
          <p class="text-sm text-slate-600 dark:text-slate-300 mb-3"><strong>1.</strong> ${escapeHtml(t('import.step1'))}</p>
          <button id="dl-template" class="inline-flex items-center gap-2 px-4 py-2 rounded-input border border-slate-300 dark:border-slate-600 text-sm font-medium hover:bg-white dark:hover:bg-slate-700 min-h-[44px]">
            <i data-lucide="download" class="w-4 h-4"></i>${escapeHtml(t('common.downloadTemplate'))}
          </button>
        </div>

        <div class="p-4 rounded-input bg-slate-50 dark:bg-slate-700/40 border border-slate-200 dark:border-slate-600">
          <p class="text-sm text-slate-600 dark:text-slate-300 mb-3"><strong>2.</strong> ${escapeHtml(t('import.step2'))}</p>
          <input id="file-input" type="file" accept=".csv,.xlsx,.xls" class="block w-full text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:px-4 file:py-2 file:rounded-input file:border-0 file:bg-primary-50 file:text-primary file:font-medium hover:file:bg-primary-100 file:cursor-pointer" />
        </div>

        <div id="preview-zone" class="hidden">
          <p class="text-sm text-slate-600 dark:text-slate-300 mb-2"><strong>3.</strong> ${escapeHtml(t('import.step3'))}</p>
          <div id="preview-summary" class="mb-3"></div>
          <div id="preview-table" class="max-h-72 overflow-auto scroll-slim border border-slate-200 dark:border-slate-700 rounded-input"></div>
        </div>
      </div>`,
    actions: [
      { label: t('common.cancel'), variant: 'ghost', onClick: () => closeModal(id) },
      { label: t('import.confirmImport'), variant: 'primary', id: 'commit-btn', onClick: commit }
    ]
  });

  const root = document.getElementById(id);
  const commitBtn = root.querySelector('#commit-btn');
  commitBtn.disabled = true;
  commitBtn.classList.add('opacity-50', 'cursor-not-allowed');
  if (window.lucide) window.lucide.createIcons();

  // 1. Template download (CSV with sample row).
  root.querySelector('#dl-template').addEventListener('click', () => {
    const header = templateColumns.map((c) => c.label).join(',');
    const sample = templateColumns.map((c) => c.sample != null ? `"${c.sample}"` : '').join(',');
    download(`${kind}-import-template.csv`, `${header}\n${sample}`, 'text/csv;charset=utf-8;');
  });

  // 2. File parse (CSV via PapaParse, XLSX via SheetJS).
  root.querySelector('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      parsedRows = await parseFile(file);
      if (!parsedRows.length) { toast(t('import.noValidRows'), 'warning'); return; }
      // Server-side preview (validate only).
      const res = await api.post(`${endpointBase}/preview`, { rows: parsedRows });
      previewData = res.data;
      renderPreview(previewData, parsedRows);
      const hasValid = previewData.summary.valid > 0;
      commitBtn.disabled = !hasValid;
      commitBtn.classList.toggle('opacity-50', !hasValid);
      commitBtn.classList.toggle('cursor-not-allowed', !hasValid);
    } catch (err) {
      toast(err.message || t('errors.generic'), 'error');
    }
  });

  function renderPreview(data, rows) {
    root.querySelector('#preview-zone').classList.remove('hidden');
    const sm = data.summary;
    root.querySelector('#preview-summary').innerHTML = `
      <div class="flex flex-wrap gap-2 text-sm">
        <span class="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">${escapeHtml(t('import.rowsFound', { n: sm.total }))}</span>
        <span class="px-3 py-1 rounded-full bg-green-100 text-green-700">${sm.valid} ${escapeHtml(t('import.valid'))}</span>
        ${sm.invalid ? `<span class="px-3 py-1 rounded-full bg-red-100 text-red-700">${sm.invalid} ${escapeHtml(t('import.invalid'))}</span>` : ''}
      </div>`;

    // Show first 50 rows with status + any errors.
    const detailById = new Map(data.details.map((d) => [d.line, d]));
    const cols = kind === 'books'
      ? ['title', 'author', 'isbn', 'category', 'totalCopies']
      : ['fullName', 'classLevel', 'stream', 'dormitory', 'admissionNo'];
    const rowsHtml = rows.slice(0, 50).map((r, i) => {
      const det = detailById.get(i + 1) || {};
      const errText = det.errors ? Object.values(det.errors).join(', ') : (det.reason || '');
      const bad = det.status === 'invalid' || det.status === 'failed';
      return `<tr class="${bad ? 'bg-red-50 dark:bg-red-900/20' : ''}">
        <td class="px-2 py-1 text-slate-400">${i + 1}</td>
        ${cols.map((c) => `<td class="px-2 py-1">${escapeHtml(r[c] != null ? r[c] : (r[c.charAt(0).toUpperCase() + c.slice(1)] != null ? r[c.charAt(0).toUpperCase() + c.slice(1)] : ''))}</td>`).join('')}
        <td class="px-2 py-1 ${bad ? 'text-danger font-medium' : 'text-success'}">${bad ? escapeHtml(errText) : '✓'}</td>
      </tr>`;
    }).join('');
    root.querySelector('#preview-table').innerHTML = `
      <table class="w-full text-xs">
        <thead class="sticky top-0 bg-slate-100 dark:bg-slate-700"><tr>
          <th class="px-2 py-1">#</th>${cols.map((c) => `<th class="px-2 py-1 text-left">${escapeHtml(c)}</th>`).join('')}<th class="px-2 py-1 text-left">${escapeHtml(t('common.status'))}</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
      </table>`;
  }

  async function commit() {
    commitBtn.disabled = true;
    commitBtn.textContent = t('common.loading');
    try {
      const res = await api.post(`${endpointBase}/commit`, { rows: parsedRows });
      const sm = res.data.summary;
      toast(t('import.summary', { created: sm.created, skipped: sm.valid - sm.created, failed: sm.invalid }), 'success');
      invalidateCache('/books');
      invalidateCache('/members');
      closeModal(id);
      if (onDone) onDone(sm);
    } catch (err) {
      toast(err.message || t('errors.generic'), 'error');
      commitBtn.disabled = false;
      commitBtn.textContent = t('import.confirmImport');
    }
  }

  return id;
}

// Parse a CSV or XLSX file into an array of row objects.
function parseFile(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'csv') {
      if (!window.Papa) return reject(new Error('CSV parser not loaded'));
      window.Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: (res) => resolve(res.data),
        error: (err) => reject(err)
      });
    } else if (ext === 'xlsx' || ext === 'xls') {
      if (!window.XLSX) return reject(new Error('Excel parser not loaded'));
      const reader = new FileReader();
      reader.onload = (e) => {
        try {
          const wb = window.XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
          const ws = wb.Sheets[wb.SheetNames[0]];
          resolve(window.XLSX.utils.sheet_to_json(ws, { defval: '' }));
        } catch (err) { reject(err); }
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    } else {
      reject(new Error('Unsupported file type. Use CSV or XLSX.'));
    }
  });
}
