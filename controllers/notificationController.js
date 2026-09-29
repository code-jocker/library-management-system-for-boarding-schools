// controllers/notificationController.js
// Reminders for overdue books and unpaid fines, delivered on WhatsApp and email.
const Member = require('../models/Member');
const Transaction = require('../models/Transaction');
const Fine = require('../models/Fine');
const Setting = require('../models/Setting');
const Notification = require('../models/Notification');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../utils/activityLogger');
const { buildReminder, whatsappLink, isUsablePhone, isUsableEmail } = require('../utils/messageTemplates');
const mailer = require('../utils/mailer');

const NOW = () => new Date();

// Every member with at least one open loan, its overdue list and its fine balance.
async function collectTargets({ memberIds = [], dueSoonDays = null } = {}) {
  const memberFilter = { status: 'active' };
  if (memberIds.length) memberFilter._id = { $in: memberIds };

  const members = await Member.find(memberFilter).lean();
  if (!members.length) return [];
  const memberIdsAll = members.map((m) => m._id);

  const loanFilter = {
    member: { $in: memberIdsAll },
    status: { $in: ['borrowed', 'overdue'] },
    returnDate: null
  };
  if (dueSoonDays != null) loanFilter.dueDate = { $lte: new Date(Date.now() + dueSoonDays * 86400000) };

  const transactions = await Transaction.find(loanFilter).lean();

  const byMember = new Map();
  for (const t of transactions) {
    const key = String(t.member);
    if (!byMember.has(key)) byMember.set(key, []);
    byMember.get(key).push(t);
  }

  const fineFilter = {
    member: { $in: memberIdsAll },
    status: { $in: ['unpaid', 'partial'] }
  };
  const fines = await Fine.find(fineFilter).lean();
  const finesByMember = new Map();
  for (const f of fines) {
    const key = String(f.member);
    if (!finesByMember.has(key)) finesByMember.set(key, []);
    finesByMember.get(key).push(f);
  }

  const results = [];
  for (const member of members) {
    const key = String(member._id);
    const allLoans = byMember.get(key) || [];
    const overdue = allLoans.filter((t) => new Date(t.dueDate) < NOW());
    const memberFines = finesByMember.get(key) || [];
    if (!overdue.length && !memberFines.length) continue;
    results.push({ member, overdue, fines: memberFines });
  }
  return results;
}

// GET /api/notifications/overdue
// Live list of who should be reminded, with the totals per member.
const overdue = asyncHandler(async (req, res) => {
  const dueSoonDays = req.query.dueSoonDays != null && req.query.dueSoonDays !== '' ? Number(req.query.dueSoonDays) : null;
  const settings = await Setting.get();
  const targets = await collectTargets({ dueSoonDays });

  const items = targets.map(({ member, overdue: loans, fines }) => {
    const balance = fines.reduce((s, f) => s + Math.max(0, f.amount - f.paidAmount), 0);
    const daysLate = loans.map((t) => Math.floor((Date.now() - new Date(t.dueDate)) / 86400000));
    return {
      memberId: member._id,
      name: member.fullName,
      admissionNo: member.admissionNo,
      classLevel: member.classLevel,
      dormitory: member.dormitory,
      phone: member.phone,
      email: '',
      guardianName: member.guardianName,
      guardianPhone: member.guardianPhone,
      overdueCount: loans.length,
      maxDaysLate: daysLate.length ? Math.max(...daysLate) : 0,
      fineBalance: balance,
      books: loans.map((t) => ({ title: t.bookTitle, dueDate: t.dueDate, transactionId: t._id }))
    };
  });

  items.sort((a, b) => b.maxDaysLate - a.maxDaysLate || b.fineBalance - a.fineBalance);

  res.json({
    success: true,
    data: {
      items,
      total: items.length,
      totalBooks: items.reduce((s, i) => s + i.overdueCount, 0),
      totalFines: items.reduce((s, i) => s + i.fineBalance, 0),
      settings: { currencySymbol: settings.currencySymbol, finePerDay: settings.finePerDay, phone: settings.phone }
    }
  });
});

// GET /api/notifications?member=&channel=&status=&page=&limit=
const history = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = {};
  if (req.query.member) filter.member = req.query.member;
  if (req.query.admissionNo) filter.admissionNo = req.query.admissionNo;
  if (req.query.channel) filter.channel = req.query.channel;
  if (req.query.status) filter.status = req.query.status;

  const [items, total] = await Promise.all([
    Notification.find(filter)
      .populate('member', 'fullName admissionNo')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Notification.countDocuments(filter)
  ]);
  res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit), limit } });
});

