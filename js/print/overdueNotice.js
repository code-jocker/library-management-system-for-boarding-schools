// public/js/print/overdueNotice.js
// Printable overdue notice to a guardian. Single and bulk.
import { getState } from '../core/store.js';
import { escapeHtml, formatDate, formatMoney } from '../core/utils.js';
import { printDocument, letterhead } from '../core/printer.js';

/**
 * @param {Array} loans  transaction objects (from /transactions/overdue),
 *                       optionally grouped per member. Each has .member and .book.
 */
export function printOverdueNotice(loans) {
  const s = getState().settings || {};
  if (!loans.length) return;

  // Group by member so each guardian gets one letter listing their books.
  const byMember = new Map();
  for (const l of loans) {
    const key = l.member ? l.member._id : l.memberAdmissionNo;
    if (!byMember.has(key)) byMember.set(key, []);
    byMember.get(key).push(l);
  }

  const blocks = [...byMember.values()].map((items, idx) => {
    const m = items[0].member || {};
    const guardian = m.guardianName || 'Parent / Guardian';
    const rows = items.map((l) => `
      <tr>
        <td style="border:1px solid #cbd5e1;padding:5px 7px">${escapeHtml(l.book ? l.book.title : l.bookTitle)}</td>
        <td style="border:1px solid #cbd5e1;padding:5px 7px">${escapeHtml(formatDate(l.dueDate))}</td>
        <td style="border:1px solid #cbd5e1;padding:5px 7px;text-align:center">${l.daysOverdue != null ? l.daysOverdue : ''}</td>
        <td style="border:1px solid #cbd5e1;padding:5px 7px;text-align:right">${escapeHtml(formatMoney(l.fineSoFar, s))}</td>
      </tr>`).join('');
    const total = items.reduce((sum, l) => sum + (l.fineSoFar || 0), 0);

    return `
      <div class="card-sheet" style="${idx > 0 ? 'page-break-before:always;' : ''}margin-bottom:12px">
        <p style="font-size:13px;color:#334155;line-height:1.6">
          Dear <strong>${escapeHtml(guardian)}</strong>,<br/>
          Re: <strong>${escapeHtml(m.fullName || '')}</strong> (${escapeHtml(m.admissionNo || '')}), Class ${escapeHtml(m.classLevel || '—')}
        </p>
        <p style="font-size:13px;color:#334155;line-height:1.6;margin-top:10px">
          Our records show the following library book(s) borrowed by your ward are overdue.
          Kindly ensure they are returned to the school library as soon as possible.
          An overdue fine accrues at ${escapeHtml(formatMoney(s.finePerDay, s))} per day per book.
        </p>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-top:12px">
          <thead><tr style="background:#f1f5f9">
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:left">Book</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:left">Due date</th>
            <th style="border:1px solid #cbd5e1;padding:6px">Days late</th>
            <th style="border:1px solid #cbd5e1;padding:6px;text-align:right">Fine so far</th>
          </tr></thead>
          <tbody>${rows}
            <tr style="background:#fef2f2"><td colspan="3" style="border:1px solid #cbd5e1;padding:6px;font-weight:700">Total due</td>
            <td style="border:1px solid #cbd5e1;padding:6px;text-align:right;font-weight:700;color:#DC2626">${escapeHtml(formatMoney(total, s))}</td></tr>
          </tbody>
        </table>
        <p style="font-size:12px;color:#475569;margin-top:16px">For any clarification, please contact the school library office.</p>
        <div style="margin-top:28px;font-size:12px;color:#475569">
          ${escapeHtml((getState().user && getState().user.fullName) || 'Umutoni Jeannette')}<br/>Librarian
        </div>
      </div>`;
  }).join('');

  const root = document.getElementById('print-root');
  root.innerHTML = `<div style="font-family:Inter,sans-serif;padding:8px">${letterhead({ title: 'Overdue Notice' })}${blocks}</div>`;
  setTimeout(() => window.print(), 200);
}
