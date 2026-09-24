// models/Fine.js
const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, enum: ['cash', 'mobile-money', 'bank', 'other'], default: 'cash' },
    note: { type: String, default: '' },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    paidAt: { type: Date, default: Date.now }
  },
  { _id: true }
);

const fineSchema = new mongoose.Schema(
  {
    receiptNo: { type: String, unique: true, required: true }, // e.g. RCPT-000123
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    transaction: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', default: null },
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', default: null },
    reason: {
      type: String,
      enum: ['overdue', 'lost', 'damaged', 'other'],
      default: 'overdue'
    },
    amount: { type: Number, required: true, min: 0 },
    paidAmount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['unpaid', 'partial', 'paid', 'waived'],
      default: 'unpaid'
    },
    daysOverdue: { type: Number, default: 0 },
    payments: { type: [paymentSchema], default: [] },
    waivedReason: { type: String, default: '' },
    waivedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    bookTitle: { type: String, default: '' },
    memberName: { type: String, default: '' }
  },
  { timestamps: true }
);

fineSchema.index({ member: 1, status: 1 });
fineSchema.index({ status: 1 });

module.exports = mongoose.model('Fine', fineSchema);
