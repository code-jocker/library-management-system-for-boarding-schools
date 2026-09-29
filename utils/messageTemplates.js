// utils/messageTemplates.js
// Builds the text of overdue / fine reminders from live library data.
// Shared by the WhatsApp and email channels so both say the same thing.

// Rwanda numbers are 07XXXXXXXX / +2507XXXXXXXX. wa.me needs digits only.
function normalisePhone(raw) {
  if (!raw) return '';
  let digits = String(raw).replace(/[^\d]/g, '');
  if (!digits) return '';
  if (digits.startsWith('250')) digits = digits.slice(3);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  return `250${digits}`;
}

// Guard against loops and obviously wrong numbers before building a link.
function isUsablePhone(raw) {
  const digits = normalisePhone(raw);
  return /^250\d{9}$/.test(digits);
}

function isUsableEmail(raw) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(raw || '').trim());
}

function formatDate(date) {
  if (!date) return '-';
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * @param {object} opts
 * @param {object} opts.member      Member document.
 * @param {Array}  opts.overdue     Transactions past their due date.
 * @param {Array}  opts.fines       Fines with a remaining balance.
 * @param {object} opts.settings    The settings document.
 * @returns {{ subject: string, text: string, html: string, amount: number, books: string[] }}
 */
function buildReminder({ member, overdue = [], fines = [], settings }) {
  const school = (settings && settings.schoolName) || 'the Library';
  const symbol = (settings && settings.currencySymbol) || '';
  const perDay = (settings && settings.finePerDay) || 0;
  const books = overdue.map((t) => t.bookTitle || 'Untitled');
  const outstanding = fines.reduce((sum, f) => sum + Math.max(0, (f.amount || 0) - (f.paidAmount || 0)), 0);

  const lines = [
    `Dear ${member.fullName || 'Student'} (${member.admissionNo || 'member'}),`,
    '',
    `This is a reminder from ${school} Library.`
  ];

  if (overdue.length) {
    lines.push('', `You have ${overdue.length} book(s) that are now overdue:`);
    overdue.forEach((t) => {
      const daysLate = Math.max(0, Math.floor((Date.now() - new Date(t.dueDate).getTime()) / 86400000));
      lines.push(`- ${t.bookTitle || 'Untitled'} (due ${formatDate(t.dueDate)}, ${daysLate} day(s) late)`);
    });
    lines.push('');
    lines.push(
      `Please return or renew them at the library desk. A charge of ${symbol}${perDay} applies per day per book.`
    );
  }

  if (fines.length) {
    lines.push('', 'Outstanding fines:');
    fines.forEach((f) => {
      const balance = Math.max(0, (f.amount || 0) - (f.paidAmount || 0));
      lines.push(`- Receipt ${f.receiptNo || '-'}: ${symbol}${balance} remaining (for ${f.bookTitle || 'a book'})`);
    });
    lines.push('', `Total outstanding: ${symbol}${outstanding}.`);
  }

  lines.push('', `For any question contact the library on ${(settings && settings.phone) || ''}. Thank you.`, '');

  const text = lines.join('\n');
  const subject = overdue.length
    ? `Overdue books reminder - ${member.fullName || member.admissionNo}`
    : `Library fine notice - ${member.fullName || member.admissionNo}`;

  const rows = overdue
    .map(
      (t) =>
        `<tr><td>${escapeHtml(t.bookTitle || 'Untitled')}</td><td>${formatDate(t.dueDate)}</td></tr>`
    )
    .join('');
  const fineRows = fines
    .map(
      (f) =>
        `<tr><td>${escapeHtml(f.receiptNo || '-')}</td><td>${escapeHtml(f.bookTitle || '-')}</td><td>${symbol}${Math.max(
          0,
          (f.amount || 0) - (f.paidAmount || 0)
        )}</td></tr>`
    )
    .join('');

  const html = `
    <div style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#1f2937;line-height:1.5">
      <p>Dear ${escapeHtml(member.fullName || 'Student')} (${escapeHtml(member.admissionNo || 'member')}),</p>
      <p>This is a reminder from <strong>${escapeHtml(school)}</strong> Library.</p>
      ${
        rows
          ? `<p>You have <strong>${overdue.length}</strong> book(s) that are now overdue:</p>
             <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#d1d5db">
               <tr style="background:#f3f4f6"><th align="left">Book</th><th align="left">Was due</th></tr>
               ${rows}
             </table>`
          : ''
      }
      ${fines.length ? `<p>Outstanding fines:</p><table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;border-color:#d1d5db">
          <tr style="background:#f3f4f6"><th align="left">Receipt</th><th align="left">Book</th><th align="left">Balance</th></tr>
          ${fineRows}
        </table><p><strong>Total outstanding: ${symbol}${outstanding}</strong></p>` : ''}
      <p>A charge of <strong>${symbol}${perDay} per day</strong> applies for each overdue book. Please return or renew at the desk.</p>
      <p>Library contact: ${escapeHtml((settings && settings.phone) || '')}</p>
    </div>`;

  return { subject, text, html, amount: outstanding, books };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// wa.me opens the chat with the message already typed for the recipient.
function whatsappLink(phone, text) {
  return `https://wa.me/${normalisePhone(phone)}?text=${encodeURIComponent(text)}`;
}

module.exports = { buildReminder, whatsappLink, normalisePhone, isUsablePhone, isUsableEmail, formatDate };
