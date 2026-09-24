// controllers/memberController.js
const Member = require('../models/Member');
const Transaction = require('../models/Transaction');
const Fine = require('../models/Fine');
const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../utils/activityLogger');
const { calculateFine } = require('../utils/fineCalculator');
const { nextAdmissionNo } = require('../utils/admissionNo');

const MAX_IMAGE_CHARS = 400000;

// GET /api/members?q=&classLevel=&stream=&dormitory=&memberType=&status=&sort=&page=&limit=
const list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const filter = {};

  if (req.query.q) {
    const rx = new RegExp(req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ fullName: rx }, { admissionNo: rx }, { guardianName: rx }];
  }
  for (const f of ['classLevel', 'stream', 'dormitory', 'memberType', 'status']) {
    if (req.query[f]) filter[f] = req.query[f];
  }

  const sortMap = {
    name: { fullName: 1 },
    '-name': { fullName: -1 },
    admission: { admissionNo: 1 },
    '-admission': { admissionNo: -1 },
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 }
  };
  const sort = sortMap[req.query.sort] || { fullName: 1 };

  const [items, total] = await Promise.all([
    Member.find(filter).sort(sort).skip((page - 1) * limit).limit(limit).lean(),
    Member.countDocuments(filter)
  ]);

  res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit), limit } });
});

// GET /api/members/lookup?admissionNo=  (scan lookup at the desk)
const lookup = asyncHandler(async (req, res) => {
  const no = String(req.query.admissionNo || '').trim().toUpperCase();
  if (!no) return res.status(400).json({ success: false, message: 'Admission number is required' });

  const settings = await Setting.get();
  const member = await Member.findOne({ admissionNo: no }).lean();
  if (!member) return res.status(404).json({ success: false, message: 'No member matches that admission number' });

  // Current loans + live overdue/fine info for the desk card.
  const loans = await Transaction.find({ member: member._id, status: { $in: ['borrowed', 'overdue'] } })
    .populate('book', 'title isbn cover')
    .sort({ dueDate: 1 })
    .lean();

  let overdueCount = 0;
  let overdueFine = 0;
  for (const l of loans) {
    const { days, amount } = calculateFine(l.dueDate, settings.finePerDay);
    if (days > 0) {
      overdueCount += 1;
      overdueFine += amount;
    }
  }

  const unpaidFines = await Fine.aggregate([
    { $match: { member: member._id, status: { $in: ['unpaid', 'partial'] } } },
    { $group: { _id: null, total: { $sum: { $subtract: ['$amount', '$paidAmount'] } } } }
  ]);
  const unpaidAmount = unpaidFines[0] ? unpaidFines[0].total : 0;

  const limit = member.borrowingLimit != null
    ? member.borrowingLimit
    : (member.memberType === 'teacher' ? settings.teacherBorrowingLimit : settings.borrowingLimit);

  res.json({
    success: true,
    data: {
      member,
      loans,
      activeLoanCount: loans.length,
      borrowingLimit: limit,
      overdueCount,
      overdueFine,
      unpaidFines: unpaidAmount
    }
  });
});

// GET /api/members/:id
const getOne = asyncHandler(async (req, res) => {
  const settings = await Setting.get();
  const member = await Member.findById(req.params.id).lean();
  if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

  const [loans, fines, history] = await Promise.all([
    Transaction.find({ member: member._id, status: { $in: ['borrowed', 'overdue'] } })
      .populate('book', 'title isbn cover dueDate')
      .sort({ dueDate: 1 })
      .lean(),
    Fine.find({ member: member._id }).sort({ createdAt: -1 }).lean(),
    Transaction.find({ member: member._id }).sort({ createdAt: -1 }).limit(50)
      .populate('book', 'title isbn cover')
      .lean()
  ]);

  const unpaidAmount = fines
    .filter((f) => f.status === 'unpaid' || f.status === 'partial')
    .reduce((sum, f) => sum + (f.amount - f.paidAmount), 0);

  res.json({
    success: true,
    data: { member, loans, fines, history, unpaidAmount, settings }
  });
});

