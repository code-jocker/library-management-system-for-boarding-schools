// controllers/transactionController.js
// Circulation: issue, return, renew, mark lost/damaged, list, overdue.
const mongoose = require('mongoose');
const Transaction = require('../models/Transaction');
const Book = require('../models/Book');
const Member = require('../models/Member');
const Fine = require('../models/Fine');
const Reservation = require('../models/Reservation');
const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../utils/activityLogger');
const { calculateFine, daysOverdue } = require('../utils/fineCalculator');
const { nextReceiptNo } = require('../utils/receiptNumber');

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// Shared eligibility check for issuing a book to a member.
async function checkIssueEligibility(member, book, settings) {
  const reasons = [];

  // 1. Member status
  if (member.status !== 'active') reasons.push(`This member is marked "${member.status}" and cannot borrow.`);

  // 2. Overdue books
  const overdue = await Transaction.countDocuments({
    member: member._id,
    status: { $in: ['borrowed', 'overdue'] },
    dueDate: { $lt: new Date() }
  });
  if (overdue > 0) reasons.push(`Member has ${overdue} overdue book(s). They must be returned first.`);

  // 3. Unpaid fines
  const unpaidAgg = await Fine.aggregate([
    { $match: { member: member._id, status: { $in: ['unpaid', 'partial'] } } },
    { $group: { _id: null, total: { $sum: { $subtract: ['$amount', '$paidAmount'] } } } }
  ]);
  const unpaid = unpaidAgg[0] ? unpaidAgg[0].total : 0;
  if (unpaid > 0) {
    reasons.push(`Member owes ${settings.currencySymbol} ${unpaid.toLocaleString()} in unpaid fines.`);
  }

  // 4. Borrowing limit
  const limit = member.borrowingLimit != null
    ? member.borrowingLimit
    : (member.memberType === 'teacher' ? settings.teacherBorrowingLimit : settings.borrowingLimit);
  const activeLoans = await Transaction.countDocuments({ member: member._id, status: { $in: ['borrowed', 'overdue'] } });
  if (activeLoans >= limit) reasons.push(`Borrowing limit reached (${activeLoans}/${limit} books).`);

  // 5. Availability
  if (book.availableCopies <= 0) reasons.push('No copies of this book are available.');

  return { reasons, limit, activeLoans, unpaid };
}

// POST /api/transactions/issue
const issue = asyncHandler(async (req, res) => {
  const { memberId, bookId, dueDate } = req.body;
  const settings = await Setting.get();

  const [member, book] = await Promise.all([Member.findById(memberId), Book.findById(bookId)]);
  if (!member) return res.status(404).json({ success: false, message: 'Member not found' });
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });

  const eligibility = await checkIssueEligibility(member, book, settings);
  if (eligibility.reasons.length) {
    return res.status(400).json({
      success: false,
      message: 'Cannot issue this book',
      errors: { eligibility: eligibility.reasons.join(' ') },
      data: { reasons: eligibility.reasons, canReserve: book.availableCopies <= 0 }
    });
  }

  // ATOMIC conditional decrement: only succeeds if a copy is still available.
  // This guarantees two simultaneous requests cannot over-issue the last copy.
  const updated = await Book.findOneAndUpdate(
    { _id: book._id, availableCopies: { $gt: 0 } },
    { $inc: { availableCopies: -1 } },
    { new: true }
  );
  if (!updated) {
    return res.status(409).json({ success: false, message: 'No copies available right now. Someone may have just borrowed the last one.' });
  }

  const finalDue = dueDate ? new Date(dueDate) : addDays(new Date(), settings.loanDays);

  let txn;
  try {
    txn = await Transaction.create({
      book: book._id,
      member: member._id,
      issuedBy: req.user._id,
      status: 'borrowed',
      issueDate: new Date(),
      dueDate: finalDue,
      bookTitle: book.title,
      bookIsbn: book.isbn,
      memberName: member.fullName,
      memberAdmissionNo: member.admissionNo
    });
  } catch (err) {
    // Roll the copy back if the transaction insert failed.
    await Book.findByIdAndUpdate(book._id, { $inc: { availableCopies: 1 } });
    throw err;
  }

  // If this member had a waiting/ready reservation for this book, mark it fulfilled.
  await Reservation.findOneAndUpdate(
    { book: book._id, member: member._id, status: { $in: ['waiting', 'ready'] } },
    { status: 'fulfilled', fulfilledAt: new Date() }
  );

  await logActivity({
    req, action: 'issue', entity: 'transaction', entityId: txn._id,
    message: `Issued "${book.title}" to ${member.fullName} (${member.admissionNo})`,
    meta: { bookId: book._id, memberId: member._id, dueDate: finalDue }
  });

  const populated = await txn.populate([
    { path: 'book', select: 'title isbn cover author' },
    { path: 'member', select: 'fullName admissionNo classLevel dormitory photo' }
  ]);

  res.status(201).json({
    success: true,
    data: { transaction: populated, dueDate: finalDue },
    message: `"${book.title}" issued to ${member.fullName}`
  });
});

