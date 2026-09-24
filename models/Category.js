// models/Category.js
const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Category name is required'],
      unique: true,
      trim: true
    },
    description: { type: String, trim: true, default: '' },
    color: { type: String, default: '#1E3A8A' } // used for badges/charts
  },
  { timestamps: true }
);

module.exports = mongoose.model('Category', categorySchema);
