// controllers/dashboardController.js
const Book = require('../models/Book');
const Member = require('../models/Member');
const Transaction = require('../models/Transaction');
const Fine = require('../models/Fine');
const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');
const { calculateFine } = require('../utils/fineCalculator');

// GET /api/dashboard
const stats = asyncHandler(async (req, res) => {
  const settings = await Setting.get();
  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfDay = new Date(startOfDay); endOfDay.setHours(23, 59, 59, 999);

  const [
    totalBooks, availableCopies, borrowedCount, overdueTxns, totalMembers, unpaidAgg
  ] = await Promise.all([
    Book.countDocuments({}),
    Book.aggregate([{ $group: { _id: null, sum: { $sum: '$availableCopies' } } }]),
    Transaction.countDocuments({ status: { $in: ['borrowed', 'overdue'] } }),
    Transaction.find({ status: { $in: ['borrowed', 'overdue'] }, dueDate: { $lt: now } })
      .populate('book', 'title isbn cover').populate('member', 'fullName admissionNo classLevel photo')
      .sort({ dueDate: 1 }).lean(),
    Member.countDocuments({ status: 'active' }),
    Fine.aggregate([
      { $match: { status: { $in: ['unpaid', 'partial'] } } },
      { $group: { _id: null, total: { $sum: { $subtract: ['$amount', '$paidAmount'] } } } }
    ])
  ]);

  const totalCopies = await Book.aggregate([{ $group: { _id: null, sum: { $sum: '$totalCopies' } } }]);
  const unpaidFines = unpaidAgg[0] ? unpaidAgg[0].total : 0;

  // Enrich overdue with live fines; split due-today.
  const overdue = overdueTxns.map((t) => {
    const { days, amount } = calculateFine(t.dueDate, settings.finePerDay, now);
    return { ...t, daysOverdue: days, fineSoFar: amount };
  });

  const dueTodayTxns = await Transaction.find({
    status: { $in: ['borrowed', 'overdue'] },
    dueDate: { $gte: startOfDay, $lte: endOfDay }
  }).populate('book', 'title isbn cover').populate('member', 'fullName admissionNo classLevel photo').lean();

  // Monthly borrow counts for the last 6 months.
  const monthlyAgg = await Transaction.aggregate([
    { $match: { issueDate: { $gte: new Date(now.getFullYear(), now.getMonth() - 5, 1) } } },
    { $group: { _id: { y: { $year: '$issueDate' }, m: { $month: '$issueDate' } }, count: { $sum: 1 } } },
    { $sort: { '_id.y': 1, '_id.m': 1 } }
  ]);
  const monthly = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const found = monthlyAgg.find((a) => a._id.y === d.getFullYear() && a._id.m === d.getMonth() + 1);
    monthly.push({ label: d.toLocaleString('en', { month: 'short' }), count: found ? found.count : 0 });
  }

  // Books by category (doughnut).
  const byCategory = await Book.aggregate([
    { $group: { _id: '$category', copies: { $sum: '$totalCopies' } } },
    { $lookup: { from: 'categories', localField: '_id', foreignField: '_id', as: 'cat' } },
    { $unwind: { path: '$cat', preserveNullAndEmptyArrays: true } },
    { $project: { name: { $ifNull: ['$cat.name', 'Uncategorised'] }, copies: 1, color: { $ifNull: ['$cat.color', '#1E3A8A'] } } },
    { $sort: { copies: -1 } }
  ]);

  // Most borrowed books (top 5) with covers.
  const topAgg = await Transaction.aggregate([
    { $group: { _id: '$book', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 5 }
  ]);
  const topBooks = await Book.find({ _id: { $in: topAgg.map((t) => t._id) } }).select('title cover isbn').lean();
  const top = topAgg.map((a) => {
    const b = topBooks.find((x) => String(x._id) === String(a._id));
    return { bookId: a._id, title: b ? b.title : 'Unknown', cover: b ? b.cover : '', isbn: b ? b.isbn : '', count: a.count };
  });

  res.json({
    success: true,
    data: {
      stats: {
        totalTitles: totalBooks,
        totalCopies: totalCopies[0] ? totalCopies[0].sum : 0,
        available: availableCopies[0] ? availableCopies[0].sum : 0,
        borrowed: borrowedCount,
        overdue: overdue.length,
        totalMembers,
        unpaidFines
      },
      monthly,
      byCategory: byCategory.map((c) => ({ name: c.name, copies: c.copies, color: c.color })),
      topBooks: top,
      dueToday: dueTodayTxns,
      overdueList: overdue,
      settings
    }
  });
});

module.exports = { stats };
