// public/js/print/certificate.js
// Printable Library Clearance Certificate with school letterhead.
import { api } from '../core/api.js';
import { getState } from '../core/store.js';
import { escapeHtml, formatDate } from '../core/utils.js';
import { printDocument, letterhead } from '../core/printer.js';

// Print a certificate for a single member (fetches clearance data).
export async function printClearanceCertificate(memberId) {
  const res = await api.get(`/clearance/certificate/${memberId}`);
  const { member, settings, isCleared, issuedOn } = res.data;
  printCertificateDoc([member], settings, isCleared ? issuedOn : null);
}

// Bulk print for a class (uses the clearance list endpoint client-side).
export function printClearanceCertificatesBulk(members, settings) {
  printCertificateDoc(members, settings, new Date());
}

function printCertificateDoc(members, settings, issuedOn) {
  const dateStr = formatDate(issuedOn || new Date());
  const academic = `${settings.academicYear || ''} · ${settings.term || ''}`.trim();
  const body = members.map((m, i) => `
    <div class="card-sheet" style="border:2px solid #1E3A8A;border-radius:10px;padding:24px;margin-bottom:${i < members.length - 1 ? '14px' : '0'};${i > 0 ? 'page-break-before:always;' : ''}">
      <div style="text-align:center;margin-bottom:16px">
        <div style="font-family:Poppins,sans-serif;font-size:20px;font-weight:700;color:#1E3A8A;letter-spacing:.5px">LIBRARY CLEARANCE CERTIFICATE</div>
        <div style="font-size:12px;color:#64748b;margin-top:4px">${escapeHtml(academic)}</div>
      </div>
      <p style="font-size:13px;line-height:1.7;color:#334155;text-align:justify">
        This is to certify that <strong>${escapeHtml(m.fullName)}</strong>,
        admission number <strong>${escapeHtml(m.admissionNo)}</strong>,
        of class <strong>${escapeHtml(m.classLevel || '—')}${m.stream ? ' ' + escapeHtml(m.stream) : ''}</strong>,
        has returned all library books borrowed and has no outstanding fines
        as of <strong>${escapeHtml(dateStr)}</strong>.
      </p>
      <p style="font-size:13px;color:#334155;margin-top:8px">
        The student is therefore cleared by the school library.
      </p>
      <div style="margin-top:40px;display:flex;justify-content:space-between;font-size:12px;color:#475569">
        <div>Date: ${escapeHtml(dateStr)}</div>
        <div style="text-align:center">
          <div style="border-top:1px solid #475569;padding-top:4px;min-width:180px">
            ${escapeHtml((getState().user && getState().user.fullName) || 'Umutoni Jeannette')}<br/>Librarian
          </div>
        </div>
      </div>
    </div>`).join('');

  const root = document.getElementById('print-root');
  root.innerHTML = `<div style="font-family:Inter,sans-serif;padding:8px">${letterhead({ title: 'Clearance Certificate' })}${body}</div>`;
  setTimeout(() => window.print(), 200);
}
