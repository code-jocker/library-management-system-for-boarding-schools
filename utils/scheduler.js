// utils/scheduler.js
// In-process scheduler for automated daily overdue reminders.
// Uses setInterval instead of node:cron (no extra dependency).
// Works on free tiers (Render/Railway) that don't support background cron workers.
const { collectTargets } = require('../controllers/notificationController');
const { isUsableEmail } = require('./messageTemplates');
const mailer = require('./mailer');
const Setting = require('../models/Setting');
const Subscription = require('../models/Subscription');
const push = require('./pushNotifications');

let scheduled = false;

function start() {
  if (scheduled) return;
  scheduled = true;

  // Parse a simple cron-expression into a millisecond interval.
  // Supports 5-field cron: "minute hour day month weekday".
  // Falls back to every 24 hours if REMINDER_CRON is unset.
  const cronStr = process.env.REMINDER_CRON || '0 8 * * *';
  const intervalMs = parseCronToMs(cronStr);

  if (intervalMs <= 0) {
    console.warn('[scheduler] Invalid REMINDER_CRON, disabling automated reminders');
    return;
  }

  // Schedule the next run: compute delay until the next matching time.
  scheduleNext(runOnce, intervalMs);
  console.log(`[scheduler] Automated reminders scheduled (interval: ${Math.round(intervalMs / 1000)}s)`);
}

// Convert a 5-field cron to a recurring interval in milliseconds.
function parseCronToMs(cronStr) {
  const parts = cronStr.trim().split(/\s+/);
  if (parts.length !== 5) return 86400000; // default: 24h
  const [min, hour] = parts;
  const minutes = min === '*' ? 0 : parseInt(min) || 0;
  const hours = hour === '*' ? 0 : parseInt(hour) || 0;
  // Approximate: if both are *, run every hour; otherwise run daily.
  if (min === '*' && hour === '*') return 3600000;
  return 86400000;
}

// Schedule the next run at the next matching cron time, then re-arm.
function scheduleNext(fn, intervalMs) {
  const now = new Date();
  const delay = computeNextDelay(now, process.env.REMINDER_CRON || '0 8 * * *');
  setTimeout(() => {
    fn().catch((e) => console.error('[scheduler] Run error:', e.message));
    // Re-arm on an interval after the first aligned run.
    setInterval(() => {
      fn().catch((e) => console.error('[scheduler] Run error:', e.message));
    }, intervalMs);
  }, delay);
}

// Compute milliseconds until the next 08:00 (or whatever cron specifies).
function computeNextDelay(now, cronStr) {
  const parts = cronStr.trim().split(/\s+/);
  const targetHour = parts[1] === '*' ? (parseInt(parts[1]) || 8) : parseInt(parts[1]) || 8;
  const targetMinute = parts[0] === '*' ? (parseInt(parts[0]) || 0) : parseInt(parts[0]) || 0;
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMinute, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return Math.max(1000, next.getTime() - now.getTime());
}

async function runOnce() {
  console.log('[scheduler] Running automated overdue reminders...');
  try {
    const settings = await Setting.get();
    const targets = await collectTargets({});
    let sent = 0;
    for (const { member, overdue: loans, fines } of targets) {
      await sendReminderForMember(member, loans, fines, settings);
      sent++;
    }
    console.log(`[scheduler] Processed ${sent} member(s) of ${targets.length} targets`);
  } catch (err) {
    console.error('[scheduler] Error:', err.message);
  }
}

// Send a reminder to a member — email (SMTP) or browser push notification.
async function sendReminderForMember(member, loans, fines, settings) {
  const { buildReminder } = require('./messageTemplates');
  const { subject, text, html } = buildReminder({ member, overdue: loans, fines, settings });

  // Email
  if (member.guardianEmail || member.email) {
    const to = member.guardianEmail || member.email;
    if (isUsableEmail(to)) {
      const r = await mailer.sendEmail({ to, subject, html, text });
      if (r.ok) console.log(`[scheduler] Email sent to ${to} for ${member.fullName}`);
    }
  }

  // Browser push (if configured and they have an active subscription)
  const subs = await Subscription.find({}).lean();
  if (subs.length && push.isConfigured()) {
    await push.sendToUser(subs, subject, text, '/app');
  }
}

module.exports = { start, runOnce };
