// public/js/print/receipt.js
// Printable fine receipt with receipt number and payment breakdown.
import { api } from '../core/api.js';
import { getState } from '../core/store.js';
import { escapeHtml, formatDate, formatDateTime, formatMoney } from '../core/utils.js';
import { printDocument } from '../core/printer.js';

export async function printFineReceipt(fineId) {
  const res = await api.get(`/fines/${fineId}/receipt`);
  const { fine, settings } = res.data;
  const member = fine.member || {};
  const balance = fine.amount - fine.paidAmount;

  const payments = (fine.payments || []).map((p) => `
    <tr>
      <td>${escapeHtml(formatDateTime(p.paidAt))}</td>
      <td>${escapeHtml(p.method || '')}</td>
      <td>${escapeHtml((p.receivedBy && p.receivedBy.fullName) || '')}</td>
      <td style="text-align:right">${escapeHtml(formatMoney(p.amount, settings))}</td>
    </tr>`).join('');

  const inner = `
    <h2 style="font-family:Poppins,sans-serif;font-size:16px;font-weight:700;color:#1E3A8A;margin-bottom:4px">Fine Receipt</h2>
    <p style="font-size:12px;color:#64748b;margin-bottom:12px">Receipt No: <strong>${escapeHtml(fine.receiptNo)}</strong></p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:12px">
      <tr><td style="padding:5px 0;color:#64748b;width:38%">Member</td><td style="font-weight:600">${escapeHtml(member.fullName || fine.memberName || '')}</td></tr>
      <tr><td style="padding:5px 0;color:#64748b">Admission No</td><td>${escapeHtml(member.admissionNo || '')}</td></tr>
      <tr><td style="padding:5px 0;color:#64748b">Class</td><td>${escapeHtml(member.classLevel || '—')}</td></tr>
      <tr><td style="padding:5px 0;color:#64748b">Book</td><td>${escapeHtml((fine.book && fine.book.title) || fine.bookTitle || '')}</td></tr>
      <tr><td style="padding:5px 0;color:#64748b">Reason</td><td>${escapeHtml(fine.reason)}${fine.daysOverdue ? ` (${fine.daysOverdue} days late)` : ''}</td></tr>
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:12px">
      <thead><tr style="background:#f1f5f9">
        <th style="text-align:left;padding:6px;border:1px solid #cbd5e1">Date</th>
        <th style="text-align:left;padding:6px;border:1px solid #cbd5e1">Method</th>
        <th style="text-align:left;padding:6px;border:1px solid #cbd5e1">Received by</th>
        <th style="text-align:right;padding:6px;border:1px solid #cbd5e1">Amount</th>
      </tr></thead>
      <tbody>${payments || `<tr><td colspan="4" style="padding:6px;border:1px solid #cbd5e1;color:#94a3b8">No payments yet</td></tr>`}</tbody>
    </table>

    <table style="width:100%;border-collapse:collapse;font-size:13px;max-width:320px;margin-left:auto">
      <tr><td style="padding:4px 0;color:#64748b">Total fine</td><td style="text-align:right;font-weight:600">${escapeHtml(formatMoney(fine.amount, settings))}</td></tr>
      <tr><td style="padding:4px 0;color:#64748b">Paid</td><td style="text-align:right;font-weight:600;color:#16A34A">${escapeHtml(formatMoney(fine.paidAmount, settings))}</td></tr>
      <tr style="border-top:2px solid #1E3A8A"><td style="padding:6px 0;font-weight:700">Balance</td><td style="text-align:right;font-weight:700;color:${balance > 0 ? '#DC2626' : '#16A34A'}">${escapeHtml(formatMoney(balance, settings))}</td></tr>
    </table>
    <p style="margin-top:10px;font-size:11px;color:#64748b">Status: <strong>${escapeHtml(fine.status.toUpperCase())}</strong>${fine.status === 'waived' && fine.waivedReason ? ` — ${escapeHtml(fine.waivedReason)}` : ''}</p>`;

  printDocument(inner, { title: 'Fine Receipt' });
}
