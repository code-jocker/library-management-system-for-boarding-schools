// controllers/bookController.js
const Book = require('../models/Book');
const Category = require('../models/Category');
const Transaction = require('../models/Transaction');
const Reservation = require('../models/Reservation');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../utils/activityLogger');

// Client-compressed images must stay small; ~100 KB JPEG -> ~140 KB base64.
const MAX_IMAGE_CHARS = 400000;

// GET /api/books?q=&category=&language=&availability=&sort=&page=&limit=&view=
const list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 12));
  const filter = {};

  if (req.query.q) {
    const rx = new RegExp(req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    // titleOnly=1 restricts the match to the title (used by the issue desk,
    // which searches purely by book title — there is no barcode scanner).
    filter.$or = String(req.query.titleOnly) === '1'
      ? [{ title: rx }]
      : [{ title: rx }, { author: rx }, { isbn: rx }];
  }
  if (req.query.category) filter.category = req.query.category;
  if (req.query.language) filter.language = req.query.language;
  const avail = req.query.availability;
  if (avail === 'available') filter.availableCopies = { $gt: 0 };
  else if (avail === 'unavailable') filter.availableCopies = 0;

  const sortMap = {
    title: { title: 1 },
    '-title': { title: -1 },
    author: { author: 1 },
    '-author': { author: -1 },
    newest: { createdAt: -1 },
    oldest: { createdAt: 1 },
    available: { availableCopies: -1 }
  };
  const sort = sortMap[req.query.sort] || { createdAt: -1 };

  const [items, total] = await Promise.all([
    Book.find(filter)
      .populate('category', 'name color')
      .sort(sort)
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Book.countDocuments(filter)
  ]);

  res.json({
    success: true,
    data: { items, total, page, pages: Math.ceil(total / limit), limit }
  });
});

// GET /api/books/lookup?code=  (fast scan lookup on the issue/return desk)
const lookup = asyncHandler(async (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ success: false, message: 'Book code is required' });
  const rx = new RegExp(`^${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i');
  const book = await Book.findOne({ $or: [{ isbn: rx }, { title: rx }] }).populate('category', 'name color').lean();
  if (!book) return res.status(404).json({ success: false, message: 'No book matches that code' });
  return res.json({ success: true, data: { book } });
});

// GET /api/books/:id
const getOne = asyncHandler(async (req, res) => {
  const book = await Book.findById(req.params.id).populate('category', 'name color').lean();
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });

  const [loans, reservations] = await Promise.all([
    Transaction.find({ book: book._id })
      .sort({ createdAt: -1 })
      .limit(20)
      .populate('member', 'fullName admissionNo classLevel photo')
      .lean(),
    Reservation.countDocuments({ book: book._id, status: { $in: ['waiting', 'ready'] } })
  ]);

  res.json({ success: true, data: { book, loans, reservationCount: reservations } });
});

// POST /api/books
const create = asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.cover && b.cover.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ success: false, message: 'Cover image is too large' });
  }
  const total = Number(b.totalCopies) || 0;
  const book = await Book.create({
    ...b,
    totalCopies: total,
    availableCopies: total
  });
  await logActivity({ req, action: 'create', entity: 'book', entityId: book._id, message: `Added book "${book.title}"` });
  res.status(201).json({ success: true, data: { book }, message: 'Book added' });
});

// PUT /api/books/:id
const update = asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.cover && b.cover.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ success: false, message: 'Cover image is too large' });
  }
  const book = await Book.findById(req.params.id);
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });

  // When total copies changes, shift available copies by the same delta so
  // currently-borrowed copies stay accounted for.
  if (b.totalCopies !== undefined) {
    const newTotal = Number(b.totalCopies) || 0;
    const borrowed = book.totalCopies - book.availableCopies;
    if (newTotal < borrowed) {
      return res.status(400).json({
        success: false,
        message: `Cannot set fewer copies than currently borrowed (${borrowed})`,
        errors: { totalCopies: `At least ${borrowed} copies are on loan` }
      });
    }
    book.availableCopies = newTotal - borrowed;
    book.totalCopies = newTotal;
  }

  const editable = ['title', 'author', 'isbn', 'category', 'publisher', 'year', 'edition', 'shelfLocation', 'language', 'cover', 'description', 'replacementValue'];
  for (const f of editable) if (b[f] !== undefined) book[f] = b[f];

  await book.save();
  await logActivity({ req, action: 'update', entity: 'book', entityId: book._id, message: `Updated book "${book.title}"` });
  res.json({ success: true, data: { book }, message: 'Book updated' });
});

// DELETE /api/books/:id
const remove = asyncHandler(async (req, res) => {
  const active = await Transaction.countDocuments({ book: req.params.id, status: { $in: ['borrowed', 'overdue'] } });
  if (active > 0) {
    return res.status(400).json({
      success: false,
      message: `Cannot delete: ${active} active loan(s) exist for this book. Return them first.`
    });
  }
  const book = await Book.findByIdAndDelete(req.params.id);
  if (!book) return res.status(404).json({ success: false, message: 'Book not found' });
  await Reservation.deleteMany({ book: book._id, status: { $in: ['waiting', 'ready'] } });
  await logActivity({ req, action: 'delete', entity: 'book', entityId: book._id, message: `Deleted book "${book.title}"` });
  res.json({ success: true, message: 'Book deleted' });
});

// GET /api/books/meta/options  (distinct languages for filters)
const options = asyncHandler(async (req, res) => {
  const languages = await Book.distinct('language');
  res.json({ success: true, data: { languages: languages.filter(Boolean).sort() } });
});

module.exports = { list, lookup, getOne, create, update, remove, options, MAX_IMAGE_CHARS };