// POST /api/notifications/overdue/:memberId/send  { channel: 'whatsapp'|'email'|'both', recipientType }
// WhatsApp returns a wa.me deep link for the librarian to tap-open (no paid API needed).
// Email goes out over SMTP and can be sent in bulk.
const sendReminder = asyncHandler(async (req, res) => {
  const { channel = 'whatsapp', recipientType = 'guardian', admissionNo = '' } = req.body;
  if (!['whatsapp', 'email', 'both'].includes(channel)) {
    return res.status(400).json({ success: false, message: 'Channel must be whatsapp, email or both' });
  }

  const member = await Member.findById(req.params.memberId);
  if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

  const settings = await Setting.get();
  const targets = await collectTargets({ memberIds: [member._id] });
  const target = targets[0];
  if (!target) {
    return res.status(400).json({ success: false, message: `${member.fullName} has no overdue books or unpaid fines` });
  }

  const { subject, text, html, amount, books } = buildReminder({
    member,
    overdue: target.overdue,
    fines: target.fines,
    settings
  });

  const out = { member: member.fullName, admissionNo: member.admissionNo, subject, amount, books, results: [] };

  const phone = recipientType === 'member' ? member.phone : member.guardianPhone || member.phone;
  const email = recipientType === 'member' ? member.email : member.guardianEmail || member.email;

  if (channel === 'whatsapp' || channel === 'both') {
    if (!isUsablePhone(phone)) {
      out.results.push({ channel: 'whatsapp', status: 'skipped', error: 'No usable phone number on file' });
    } else {
      const link = whatsappLink(phone, text);
      await Notification.create({
        member: member._id,
        memberName: member.fullName,
        admissionNo: member.admissionNo,
        channel: 'whatsapp',
        recipient: phone,
        recipientType,
        kind: 'overdue',
        subject,
        body: text,
        link,
        status: 'queued',
        relatedBooks: books,
        amount,
        sentBy: req.user._id,
        sentByName: req.user.fullName
      });
      out.results.push({ channel: 'whatsapp', status: 'queued', link, message: text });
    }
  }

  if (channel === 'email' || channel === 'both') {
    const to = email;
    if (!isUsableEmail(to)) {
      out.results.push({ channel: 'email', status: 'skipped', error: 'No usable email address on file' });
    } else {
      const r = await mailer.sendEmail({ to, subject, html, text });
      await Notification.create({
        member: member._id,
        memberName: member.fullName,
        admissionNo: member.admissionNo,
        channel: 'email',
        recipient: to,
        recipientType,
        kind: 'overdue',
        subject,
        body: text,
        status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed',
        error: r.error || '',
        relatedBooks: books,
        amount,
        sentBy: req.user._id,
        sentByName: req.user.fullName,
        sentAt: r.ok ? new Date() : null
      });
      out.results.push({ channel: 'email', status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', error: r.error || '' });
    }
  }

  await logActivity({
    req,
    action: 'remind',
    entity: 'member',
    entityId: member._id,
    message: `Sent ${channel} reminder to ${member.fullName} (${member.admissionNo})`,
    meta: { channel, amount, books: books.length }
  });

  res.json({ success: true, data: out, message: `Reminder prepared for ${member.fullName}` });
});

// POST /api/notifications/bulk  { channel, memberIds?: [], admissionNos?: [], limit? }
// Produces WhatsApp links for a whole class/dorm in one call, and sends emails in bulk.
const sendBulkReminders = asyncHandler(async (req, res) => {
  const { channel = 'whatsapp', recipientType = 'guardian', memberIds = [], admissionNos = [], limit = 100 } = req.body;
  if (!['whatsapp', 'email', 'both'].includes(channel)) {
    return res.status(400).json({ success: false, message: 'Channel must be whatsapp, email or both' });
  }
  const cap = Math.min(500, Math.max(1, Number(limit) || 100));

  const filter = { status: 'active' };
  if (memberIds.length) filter._id = { $in: memberIds };
  else if (admissionNos.length) filter.admissionNo = { $in: admissionNos.map((a) => String(a).toUpperCase()) };
  const members = await Member.find(filter).limit(cap).lean();
  if (!members.length) {
    return res.status(404).json({ success: false, message: 'No matching active members found' });
  }

  const settings = await Setting.get();
  const targets = await collectTargets({ memberIds: members.map((m) => m._id) });

  const whatsapp = [];
  const emails = [];
  const skipped = [];

  for (const target of targets) {
    const { member, overdue: loans, fines } = target;
    const { subject, text, html, amount, books } = buildReminder({ member, overdue: loans, fines, settings });
    const phone = recipientType === 'member' ? member.phone : member.guardianPhone || member.phone;
    const to = recipientType === 'member' ? member.email : member.guardianEmail || member.email;

    const doc = {
      member: member._id,
      memberName: member.fullName,
      admissionNo: member.admissionNo,
      recipientType,
      kind: 'overdue',
      subject,
      body: text,
      relatedBooks: books,
      amount,
      sentBy: req.user._id,
      sentByName: req.user.fullName
    };

    if (channel === 'whatsapp' || channel === 'both') {
      if (isUsablePhone(phone)) {
        const link = whatsappLink(phone, text);
        whatsapp.push({ admissionNo: member.admissionNo, name: member.fullName, link, message: text });
        await Notification.create({
          ...doc,
          channel: 'whatsapp',
          recipient: phone,
          link,
          status: 'queued'
        });
      } else {
        skipped.push({ admissionNo: member.admissionNo, name: member.fullName, reason: 'no usable phone' });
        await Notification.create({ ...doc, channel: 'whatsapp', status: 'skipped', error: 'No usable phone number' });
      }
    }

    if ((channel === 'email' || channel === 'both') && isUsableEmail(to)) {
      emails.push({ to, admissionNo: member.admissionNo, name: member.fullName, subject, html, text, doc });
    }
  }

  const emailResults = [];
  if (emails.length) {
    const sent = await mailer.sendBulk(emails, {
      onResult: async (msg, r) => {
        emailResults.push({ to: msg.to, admissionNo: msg.admissionNo, status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed', error: r.error || '' });
        await Notification.create({
          ...msg.doc,
          channel: 'email',
          recipient: msg.to,
          status: r.ok ? 'sent' : r.skipped ? 'skipped' : 'failed',
          error: r.error || '',
          sentAt: r.ok ? new Date() : null
        }).catch((e) => console.warn('[notify] log failed:', e.message));
      }
    });
    void sent;
  }

  await logActivity({
    req,
    action: 'remind-bulk',
    entity: 'member',
    message: `Bulk ${channel} reminder for ${targets.length} member(s)`,
    meta: { channel, whatsapp: whatsapp.length, emails: emailResults.length, skipped: skipped.length }
  });

  res.json({
    success: true,
    data: {
      targeted: targets.length,
      whatsapp,
      emails: emailResults,
      skipped,
      mailConfigured: mailer.isMailConfigured(),
      download: '/api/notifications/export-whatsapp?ids=' + whatsapp.map((w) => w.admissionNo).join(',')
    },
    message: `Prepared reminders for ${targets.length} member(s)`
  });
});

// GET /api/notifications/export-whatsapp?ids=STU001,STU002
// One wa.me link carrying every student in the list, for librarians on one click.
const exportWhatsapp = asyncHandler(async (req, res) => {
  const ids = String(req.query.ids || '')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
  if (!ids.length) return res.status(400).json({ success: false, message: 'Provide ids as a comma separated list of admission numbers' });

  const settings = await Setting.get();
  const members = await Member.find({ admissionNo: { $in: ids } }).lean();
  const targets = await collectTargets({ memberIds: members.map((m) => m._id) });

  const blocks = targets.map(({ member, overdue, fines }) => {
    const { text } = buildReminder({ member, overdue, fines, settings });
    return text;
  });
  if (!blocks.length) return res.status(404).json({ success: false, message: 'None of those members have overdue books or fines' });

  const combined = blocks.join('\n' + '-'.repeat(40) + '\n\n');
  res.json({
    success: true,
    data: {
      count: targets.length,
      message: combined,
      link: whatsappLink(settings.phone, combined)
    }
  });
});

// GET /api/notifications/settings - what channels are usable on this deployment.
const channels = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: {
      whatsapp: { available: true, mode: 'deep-link', note: 'Returns wa.me links to open; no paid API needed' },
      email: { available: mailer.isMailConfigured(), mode: 'smtp', host: mailer.config().host || null }
    }
  });
});

module.exports = { overdue, history, sendReminder, sendBulkReminders, exportWhatsapp, channels };
