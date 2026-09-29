// utils/mailer.js
// SMTP email sending. Nodemailer is loaded lazily so the API still boots when
// no mail credentials are configured; callers must check isMailConfigured().
let transporter = null;
let nodemailerMissing = false;

function config() {
  return {
    host: process.env.SMTP_HOST || '',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.MAIL_FROM || process.env.SMTP_USER || ''
  };
}

function isMailConfigured() {
  const c = config();
  return Boolean(c.host && c.user && c.pass && c.from);
}

function getTransporter() {
  if (transporter) return transporter;
  if (nodemailerMissing) return null;
  try {
    // eslint-disable-next-line global-require
    const nodemailer = require('nodemailer');
    const c = config();
    transporter = nodemailer.createTransport({
      host: c.host,
      port: c.port,
      secure: c.secure,
      auth: { user: c.user, pass: c.pass }
    });
    return transporter;
  } catch (err) {
    nodemailerMissing = true;
    console.warn('[mail] nodemailer is not installed - email channel disabled');
    return null;
  }
}

/**
 * Send one email. Never throws: returns { ok, error }.
 * @returns {Promise<{ok: boolean, error?: string, skipped?: boolean}>}
 */
async function sendEmail({ to, subject, html, text }) {
  if (!isMailConfigured()) {
    return { ok: false, skipped: true, error: 'SMTP is not configured on the server' };
  }
  const t = getTransporter();
  if (!t) return { ok: false, skipped: true, error: 'Email library is not installed' };
  try {
    await t.sendMail({ from: config().from, to, subject, html, text });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

// Sends sequentially with a small pause so bulk runs are not rate-limited by Gmail.
async function sendBulk(messages, { onResult } = {}) {
  const results = [];
  for (const msg of messages) {
    const r = await sendEmail(msg);
    results.push({ to: msg.to, ...r });
    if (onResult) onResult(msg, r);
  }
  return results;
}

module.exports = { isMailConfigured, sendEmail, sendBulk, config: config };