// POST /api/transactions/return
const returnBook = asyncHandler(async (req, res) => {
  const { transactionId, condition } = req.body; // condition: 'good' | 'damaged'
  const settings = await Setting.get();

  const txn = await Transaction.findById(transactionId).populate('book').populate('member');
  if (!txn) return res.status(404).json({ success: false, message: 'Loan not found' });
  if (txn.status === 'returned') {
    return res.status(400).json({ success: false, message: 'This book was already returned' });
  }

  const now = new Date();
  const { days, amount } = calculateFine(txn.dueDate, settings.finePerDay, now);

  // Damaged/lost handled by dedicated endpoints; here we only settle overdue fines.
  let fine = null;
  if (amount > 0) {
    fine = await Fine.create({
      receiptNo: await nextReceiptNo(),
      member: txn.member._id,
      transaction: txn._id,
      book: txn.book._id,
      reason: 'overdue',
      amount,
      daysOverdue: days,
      status: 'unpaid',
      bookTitle: txn.book.title,
      memberName: txn.member.fullName
    });
  }

  txn.status = 'returned';
  txn.returnDate = now;
  txn.fine = fine ? fine._id : null;
  if (condition === 'damaged') txn.notes = (txn.notes ? txn.notes + '; ' : '') + 'Returned damaged';
  await txn.save();

  // Return the copy to the shelf.
  await Book.findOneAndUpdate({ _id: txn.book._id }, { $inc: { availableCopies: 1 } });

  // Reservation queue: if someone is waiting, hold the returned copy for them.
  const nextRes = await Reservation.findOne({ book: txn.book._id, status: 'waiting' }).sort({ createdAt: 1 });
  let reservationAlert = null;
  if (nextRes) {
    nextRes.status = 'ready';
    nextRes.readyAt = now;
    nextRes.expiresAt = addDays(now, settings.reservationHoldDays);
    await nextRes.save();
    // Take the copy back off the shelf since it is held for the reservist.
    await Book.findOneAndUpdate({ _id: txn.book._id, availableCopies: { $gt: 0 } }, { $inc: { availableCopies: -1 } });
    const resMember = await Member.findById(nextRes.member).select('fullName admissionNo').lean();
    reservationAlert = {
      memberName: resMember ? resMember.fullName : 'A member',
      admissionNo: resMember ? resMember.admissionNo : '',
      holdUntil: nextRes.expiresAt
    };
  }

  await logActivity({
    req, action: 'return', entity: 'transaction', entityId: txn._id,
    message: `Returned "${txn.book.title}" from ${txn.member.fullName}`,
    meta: { fineAmount: amount, daysOverdue: days }
  });

  res.json({
    success: true,
    data: {
      transaction: txn,
      fine,
      daysOverdue: days,
      fineAmount: amount,
      reservationAlert
    },
    message: amount > 0
      ? `Returned. Overdue fine of ${settings.currencySymbol} ${amount.toLocaleString()} (${days} day(s)).`
      : 'Returned successfully. No fine.'
  });
});

// POST /api/transactions/renew
const renew = asyncHandler(async (req, res) => {
  const { transactionId } = req.body;
  const settings = await Setting.get();
  const txn = await Transaction.findById(transactionId).populate('book').populate('member');
  if (!txn) return res.status(404).json({ success: false, message: 'Loan not found' });
  if (txn.status === 'returned') return res.status(400).json({ success: false, message: 'This book is already returned' });

  if (txn.renewCount >= 2) {
    return res.status(400).json({ success: false, message: 'Maximum of 2 renewals already used' });
  }
  if (daysOverdue(txn.dueDate) > 0) {
    return res.status(400).json({ success: false, message: 'Cannot renew an overdue book. Return it first.' });
  }
  // Cannot renew if someone else has reserved this book.
  const reservedByOther = await Reservation.countDocuments({
    book: txn.book._id,
    status: { $in: ['waiting', 'ready'] },
    member: { $ne: txn.member._id }
  });
  if (reservedByOther > 0) {
    return res.status(400).json({ success: false, message: 'Cannot renew: another member has reserved this book' });
  }

  txn.dueDate = addDays(txn.dueDate, settings.loanDays);
  txn.renewCount += 1;
  await txn.save();
  await logActivity({ req, action: 'renew', entity: 'transaction', entityId: txn._id, message: `Renewed "${txn.book.title}" (now due ${txn.dueDate.toDateString()})` });

  res.json({ success: true, data: { transaction: txn, dueDate: txn.dueDate }, message: `Renewed until ${txn.dueDate.toLocaleDateString()}` });
});

