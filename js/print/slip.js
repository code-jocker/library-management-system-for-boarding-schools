// public/js/print/slip.js
// Printable borrowing slip handed to the student after issuing a book.
import { getState } from '../core/store.js';
import { escapeHtml, formatDate } from '../core/utils.js';
import { printDocument } from '../core/printer.js';

/**
 * @param {object} txn  transaction with populated book + member
 * @param {Date|string} dueDate
 */
export function printBorrowingSlip(txn, dueDate) {
  const s = getState().settings || {};
  const book = txn.book || {};
  const member = txn.member || {};
  const due = formatDate(dueDate || txn.dueDate);

  const inner = `
    <h2 style="font-family:Poppins,sans-serif;font-size:16px;font-weight:700;color:#1E3A8A;margin-bottom:12px">Borrowing Slip</h2>
    <table style="width:100%;border-collapse:collapse;font-size:13px">
      <tr><td style="padding:6px 0;color:#64748b;width:38%">Student</td><td style="padding:6px 0;font-weight:600">${escapeHtml(member.fullName || txn.memberName || '')}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Admission No</td><td style="padding:6px 0;font-weight:600">${escapeHtml(member.admissionNo || txn.memberAdmissionNo || '')}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Class</td><td style="padding:6px 0">${escapeHtml(member.classLevel || '—')}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Book title</td><td style="padding:6px 0;font-weight:600">${escapeHtml(book.title || txn.bookTitle || '')}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">ISBN / Code</td><td style="padding:6px 0">${escapeHtml(book.isbn || txn.bookIsbn || '')}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Issued on</td><td style="padding:6px 0">${escapeHtml(formatDate(txn.issueDate))}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b">Due date</td><td style="padding:6px 0;font-weight:700;color:#DC2626">${escapeHtml(due)}</td></tr>
    </table>
    <p style="margin-top:14px;font-size:11px;color:#64748b;border-top:1px dashed #cbd5e1;padding-top:8px">
      Please return this book on or before the due date. A fine of ${escapeHtml(s.currencySymbol || '')} ${escapeHtml(String(s.finePerDay || 0))} per day applies to late returns.
    </p>
    <div style="margin-top:26px;display:flex;justify-content:space-between;font-size:11px;color:#475569">
      <div>Student signature: ______________________</div>
      <div>Librarian: ______________________</div>
    </div>`;
  printDocument(inner, { title: 'Borrowing Slip' });
}
