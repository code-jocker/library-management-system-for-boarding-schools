// public/js/print/report.js
// Printable report (HTML letterhead) + PDF/CSV export helpers shared by the
// reports view.
import { getState } from '../core/store.js';
import { escapeHtml, exportCSV } from '../core/utils.js';
import { printDocument, letterhead } from '../core/printer.js';

/**
 * @param {object} report { title, columns:[string], rows:[{col:val}] }
 * @param {object} meta   { subtitle }
 */
export function printReport(report, meta = {}) {
  const { title, columns = [], rows = [] } = report;
  const head = `<tr>${columns.map((c) => `<th>${escapeHtml(c)}</th>`).join('')}</tr>`;
  const body = rows.length
    ? rows.map((r) => `<tr>${columns.map((c) => `<td>${escapeHtml(r[c] != null ? r[c] : '')}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}" style="text-align:center;color:#94a3b8;padding:14px">No data</td></tr>`;

  const inner = `
    <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
      <h2 style="font-family:Poppins,sans-serif;font-size:16px;font-weight:700;color:#1E3A8A">${escapeHtml(title)}</h2>
      <span style="font-size:11px;color:#64748b">${escapeHtml(meta.subtitle || '')}</span>
    </div>
    <table><thead>${head}</thead><tbody>${body}</tbody></table>
    <p style="margin-top:10px;font-size:11px;color:#64748b">${rows.length} record(s)</p>`;
  printDocument(inner, { title, subtitle: meta.subtitle });
}

// Export the report to PDF via jsPDF + autotable.
export function exportReportPDF(report, meta = {}) {
  if (!window.jspdf) return;
  const { jsPDF } = window.jspdf;
  const s = getState().settings || {};
  const doc = new jsPDF({ orientation: (report.columns || []).length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });

  doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(30, 58, 138);
  doc.text(s.schoolName || 'School', 40, 44);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(100);
  doc.text(s.address || '', 40, 60);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(0);
  doc.text(report.title || '', 40, 84);
  if (meta.subtitle) { doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.text(String(meta.subtitle), 40, 98); }

  doc.autoTable({
    startY: 108,
    head: [report.columns || []],
    body: (report.rows || []).map((r) => (report.columns || []).map((c) => r[c] != null ? String(r[c]) : '')),
    styles: { fontSize: 8, cellPadding: 4 },
    headStyles: { fillColor: [30, 58, 138], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [248, 250, 252] }
  });

  const pageCount = doc.internal.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(8); doc.setTextColor(120);
    doc.text(`Printed by ${(getState().user && getState().user.fullName) || 'Librarian'} · ${new Date().toLocaleString('en-GB')}`, 40, doc.internal.pageSize.getHeight() - 20);
    doc.text(`Page ${i} of ${pageCount}`, doc.internal.pageSize.getWidth() - 80, doc.internal.pageSize.getHeight() - 20);
  }
  doc.save(`${(report.title || 'report').replace(/\s+/g, '-').toLowerCase()}.pdf`);
}

// Export the report to CSV.
export function exportReportCSV(report) {
  const columns = (report.columns || []).map((c) => ({ key: c, label: c }));
  exportCSV(`${(report.title || 'report').replace(/\s+/g, '-').toLowerCase()}.csv`, report.rows || [], columns);
}
