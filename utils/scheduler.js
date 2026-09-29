// utils/scheduler.js
// In-process scheduler for automated daily overdue reminders.
// Renders on every server start — works on free tiers (Render/Railway) that
// don't support background cron workers.
const cron = require('node:cron');
const { collectTargets } = require('../controllers/notificationController');
const { whatsappLink, isUsablePhone, isUsableEmail } = require('./messageTemplates');
const mailer = require('./mailer');
const Setting = require('../models/Setting');
const Subscription = require('../models/Subscription');
const push = require('./pushNotifications');

let scheduled = false;

function start() {
  if (!process.env.REMINDER_CRON) {
    console.log('[scheduler] REMINDER_CRON not set — automated reminders disabled');
    return;
  }
  if (scheduled) return;
  scheduled = true;

  // Run at the configured cron schedule (default: every day at 08:00 server time).
  cron.schedule(process.env.REMINDER_CRON, async () => {
    console.log('[scheduler] Running automated overdue reminders...');
    try {
      const settings = await Setting.get();
      const targets = await collectTargets({});

      for (const { member, overdue: loans, fines } of targets) {
        await sendReminderForMember(member, loans, fines, settings);
      }
      console.log(`[scheduler] Processed ${targets.length} member(s)`);
    } catch (err) {
      console.error('[scheduler] Error:', err.message);
    }
  });

  console.log(`[scheduler] Scheduled daily reminders with cron: ${process.env.REMINDER_CRON}`);
}

// Send a reminder to a member — email (SMTP) or browser push notification.
async function sendReminderForMember(member, loans, fines, settings) {
  const { buildReminder } = require('./messageTemplates');
  const { subject, text, html, amount, books } = buildReminder({ member, overdue: loans, fines, settings });

  // Email
  if (member.guardianEmail || member.email) {
    const to = member.guardianEmail || member.email;
    if (isUsableEmail(to)) {
      await mailer.sendEmail({ to, subject, html, text });
      console.log(`[scheduler] Email sent to ${to} for ${member.fullName}`);
    }
  }

  // Browser push (if they have an active subscription)
  const subs = await Subscription.find({ user: null }).lean(); // TODO: tie to user when multi-user
  if (subs.length && push.isConfigured()) {
    await push.sendToUser(subs, subject, text, '/');
  }
}

module.exports = { start };
