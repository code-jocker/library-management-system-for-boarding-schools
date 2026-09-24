// public/js/print/libraryCard.js
// Printable library card: logo, photo, name, admission number, class,
// QR + barcode of the admission number. Single and bulk (by class).
import { api } from '../core/api.js';
import { getState } from '../core/store.js';
import { escapeHtml, formatDate } from '../core/utils.js';
import { t } from '../core/i18n.js';
import { printDocument, letterhead } from '../core/printer.js';

// Render a single card's HTML (used for both single and bulk printing).
function cardHtml(m, settings) {
  const photo = m.photo
    ? `<img src="${m.photo}" alt="" style="width:64px;height:78px;object-fit:cover;border-radius:4px;border:1px solid #cbd5e1" />`
    : `<div style="width:64px;height:78px;border-radius:4px;border:1px solid #cbd5e1;background:#f1f5f9;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-size:10px">No photo</div>`;
  return `
    <div class="lib-card card-sheet" style="display:inline-block;vertical-align:top;margin:0 6px 10px 0;border:1px solid #1E3A8A;border-radius:8px;overflow:hidden;width:340px;font-family:Inter,sans-serif">
      <div style="background:#1E3A8A;color:#fff;padding:6px 10px;display:flex;align-items:center;gap:8px">
        ${settings.logo ? `<img src="${settings.logo}" style="width:26px;height:26px;border-radius:4px;object-fit:contain;background:#fff" />` : ''}
        <div style="font-family:Poppins,sans-serif;font-weight:700;font-size:12px;line-height:1.1">${escapeHtml(settings.schoolName || 'School')}<div style="font-weight:400;font-size:9px;opacity:.8">Library Card</div></div>
      </div>
      <div style="padding:10px;display:flex;gap:10px">
        ${photo}
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:13px;color:#0f172a;margin-bottom:2px">${escapeHtml(m.fullName)}</div>
          <div style="font-size:10px;color:#475569">Adm. No: <strong>${escapeHtml(m.admissionNo)}</strong></div>
          <div style="font-size:10px;color:#475569">Class: ${escapeHtml(m.classLevel || '—')}${m.stream ? ' ' + escapeHtml(m.stream) : ''}</div>
          <div style="font-size:10px;color:#475569">${escapeHtml(m.memberType === 'teacher' ? 'Teacher' : 'Student')}</div>
          <div id="bc-${m._id}" style="margin-top:6px"></div>
        </div>
      </div>
      <div style="padding:0 10px 8px"><div id="qr-${m._id}"></div></div>
    </div>`;
}

// Generate barcode + QR after the card is in the DOM.
function renderCodes(m) {
  try {
    if (window.JsBarcode) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const holder = document.getElementById(`bc-${m._id}`);
      if (holder) { holder.appendChild(svg); window.JsBarcode(svg, m.admissionNo, { format: 'CODE128', height: 28, fontSize: 10, width: 1.2, margin: 0 }); }
    }
  } catch (e) { /* barcode optional */ }
  try {
    if (window.QRCode) {
      const holder = document.getElementById(`qr-${m._id}`);
      if (holder) { holder.innerHTML = ''; new window.QRCode(holder, { text: m.admissionNo, width: 54, height: 54, correctLevel: window.QRCode.CorrectLevel.M }); }
    }
  } catch (e) { /* qr optional */ }
}

// Print one card.
export async function printLibraryCard(memberId) {
  const res = await api.get(`/members/${memberId}/card`);
  const { member, settings } = res.data;
  const root = document.getElementById('print-root');
  root.innerHTML = `<div style="font-family:Inter,sans-serif;padding:8px">
    ${letterhead({ title: 'Library Card' })}
    ${cardHtml(member, settings)}
  </div>`;
  renderCodes(member);
  setTimeout(() => window.print(), 250);
}

// Print cards for every member matching a filter (e.g. a whole class).
export async function printLibraryCardsBulk(filter = {}) {
  const qs = new URLSearchParams({ ...filter, limit: 200 }).toString();
  const res = await api.get('/members?' + qs);
  const members = (res.data && res.data.items) || [];
  const settings = getState().settings || {};
  if (!members.length) return;
  const root = document.getElementById('print-root');
  root.innerHTML = `<div style="font-family:Inter,sans-serif;padding:8px">
    ${letterhead({ title: 'Library Cards', subtitle: filter.classLevel ? 'Class ' + filter.classLevel : '' })}
    <div>${members.map((m) => cardHtml(m, settings)).join('')}</div>
  </div>`;
  members.forEach(renderCodes);
  setTimeout(() => window.print(), 350);
}
