// models/Book.js
const mongoose = require('mongoose');

const bookSchema = new mongoose.Schema(
  {
    title: { type: String, required: [true, 'Title is required'], trim: true },
    author: { type: String, required: [true, 'Author is required'], trim: true },
    isbn: {
      type: String,
      required: [true, 'ISBN / book code is required'],
      unique: true,
      trim: true
    },
    category: { type: mongoose.Schema.Types.ObjectId, ref: 'Category', default: null },
    publisher: { type: String, trim: true, default: '' },
    year: { type: Number, min: 1000, max: 2200, default: null },
    edition: { type: String, trim: true, default: '' },
    shelfLocation: { type: String, trim: true, default: '' },
    language: { type: String, trim: true, default: 'English' },
    totalCopies: { type: Number, required: true, min: 0, default: 1 },
    availableCopies: { type: Number, required: true, min: 0, default: 1 },
    cover: { type: String, default: '' }, // compressed base64 data URL
    description: { type: String, trim: true, default: '' },
    replacementValue: { type: Number, min: 0, default: 0 } // used for lost-book fines
  },
  { timestamps: true }
);

// Text index for fast title/author search.
// language_override:'none' stops MongoDB from treating the Book.language field
// (e.g. "Kinyarwanda") as a text-index stemmer override, which it would reject.
bookSchema.index(
  { title: 'text', author: 'text', isbn: 'text', description: 'text' },
  { language_override: 'none' }
);
bookSchema.index({ category: 1, availableCopies: 1 });

module.exports = mongoose.model('Book', bookSchema);
