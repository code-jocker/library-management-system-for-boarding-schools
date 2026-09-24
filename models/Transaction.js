// models/Transaction.js
// One document per loan. Holds the full lifecycle of an issue.
const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
  {
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    issuedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    status: {
      type: String,
      enum: ['borrowed', 'returned', 'overdue', 'lost', 'damaged'],
      default: 'borrowed'
    },
    issueDate: { type: Date, default: Date.now },
    dueDate: { type: Date, required: true },
    returnDate: { type: Date, default: null },
    renewCount: { type: Number, default: 0, max: 2 },
    // Snapshot of titles at issue time so history survives later edits.
    bookTitle: { type: String, default: '' },
    bookIsbn: { type: String, default: '' },
    memberName: { type: String, default: '' },
    memberAdmissionNo: { type: String, default: '' },
    fine: { type: mongoose.Schema.Types.ObjectId, ref: 'Fine', default: null },
    notes: { type: String, default: '' }
  },
  { timestamps: true }
);

transactionSchema.index({ member: 1, status: 1, dueDate: 1 });
transactionSchema.index({ book: 1, status: 1 });
transactionSchema.index({ status: 1, dueDate: 1 });

module.exports = mongoose.model('Transaction', transactionSchema);
