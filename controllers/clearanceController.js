// controllers/clearanceController.js
// End-of-term clearance: who still holds books or owes fines, and who is clear.
const Member = require('../models/Member');
const Transaction = require('../models/Transaction');
const Fine = require('../models/Fine');
const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');
const { calculateFine } = require('../utils/fineCalculator');

// GET /api/clearance?classLevel=&stream=&dormitory=
const list = asyncHandler(async (req, res) => {
  const settings = await Setting.get();
  const filter = { status: 'active' };
  for (const f of ['classLevel', 'stream', 'dormitory']) if (req.query[f]) filter[f] = req.query[f];

  const members = await Member.find(filter).sort({ classLevel: 1, fullName: 1 }).lean();
  const ids = members.map((m) => m._id);

  const [activeLoans, unpaidFines] = await Promise.all([
    Transaction.find({ member: { $in: ids }, status: { $in: ['borrowed', 'overdue'] } })
      .populate('book', 'title isbn').lean(),
    Fine.find({ member: { $in: ids }, status: { $in: ['unpaid', 'partial'] } }).lean()
  ]);

  const loansByMember = {};
  for (const l of activeLoans) {
    const k = String(l.member);
    loansByMember[k] = loansByMember[k] || [];
    loansByMember[k].push(l);
  }
  const finesByMember = {};
  for (const f of unpaidFines) {
    const k = String(f.member);
    finesByMember[k] = (finesByMember[k] || 0) + (f.amount - f.paidAmount);
  }

  const pending = [];
  const cleared = [];
  for (const m of members) {
    const k = String(m._id);
    const loans = loansByMember[k] || [];
    const fineTotal = finesByMember[k] || 0;
    let overdueFine = 0;
    for (const l of loans) {
      const { days, amount } = calculateFine(l.dueDate, settings.finePerDay);
      if (days > 0) overdueFine += amount;
    }
    const record = {
      member: m,
      bookCount: loans.length,
      books: loans.map((l) => (l.book ? l.book.title : l.bookTitle)),
      fineTotal: fineTotal + overdueFine
    };
    if (loans.length === 0 && fineTotal === 0) cleared.push(record);
    else pending.push(record);
  }

  res.json({ success: true, data: { pending, cleared, settings } });
});

// GET /api/clearance/certificate/:memberId  (data for the printable certificate)
const certificate = asyncHandler(async (req, res) => {
  const settings = await Setting.get();
  const member = await Member.findById(req.params.memberId).lean();
  if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

  const [activeLoans, unpaid] = await Promise.all([
    Transaction.countDocuments({ member: member._id, status: { $in: ['borrowed', 'overdue'] } }),
    Fine.aggregate([
      { $match: { member: member._id, status: { $in: ['unpaid', 'partial'] } } },
      { $group: { _id: null, total: { $sum: { $subtract: ['$amount', '$paidAmount'] } } } }
    ])
  ]);
  const owed = unpaid[0] ? unpaid[0].total : 0;

  res.json({
    success: true,
    data: {
      member,
      settings,
      isCleared: activeLoans === 0 && owed === 0,
      activeLoans,
      outstandingFines: owed,
      issuedOn: new Date()
    }
  });
});

module.exports = { list, certificate };
