// models/Reservation.js
const mongoose = require('mongoose');

const reservationSchema = new mongoose.Schema(
  {
    book: { type: mongoose.Schema.Types.ObjectId, ref: 'Book', required: true },
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', required: true },
    status: {
      type: String,
      enum: ['waiting', 'ready', 'fulfilled', 'cancelled', 'expired'],
      default: 'waiting'
    },
    createdAt: { type: Date, default: Date.now },
    readyAt: { type: Date, default: null }, // when a returned copy was held for them
    expiresAt: { type: Date, default: null }, // readyAt + reservationHoldDays
    fulfilledAt: { type: Date, default: null },
    bookTitle: { type: String, default: '' },
    memberName: { type: String, default: '' },
    memberAdmissionNo: { type: String, default: '' }
  },
  { timestamps: true }
);

// FIFO queue per book.
reservationSchema.index({ book: 1, status: 1, createdAt: 1 });
reservationSchema.index({ member: 1, status: 1 });

module.exports = mongoose.model('Reservation', reservationSchema);
