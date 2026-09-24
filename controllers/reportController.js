// controllers/reportController.js
// One handler per report. All accept ?from=&to=&classLevel=&term=&academicYear=
const Transaction = require('../models/Transaction');
const Fine = require('../models/Fine');
const Book = require('../models/Book');
const Member = require('../models/Member');
const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');
const { calculateFine } = require('../utils/fineCalculator');

function dateFilter(query, field = 'issueDate') {
  const f = {};
  if (query.from) f.$gte = new Date(query.from);
  if (query.to) f.$lte = new Date(query.to + 'T23:59:59');
  return Object.keys(f).length ? { [field]: f } : {};
}

// GET /api/reports/books-issued
const booksIssued = asyncHandler(async (req, res) => {
  const match = dateFilter(req.query);
  if (req.query.classLevel) match['member.classLevel'] = req.query.classLevel;
  const rows = await Transaction.find(match)
    .populate('book', 'title isbn')
    .populate('member', 'fullName admissionNo classLevel stream')
    .sort({ issueDate: -1 })
    .lean();
  const filtered = req.query.classLevel ? rows.filter((r) => r.member && r.member.classLevel === req.query.classLevel) : rows;
  res.json({
    success: true,
    data: {
      title: 'Books Issued',
      columns: ['Issued', 'Due', 'Book', 'ISBN', 'Member', 'Admission No', 'Class', 'Status'],
      rows: filtered.map((r) => ({
        Issued: new Date(r.issueDate).toLocaleDateString(),
        Due: new Date(r.dueDate).toLocaleDateString(),
        Book: r.book ? r.book.title : r.bookTitle,
        ISBN: r.book ? r.book.isbn : r.bookIsbn,
        Member: r.member ? r.member.fullName : r.memberName,
        'Admission No': r.member ? r.member.admissionNo : r.memberAdmissionNo,
        Class: r.member ? r.member.classLevel : '',
        Status: r.status
      })),
      total: filtered.length
    }
  });
});

// GET /api/reports/overdue
const overdueReport = asyncHandler(async (req, res) => {
  const settings = await Setting.get();
  const items = await Transaction.find({ status: { $in: ['borrowed', 'overdue'] }, dueDate: { $lt: new Date() } })
    .populate('book', 'title isbn')
    .populate('member', 'fullName admissionNo classLevel guardianPhone')
    .sort({ dueDate: 1 })
    .lean();
  res.json({
    success: true,
    data: {
      title: 'Overdue Books',
      columns: ['Member', 'Admission No', 'Class', 'Book', 'Due', 'Days Late', 'Fine So Far'],
      rows: items.map((t) => {
        const { days, amount } = calculateFine(t.dueDate, settings.finePerDay);
        return {
          Member: t.member ? t.member.fullName : t.memberName,
          'Admission No': t.member ? t.member.admissionNo : '',
          Class: t.member ? t.member.classLevel : '',
          Book: t.book ? t.book.title : t.bookTitle,
          Due: new Date(t.dueDate).toLocaleDateString(),
          'Days Late': days,
          'Fine So Far': amount
        };
      }),
      total: items.length
    }
  });
});

// GET /api/reports/fines-collected
const finesCollected = asyncHandler(async (req, res) => {
  const from = req.query.from ? new Date(req.query.from) : null;
  const to = req.query.to ? new Date(req.query.to + 'T23:59:59') : null;
  const fines = await Fine.find().populate('member', 'fullName admissionNo classLevel').lean();

  const rows = [];
  let collected = 0;
  for (const f of fines) {
    for (const p of f.payments || []) {
      const pd = new Date(p.paidAt);
      if (from && pd < from) continue;
      if (to && pd > to) continue;
      collected += p.amount;
      rows.push({
        Date: pd.toLocaleDateString(),
        Receipt: f.receiptNo,
        Member: f.member ? f.member.fullName : f.memberName,
        'Admission No': f.member ? f.member.admissionNo : '',
        Class: f.member ? f.member.classLevel : '',
        Reason: f.reason,
        Amount: p.amount,
        Method: p.method
      });
    }
  }
  res.json({ success: true, data: { title: 'Fines Collected', columns: ['Date', 'Receipt', 'Member', 'Admission No', 'Class', 'Reason', 'Amount', 'Method'], rows, total: rows.length, collected } });
});

// GET /api/reports/most-borrowed
const mostBorrowed = asyncHandler(async (req, res) => {
  const match = dateFilter(req.query);
  const agg = await Transaction.aggregate([
    { $match: match },
    { $group: { _id: '$book', count: { $sum: 1 }, title: { $first: '$bookTitle' }, isbn: { $first: '$bookIsbn' } } },
    { $sort: { count: -1 } },
    { $limit: Number(req.query.limit) || 15 }
  ]);
  res.json({
    success: true,
    data: {
      title: 'Most Borrowed Books',
      columns: ['Book', 'ISBN', 'Times Borrowed'],
      rows: agg.map((a) => ({ Book: a.title, ISBN: a.isbn, 'Times Borrowed': a.count })),
      total: agg.length
    }
  });
});

// GET /api/reports/unreturned-by-class
const unreturnedByClass = asyncHandler(async (req, res) => {
  const items = await Transaction.find({ status: { $in: ['borrowed', 'overdue', 'lost'] } })
    .populate('member', 'classLevel stream')
    .lean();
  const byClass = {};
  for (const t of items) {
    const c = (t.member && t.member.classLevel) || 'Unassigned';
    byClass[c] = (byClass[c] || 0) + 1;
  }
  const rows = Object.entries(byClass).map(([Class, Count]) => ({ Class, Count })).sort((a, b) => a.Class.localeCompare(b.Class));
  res.json({ success: true, data: { title: 'Unreturned Books by Class', columns: ['Class', 'Unreturned Books'], rows, total: rows.length } });
});

// GET /api/reports/inventory
const inventory = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.query.category) filter.category = req.query.category;
  const books = await Book.find(filter).populate('category', 'name').sort({ title: 1 }).lean();
  res.json({
    success: true,
    data: {
      title: 'Inventory',
      columns: ['Title', 'Author', 'ISBN', 'Category', 'Shelf', 'Total', 'Available'],
      rows: books.map((b) => ({
        Title: b.title, Author: b.author, ISBN: b.isbn,
        Category: b.category ? b.category.name : '', Shelf: b.shelfLocation,
        Total: b.totalCopies, Available: b.availableCopies
      })),
      total: books.length
    }
  });
});

// GET /api/reports/lost-damaged
const lostDamaged = asyncHandler(async (req, res) => {
  const items = await Transaction.find({ status: { $in: ['lost', 'damaged'] } })
    .populate('book', 'title isbn')
    .populate('member', 'fullName admissionNo classLevel')
    .sort({ updatedAt: -1 })
    .lean();
  res.json({
    success: true,
    data: {
      title: 'Lost & Damaged Books',
      columns: ['Book', 'ISBN', 'Member', 'Admission No', 'Class', 'Status', 'Date'],
      rows: items.map((t) => ({
        Book: t.book ? t.book.title : t.bookTitle,
        ISBN: t.book ? t.book.isbn : '',
        Member: t.member ? t.member.fullName : t.memberName,
        'Admission No': t.member ? t.member.admissionNo : '',
        Class: t.member ? t.member.classLevel : '',
        Status: t.status,
        Date: new Date(t.updatedAt || t.createdAt).toLocaleDateString()
      })),
      total: items.length
    }
  });
});

module.exports = { booksIssued, overdueReport, finesCollected, mostBorrowed, unreturnedByClass, inventory, lostDamaged };
