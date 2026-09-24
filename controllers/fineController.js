// controllers/fineController.js
const Fine = require('../models/Fine');
const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../utils/activityLogger');

function recomputeStatus(fine) {
  if (fine.status === 'waived') return;
  if (fine.paidAmount >= fine.amount) fine.status = 'paid';
  else if (fine.paidAmount > 0) fine.status = 'partial';
  else fine.status = 'unpaid';
}

// GET /api/fines?status=&memberId=&q=&page=&limit=
const list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.memberId) filter.member = req.query.memberId;
  if (req.query.q) {
    const rx = new RegExp(req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [{ memberName: rx }, { bookTitle: rx }, { receiptNo: rx }];
  }

  const [items, total] = await Promise.all([
    Fine.find(filter)
      .populate('member', 'fullName admissionNo classLevel')
      .populate('book', 'title isbn')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Fine.countDocuments(filter)
  ]);

  res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit), limit } });
});

// POST /api/fines/pay  { fineId, amount, method, note }
const pay = asyncHandler(async (req, res) => {
  const { fineId, amount, method = 'cash', note = '' } = req.body;
  const fine = await Fine.findById(fineId);
  if (!fine) return res.status(404).json({ success: false, message: 'Fine not found' });
  if (fine.status === 'waived') return res.status(400).json({ success: false, message: 'This fine was waived' });
  if (fine.status === 'paid') return res.status(400).json({ success: false, message: 'This fine is already fully paid' });

  const remaining = fine.amount - fine.paidAmount;
  const paying = Number(amount);
  if (!paying || paying <= 0) {
    return res.status(400).json({ success: false, message: 'Enter a payment greater than zero', errors: { amount: 'Must be greater than zero' } });
  }
  if (paying > remaining) {
    return res.status(400).json({ success: false, message: `Payment exceeds the balance of ${remaining}`, errors: { amount: `Max is ${remaining}` } });
  }

  fine.payments.push({ amount: paying, method, note, receivedBy: req.user._id, paidAt: new Date() });
  fine.paidAmount += paying;
  recomputeStatus(fine);
  await fine.save();

  await logActivity({ req, action: 'payment', entity: 'fine', entityId: fine._id, message: `Received ${paying} for ${fine.receiptNo} (${fine.memberName})`, meta: { amount: paying, method } });

  const populated = await Fine.findById(fine._id).populate('member', 'fullName admissionNo classLevel').lean();
  res.json({ success: true, data: { fine: populated }, message: `Payment recorded. Balance: ${fine.amount - fine.paidAmount}` });
});

// POST /api/fines/waive  { fineId, reason }
const waive = asyncHandler(async (req, res) => {
  const { fineId, reason = '' } = req.body;
  if (!reason.trim()) {
    return res.status(400).json({ success: false, message: 'A reason is required to waive a fine', errors: { reason: 'Required' } });
  }
  const fine = await Fine.findById(fineId);
  if (!fine) return res.status(404).json({ success: false, message: 'Fine not found' });
  if (fine.status === 'paid') return res.status(400).json({ success: false, message: 'This fine is already paid' });

  fine.status = 'waived';
  fine.waivedReason = reason.trim();
  fine.waivedBy = req.user._id;
  await fine.save();

  await logActivity({ req, action: 'waive', entity: 'fine', entityId: fine._id, message: `Waived fine ${fine.receiptNo}: ${reason}` });
  res.json({ success: true, data: { fine }, message: 'Fine waived' });
});

// GET /api/fines/:id/receipt
const receipt = asyncHandler(async (req, res) => {
  const settings = await Setting.get();
  const fine = await Fine.findById(req.params.id)
    .populate('member', 'fullName admissionNo classLevel dormitory')
    .populate('book', 'title isbn')
    .populate('payments.receivedBy', 'fullName')
    .lean();
  if (!fine) return res.status(404).json({ success: false, message: 'Fine not found' });
  res.json({ success: true, data: { fine, settings } });
});

module.exports = { list, pay, waive, receipt };