// POST /api/members
const create = asyncHandler(async (req, res) => {
  const b = { ...req.body };
  if (b.photo && b.photo.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ success: false, message: 'Photo is too large' });
  }
  // Admission numbers are system-generated unless the librarian supplies one.
  const auto = !b.admissionNo || !String(b.admissionNo).trim();
  if (auto) delete b.admissionNo;

  // Retry on the rare duplicate-key race (two requests generating the same number).
  let member = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (auto) b.admissionNo = await nextAdmissionNo();
    try {
      member = await Member.create(b);
      break;
    } catch (err) {
      const dup = err && (err.code === 11000 || /duplicate/i.test(err.message || ''));
      if (!dup || !auto) throw err;
    }
  }

  await logActivity({ req, action: 'create', entity: 'member', entityId: member._id, message: `Added member ${member.fullName} (${member.admissionNo})` });
  res.status(201).json({ success: true, data: { member }, message: 'Member added' });
});

// PUT /api/members/:id
const update = asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.photo && b.photo.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ success: false, message: 'Photo is too large' });
  }
  const member = await Member.findById(req.params.id);
  if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

  const editable = ['admissionNo', 'fullName', 'gender', 'memberType', 'classLevel', 'stream', 'dormitory', 'phone', 'guardianName', 'guardianPhone', 'photo', 'status', 'borrowingLimit'];
  for (const f of editable) if (b[f] !== undefined) member[f] = b[f];

  await member.save();
  await logActivity({ req, action: 'update', entity: 'member', entityId: member._id, message: `Updated member ${member.fullName}` });
  res.json({ success: true, data: { member }, message: 'Member updated' });
});

// DELETE /api/members/:id
const remove = asyncHandler(async (req, res) => {
  const active = await Transaction.countDocuments({ member: req.params.id, status: { $in: ['borrowed', 'overdue'] } });
  if (active > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete: ${active} active loan(s) exist. Return the books first.`
    });
  }
  const member = await Member.findByIdAndDelete(req.params.id);
  if (!member) return res.status(404).json({ success: false, message: 'Member not found' });
  await logActivity({ req, action: 'delete', entity: 'member', entityId: member._id, message: `Deleted member ${member.fullName}` });
  res.json({ success: true, message: 'Member deleted' });
});

// POST /api/members/bulk-delete  { ids: [...] }
// Deletes several members at once. Any member with an active loan is skipped so
// borrowed books are never orphaned; the response reports both counts.
const bulkRemove = asyncHandler(async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids.filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ success: false, message: 'No members selected' });

  const activeLoans = await Transaction.distinct('member', {
    member: { $in: ids },
    status: { $in: ['borrowed', 'overdue'] }
  });
  const blockedIds = new Set(activeLoans.map(String));
  const deletable = ids.filter((id) => !blockedIds.has(String(id)));

  const result = await Member.deleteMany({ _id: { $in: deletable } });
  const deleted = result.deletedCount || 0;
  const skipped = ids.length - deleted;

  await logActivity({
    req, action: 'delete', entity: 'member',
    message: `Bulk deleted ${deleted} member(s)${skipped ? `, skipped ${skipped} with active loans` : ''}`
  });

  res.json({
    success: true,
    data: { deleted, skipped },
    message: skipped
      ? `Deleted ${deleted} member(s); ${skipped} skipped because they still have books on loan.`
      : `Deleted ${deleted} member(s)`
  });
});

// GET /api/members/:id/card  (data for the printable library card)
const cardData = asyncHandler(async (req, res) => {
  const [member, settings] = await Promise.all([
    Member.findById(req.params.id).lean(),
    Setting.get()
  ]);
  if (!member) return res.status(404).json({ success: false, message: 'Member not found' });
  res.json({ success: true, data: { member, settings } });
});

module.exports = { list, lookup, getOne, create, update, remove, bulkRemove, cardData };
