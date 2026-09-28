// public/js/components/importModal.js
// Shared bulk-import flow: template download -> file parse -> EDITABLE preview
// with row-level validation -> confirm commit -> summary.
// The preview is a spreadsheet-like grid: every cell can be edited, missing
// columns are added automatically, and rows can be added or removed before the
// data is committed. Header names are matched case-insensitively with common
// aliases so a loosely-formatted file still maps onto the right fields.
import { api, invalidateCache } from '../core/api.js';
import { t } from '../core/i18n.js';
import { escapeHtml, download } from '../core/utils.js';
import { openModal, closeModal } from './modal.js';
import { toast } from './toast.js';

// Lowercased alternate header names -> canonical template key.
const ALIASES = {
  fullName: ['fullname', 'name', 'full name', 'student name', 'student', 'names'],
  admissionNo: ['admissionno', 'admission', 'admission number', 'admno', 'adm no', 'regno', 'reg no', 'registrationnumber', 'registration number', 'id'],
  classLevel: ['classlevel', 'class', 'class level', 'level', 'grade', 'form'],
  stream: ['stream', 'section', 'class section', 'combination'],
  dormitory: ['dormitory', 'dorm', 'hostel', 'house', 'room'],
  gender: ['gender', 'sex'],
  memberType: ['memebertype', 'type', 'member type', 'role', 'category'],
  guardianName: ['guardianname', 'guardian', 'parent', 'parentname', 'guardian name', 'father', 'mother'],
  guardianPhone: ['guardianphone', 'guardian phone', 'parentphone', 'parent phone', 'guardian contact'],
  phone: ['phone', 'phonenumber', 'phone number', 'mobile', 'contact', 'telephone'],
  title: ['title', 'booktitle', 'book title', 'bookname', 'book name'],
  author: ['author', 'writer', 'by', 'author name'],
  isbn: ['isbn', 'code', 'bookcode', 'book code', 'isbn13', 'accession'],
  category: ['category', 'genre', 'subject', 'type'],
  publisher: ['publisher', 'publishedby', 'publisher name', 'published by'],
  year: ['year', 'publicationyear', 'publishedyear', 'pubyear', 'year published'],
  language: ['language', 'lang'],
  totalCopies: ['totalcopies', 'copies', 'total copies', 'quantity', 'qty', 'nocopies', 'no of copies'],
  shelfLocation: ['shelflocation', 'shelf', 'location', 'shelf location', 'rack', 'shelf no'],
  replacementValue: ['replacementvalue', 'price', 'value', 'cost', 'replacement value', 'amount']
};

const MAX_EDITABLE_ROWS = 1000;

/**
 * @param {object} opts
 *  kind: 'books' | 'members'
 *  templateColumns: [{ key, label, sample }]
 *  onDone(summary)
 */
