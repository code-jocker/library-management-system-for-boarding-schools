// controllers/reservationController.js
const Reservation = require('../models/Reservation');
const Book = require('../models/Book');
const Member = require('../models/Member');
const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../utils/activityLogger');

function addDays(date, days) {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// GET /api/reservations?status=&q=&page=&limit=
const list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const filter = {};
  if (req.query.status) filter.status = req.query.status;
  if (req.query.memberId) filter.member = req.query.memberId;
  if (req.query.bookId) filter.book = req.query.bookId;

  const [items, total] = await Promise.all([
    Reservation.find(filter)
      .populate('book', 'title isbn cover availableCopies')
      .populate('member', 'fullName admissionNo classLevel photo')
      .sort({ createdAt: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Reservation.countDocuments(filter)
  ]);

  // Expire stale 'ready' holds past their expiry.
  const now = new Date();
  const expired = items.filter((r) => r.status === 'ready' && r.expiresAt && new Date(r.expiresAt) < now);
  if (expired.length) {
    await Reservation.updateMany({ _id: { $in: expired.map((e) => e._id) } }, { status: 'expired' });
    expired.forEach((e) => { e.status = 'expired'; });
  }

  res.json({ success: true, data: { items, total, page, pages: Math.ceil(total / limit), limit } });
});

// POST /api/reservations  { bookId, memberId }
const create = asyncHandler(async (req, res) => {
  const { bookId, memberId } = req.body;
  const [book, member] = await Promise.all([Book.findById(bookId), Member.findById(memberId)]);
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });
  if (!member) return res.status(404).json({ success: false, message: 'Member not found' });

  const existing = await Reservation.findOne({ book: bookId, member: memberId, status: { $in: ['waiting', 'ready'] } });
  if (existing) return res.status(400).json({ success: false, message: 'This member already has an active reservation for this book' });

  const queuePos = await Reservation.countDocuments({ book: bookId, status: { $in: ['waiting', 'ready'] } });
  const reservation = await Reservation.create({
    book: bookId,
    member: memberId,
    bookTitle: book.title,
    memberName: member.fullName,
    memberAdmissionNo: member.admissionNo
  });

  await logActivity({ req, action: 'reserve', entity: 'reservation', entityId: reservation._id, message: `${member.fullName} reserved "${book.title}" (position ${queuePos + 1})` });
  res.status(201).json({ success: true, data: { reservation, queuePosition: queuePos + 1 }, message: `Reserved. Queue position ${queuePos + 1}` });
});

// POST /api/reservations/:id/fulfill  (hand the held copy to the member)
const fulfill = asyncHandler(async (req, res) => {
  const reservation = await Reservation.findById(req.params.id).populate('book').populate('member');
  if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });
  if (reservation.status !== 'ready') {
    return res.status(400).json({ success: false, message: 'Only a "ready" (held) reservation can be fulfilled' });
  }

  reservation.status = 'fulfilled';
  reservation.fulfilledAt = new Date();
  await reservation.save();

  // The held copy is released to be issued through the normal Issue flow.
  await Book.findOneAndUpdate({ _id: reservation.book._id }, { $inc: { availableCopies: 1 } });

  await logActivity({ req, action: 'fulfill', entity: 'reservation', entityId: reservation._id, message: `Reservation fulfilled for ${reservation.member.fullName} ("${reservation.book.title}")` });
  res.json({ success: true, data: { reservation }, message: 'Reservation fulfilled. You can now issue the book.' });
});

// POST /api/reservations/:id/cancel
const cancel = asyncHandler(async (req, res) => {
  const reservation = await Reservation.findById(req.params.id).populate('book');
  if (!reservation) return res.status(404).json({ success: false, message: 'Reservation not found' });
  if (['fulfilled', 'cancelled'].includes(reservation.status)) {
    return res.status(400).json({ success: false, message: `This reservation is already ${reservation.status}` });
  }

  const wasReady = reservation.status === 'ready';
  reservation.status = 'cancelled';
  await reservation.save();

  // If we had held a copy, release it and promote the next waiting member.
  if (wasReady) {
    const settings = await Setting.get();
    const next = await Reservation.findOne({ book: reservation.book._id, status: 'waiting' }).sort({ createdAt: 1 });
    if (next) {
      next.status = 'ready';
      next.readyAt = new Date();
      next.expiresAt = addDays(new Date(), settings.reservationHoldDays);
      await next.save();
    } else {
      await Book.findOneAndUpdate({ _id: reservation.book._id }, { $inc: { availableCopies: 1 } });
    }
  }

  await logActivity({ req, action: 'cancel', entity: 'reservation', entityId: reservation._id, message: `Reservation cancelled for "${reservation.book ? reservation.book.title : ''}"` });
  res.json({ success: true, data: { reservation }, message: 'Reservation cancelled' });
});

module.exports = { list, create, fulfill, cancel };
