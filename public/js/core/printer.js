// public/js/core/printer.js
// Fills the hidden #print-root with a letterhead + document, then prints.
import { getState } from './store.js';
import { escapeHtml } from './utils.js';

// Build the shared letterhead used by reports, receipts, notices, certificates.
export function letterhead(opts = {}) {
  const s = getState().settings || {};
  const title = opts.title || '';
  const sub = opts.subtitle || '';
  const logo = s.logo ? `<img src="${s.logo}" alt="" style="height:54px;width:54px;object-fit:contain;border-radius:6px" />` : '';
  return `
    <div style="display:flex;align-items:center;gap:14px;border-bottom:2px solid #1E3A8A;padding-bottom:10px;margin-bottom:16px">
      ${logo}
      <div style="flex:1">
        <div style="font-family:Poppins,sans-serif;font-weight:700;font-size:18px;color:#1E3A8A">${escapeHtml(s.schoolName || 'School')}</div>
        <div style="font-size:11px;color:#475569">${escapeHtml(s.address || '')} ${s.phone ? '&middot; ' + escapeHtml(s.phone) : ''}</div>
        <div style="font-size:11px;color:#475569">${escapeHtml(s.email || '')}</div>
      </div>
      <div style="text-align:right;font-size:11px;color:#475569">
        ${title ? `<div style="font-weight:700;font-size:14px;color:#0f172a">${escapeHtml(title)}</div>` : ''}
        ${sub ? `<div>${escapeHtml(sub)}</div>` : ''}
        <div>Date: ${new Date().toLocaleDateString('en-GB')}</div>
      </div>
    </div>`;
}

// Footer with the "Printed by" line required on every document.
export function printFooter() {
  const u = getState().user || {};
  return `
    <div style="margin-top:24px;border-top:1px solid #cbd5e1;padding-top:8px;font-size:10px;color:#64748b;display:flex;justify-content:space-between">
      <span>Printed by ${escapeHtml(u.fullName || 'Umutoni Jeannette')}, Librarian</span>
      <span>${new Date().toLocaleString('en-GB')}</span>
    </div>`;
}

/**
 * Print an HTML fragment inside the standard letterhead.
 * @param {string} innerHtml  Body content (already escaped where needed).
 * @param {object} opts       { title, subtitle, noLetterhead, noFooter }
 */
export function printDocument(innerHtml, opts = {}) {
  const root = document.getElementById('print-root');
  const head = opts.noLetterhead ? '' : letterhead(opts);
  const foot = opts.noFooter ? '' : printFooter();
  root.innerHTML = `<div style="font-family:Inter,sans-serif;color:#0f172a;padding:8px">${head}${innerHtml}${foot}</div>`;
  // Let images (logo, QR) render before printing.
  setTimeout(() => window.print(), 150);
}

// Clear the print host after the dialog closes.
window.addEventListener('afterprint', () => {
  const root = document.getElementById('print-root');
  if (root) root.innerHTML = '';
});