// POST /api/transactions/mark-lost   and   mark-damaged share this handler.
const markLostOrDamaged = asyncHandler(async (req, res) => {
  const { transactionId } = req.body;
  const kind = req.path.includes('damaged') ? 'damaged' : 'lost';
  const settings = await Setting.get();
  const txn = await Transaction.findById(transactionId).populate('book').populate('member');
  if (!txn) return res.status(404).json({ success: false, message: 'Loan not found' });
  if (txn.status === 'returned') return res.status(400).json({ success: false, message: 'Book already returned' });

  if (kind === 'lost') {
    txn.status = 'lost';
    // A lost copy is never returned to the shelf, so availableCopies stays as-is.
    const value = txn.book.replacementValue || 0;
    const { amount: overdueAmount, days } = calculateFine(txn.dueDate, settings.finePerDay);
    const totalFine = value + overdueAmount;
    const fine = await Fine.create({
      receiptNo: await nextReceiptNo(),
      member: txn.member._id,
      transaction: txn._id,
      book: txn.book._id,
      reason: 'lost',
      amount: totalFine,
      daysOverdue: days,
      status: 'unpaid',
      bookTitle: txn.book.title,
      memberName: txn.member.fullName
    });
    txn.fine = fine._id;
    txn.notes = (txn.notes ? txn.notes + '; ' : '') + 'Marked lost';
    await txn.save();
    // Reduce total stock by one since the physical copy is gone.
    await Book.findOneAndUpdate({ _id: txn.book._id }, { $inc: { totalCopies: -1 } });
    await logActivity({ req, action: 'mark-lost', entity: 'transaction', entityId: txn._id, message: `Marked "${txn.book.title}" as LOST (fine ${settings.currencySymbol} ${totalFine.toLocaleString()})` });
    return res.json({ success: true, data: { transaction: txn, fine, fineAmount: totalFine }, message: 'Marked as lost' });
  }

  // Damaged: book comes back to the shelf but a replacement/repair fine may apply.
  txn.status = 'damaged';
  txn.returnDate = new Date();
  const value = txn.book.replacementValue || 0;
  const fine = value > 0 ? await Fine.create({
    receiptNo: await nextReceiptNo(),
    member: txn.member._id,
    transaction: txn._id,
    book: txn.book._id,
    reason: 'damaged',
    amount: value,
    status: 'unpaid',
    bookTitle: txn.book.title,
    memberName: txn.member.fullName
  }) : null;
  txn.fine = fine ? fine._id : null;
  txn.notes = (txn.notes ? txn.notes + '; ' : '') + 'Marked damaged';
  await txn.save();
  await Book.findOneAndUpdate({ _id: txn.book._id }, { $inc: { availableCopies: 1 } });
  await logActivity({ req, action: 'mark-damaged', entity: 'transaction', entityId: txn._id, message: `Marked "${txn.book.title}" as DAMAGED` });
  return res.json({ success: true, data: { transaction: txn, fine }, message: 'Marked as damaged' });
});

// GET /api/transactions?status=&memberId=&bookId=&classLevel=&from=&to=&page=&limit=
const list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = {};

  if (req.query.status) filter.status = req.query.status;
  if (req.query.memberId) filter.member = req.query.memberId;
  if (req.query.bookId) filter.book = req.query.bookId;
  if (req.query.from || req.query.to) {
    filter.issueDate = {};
    if (req.query.from) filter.issueDate.$gte = new Date(req.query.from);
    if (req.query.to) filter.issueDate.$lte = new Date(req.query.to + 'T23:59:59');
  }

  const [items, total] = await Promise.all([
    Transaction.find(filter)
      .populate('book', 'title isbn cover')
      .populate('member', 'fullName admissionNo classLevel stream dormitory photo')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Transaction.countDocuments(filter)
  ]);

  res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit), limit } });
});

// GET /api/transactions/overdue
const overdue = asyncHandler(async (req, res) => {
  const settings = await Setting.get();
  const items = await Transaction.find({
    status: { $in: ['borrowed', 'overdue'] },
    dueDate: { $lt: new Date() }
  })
    .populate('book', 'title isbn cover')
    .populate('member', 'fullName admissionNo classLevel stream dormitory guardianName guardianPhone photo')
    .sort({ dueDate: 1 })
    .lean();

  // Mark them 'overdue' in the DB (best-effort) and enrich with live fine data.
  const data = items.map((t) => {
    const { days, amount } = calculateFine(t.dueDate, settings.finePerDay);
    return { ...t, daysOverdue: days, fineSoFar: amount };
  });
  const ids = items.filter((t) => t.status === 'borrowed').map((t) => t._id);
  if (ids.length) {
    await Transaction.updateMany({ _id: { $in: ids } }, { status: 'overdue' });
  }

  res.json({ success: true, data: { items: data, total: data.length, settings } });
});

module.exports = { issue, returnBook, renew, markLostOrDamaged, list, overdue, checkIssueEligibility };