export function openImportModal({ kind, templateColumns, onDone }) {
  const endpointBase = `/import/${kind}`;
  const cols = templateColumns.map((c) => c.key);
  let parsedRows = [];
  let previewData = null;
  let addedFields = [];

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
          <div class="flex flex-wrap items-center justify-between gap-2 mb-2">
            <p class="text-sm text-slate-600 dark:text-slate-300"><strong>3.</strong> ${escapeHtml(t('import.step3'))}</p>
            <div class="flex flex-wrap gap-2">
              <button id="add-row" type="button" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-input border border-slate-300 dark:border-slate-600 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[40px]">
                <i data-lucide="plus" class="w-4 h-4"></i>${escapeHtml(t('import.addRow'))}
              </button>
              <button id="recheck" type="button" class="inline-flex items-center gap-1.5 px-3 py-2 rounded-input border border-slate-300 dark:border-slate-600 text-sm font-medium hover:bg-slate-100 dark:hover:bg-slate-700 min-h-[40px]">
                <i data-lucide="refresh-cw" class="w-4 h-4"></i>${escapeHtml(t('import.recheck'))}
              </button>
            </div>
          </div>
          <p class="text-xs text-slate-400 mb-2">${escapeHtml(t('import.editHint'))}</p>
          <div id="added-note" class="hidden mb-2 text-xs text-primary font-medium"></div>
          <div id="preview-summary" class="mb-3"></div>
          <div id="preview-table" class="max-h-[24rem] overflow-auto scroll-slim border border-slate-200 dark:border-slate-700 rounded-input"></div>
        </div>
      </div>`,
    actions: [
      { label: t('common.cancel'), variant: 'ghost', onClick: () => closeModal(id) },
      { label: t('import.confirmImport'), variant: 'primary', id: 'commit-btn', onClick: commit }
    ]
  });

  const root = document.getElementById(id);
  const commitBtn = root.querySelector('#commit-btn');
  setCommitEnabled(false);
  if (window.lucide) window.lucide.createIcons();

  function setCommitEnabled(on) {
    commitBtn.disabled = !on;
    commitBtn.classList.toggle('opacity-50', !on);
    commitBtn.classList.toggle('cursor-not-allowed', !on);
  }

  // 1. Template download (CSV with sample row).
  root.querySelector('#dl-template').addEventListener('click', () => {
    const header = templateColumns.map((c) => c.label).join(',');
    const sample = templateColumns.map((c) => (c.sample != null ? `"${c.sample}"` : '')).join(',');
    download(`${kind}-import-template.csv`, `${header}\n${sample}`, 'text/csv;charset=utf-8;');
  });

  // 2. File parse (CSV via PapaParse, XLSX via SheetJS).
  root.querySelector('#file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const raw = await parseFile(file);
      if (!raw.length) { toast(t('import.noValidRows'), 'warning'); return; }
      parsedRows = normalizeRows(raw);
      renderTable();
      await refreshPreview();
    } catch (err) {
      toast(err.message || t('errors.generic'), 'error');
    }
  });

  // Map each raw row onto the canonical template keys, resolving headers
  // case-insensitively and via aliases. Missing fields become empty strings so
  // the user can fill them in (and the server applies its own defaults).
  function normalizeRows(rows) {
    const seenAdded = new Set();
    const out = rows.slice(0, MAX_EDITABLE_ROWS).map((r) => {
      const lower = {};
      for (const k of Object.keys(r)) lower[String(k).toLowerCase().trim()] = r[k];
      const row = {};
      for (const key of cols) {
        const candidates = [key.toLowerCase(), ...(ALIASES[key] || [])];
        let val = '';
        for (const c of candidates) {
          if (lower[c] != null && String(lower[c]).trim() !== '') { val = String(lower[c]).trim(); break; }
        }
        // Track columns the file did not provide at all.
        if (val === '' && !(candidates.some((c) => c in lower))) seenAdded.add(key);
        row[key] = val;
      }
      return row;
    });
    addedFields = [...seenAdded];
    return out;
  }

  // Build the editable grid from parsedRows.
  function renderTable() {
    root.querySelector('#preview-zone').classList.remove('hidden');

    const note = root.querySelector('#added-note');
    if (addedFields.length) {
      note.textContent = t('import.addedMissing', { fields: addedFields.join(', ') });
      note.classList.remove('hidden');
    } else {
      note.classList.add('hidden');
    }

    const head = `
      <thead class="sticky top-0 bg-slate-100 dark:bg-slate-700 z-10">
        <tr>
          <th class="px-2 py-2 text-left text-[11px] font-semibold text-slate-500 dark:text-slate-300">#</th>
          ${cols.map((c) => `<th class="px-2 py-2 text-left text-[11px] font-semibold text-slate-500 dark:text-slate-300 whitespace-nowrap">${escapeHtml(c)}</th>`).join('')}
          <th class="px-2 py-2 text-left text-[11px] font-semibold text-slate-500 dark:bg-slate-700 dark:text-slate-300 whitespace-nowrap">${escapeHtml(t('common.status'))}</th>
          <th class="px-2 py-2"></th>
        </tr>
      </thead>`;

    const body = parsedRows.map((row, i) => `
      <tr data-row="${i}" class="border-t border-slate-100 dark:border-slate-700/60">
        <td class="px-2 py-1 text-slate-400 align-middle">${i + 1}</td>
        ${cols.map((c) => `<td class="px-1 py-1">
            <input data-key="${escapeHtml(c)}" data-i="${i}" value="${escapeHtml(row[c] != null ? row[c] : '')}"
              class="w-full min-w-[7rem] px-2 py-1 rounded border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs focus:border-primary focus:ring-1 focus:ring-primary/30" />
          </td>`).join('')}
        <td data-status="${i}" class="px-2 py-1 text-xs align-middle"></td>
        <td class="px-1 py-1 align-middle">
          <button type="button" data-del="${i}" title="${escapeHtml(t('import.removeRow'))}" class="p-1.5 rounded text-slate-400 hover:text-danger hover:bg-red-50 dark:hover:bg-red-900/20">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </td>
      </tr>`).join('');

    root.querySelector('#preview-table').innerHTML = `
      <table class="w-full text-xs border-separate border-spacing-0">${head}<tbody>${body}</tbody></table>`;
    if (window.lucide) window.lucide.createIcons();

    // Editable cells -> update parsedRows, then re-validate (debounced).
    const table = root.querySelector('#preview-table');
    table.querySelectorAll('input[data-key]').forEach((inp) => {
      inp.addEventListener('input', () => {
        const i = Number(inp.getAttribute('data-i'));
        const key = inp.getAttribute('data-key');
        if (parsedRows[i]) parsedRows[i][key] = inp.value;
        schedulePreview();
      });
    });
    table.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const i = Number(btn.getAttribute('data-del'));
        parsedRows.splice(i, 1);
        renderTable();
        refreshPreview();
      });
    });
  }

  // Add a blank, fully-editable row.
  root.querySelector('#add-row').addEventListener('click', () => {
    const blank = {};
    cols.forEach((c) => { blank[c] = ''; });
    parsedRows.push(blank);
    renderTable();
    refreshPreview();
    // Scroll to the new row and focus its first cell.
    const tbl = root.querySelector('#preview-table');
    tbl.scrollTop = tbl.scrollHeight;
    const firstInput = tbl.querySelector(`tr[data-row="${parsedRows.length - 1}"] input`);
    if (firstInput) firstInput.focus();
  });

  root.querySelector('#recheck').addEventListener('click', () => refreshPreview());

  // Debounced server-side validation so the status column stays live while editing.
  let previewTimer = null;
  function schedulePreview() {
    clearTimeout(previewTimer);
    previewTimer = setTimeout(refreshPreview, 700);
  }

  async function refreshPreview() {
    if (!parsedRows.length) {
      previewData = null;
      root.querySelector('#preview-summary').innerHTML = '';
      setCommitEnabled(false);
      return;
    }
    try {
      const res = await api.post(`${endpointBase}/preview`, { rows: parsedRows });
      previewData = res.data;
      renderSummary(previewData.summary);
      updateStatusCells(previewData.details);
      setCommitEnabled(previewData.summary.valid > 0);
    } catch (err) {
      toast(err.message || t('errors.generic'), 'error');
    }
  }

  function renderSummary(sm) {
    root.querySelector('#preview-summary').innerHTML = `
      <div class="flex flex-wrap gap-2 text-sm">
        <span class="px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">${escapeHtml(t('import.rowsFound', { n: sm.total }))}</span>
        <span class="px-3 py-1 rounded-full bg-green-100 text-green-700">${sm.valid} ${escapeHtml(t('import.valid'))}</span>
        ${sm.invalid ? `<span class="px-3 py-1 rounded-full bg-red-100 text-red-700">${sm.invalid} ${escapeHtml(t('import.invalid'))}</span>` : ''}
      </div>`;
  }

  // Paint only the status column (keeps input focus intact while typing).
  function updateStatusCells(details) {
    const byLine = new Map((details || []).map((d) => [d.line, d]));
    for (let i = 0; i < parsedRows.length; i++) {
      const cell = root.querySelector(`[data-status="${i}"]`);
      const tr = root.querySelector(`tr[data-row="${i}"]`);
      if (!cell) continue;
      const det = byLine.get(i + 1) || {};
      const bad = det.status === 'invalid' || det.status === 'failed';
      const errText = det.errors ? Object.values(det.errors).join(', ') : (det.reason || '');
      cell.className = `px-2 py-1 text-xs align-middle ${bad ? 'text-danger font-medium' : 'text-success'}`;
      cell.textContent = bad ? errText : '✓';
      if (tr) tr.classList.toggle('bg-red-50', bad);
      if (tr) tr.classList.toggle('dark:bg-red-900/10', bad);
    }
  }

  async function commit() {
    setCommitEnabled(false);
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
      commitBtn.textContent = t('import.confirmImport');
      setCommitEnabled(true);
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
