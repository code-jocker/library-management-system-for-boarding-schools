// models/Member.js
// Students and teachers are member records, not system users.
const mongoose = require('mongoose');

const memberSchema = new mongoose.Schema(
  {
    admissionNo: {
      type: String,
      required: [true, 'Admission number is required'],
      unique: true,
      trim: true,
      uppercase: true
    },
    fullName: { type: String, required: [true, 'Full name is required'], trim: true },
    gender: { type: String, enum: ['Male', 'Female', 'Other'], default: 'Other' },
    memberType: { type: String, enum: ['student', 'teacher'], default: 'student' },
    classLevel: { type: String, trim: true, default: '' }, // e.g. S1..S6 or Grade 1..12
    stream: { type: String, trim: true, default: '' }, // e.g. A, B, Science, Arts
    dormitory: { type: String, trim: true, default: '' },
    phone: { type: String, trim: true, default: '' },
    guardianName: { type: String, trim: true, default: '' },
    guardianPhone: { type: String, trim: true, default: '' },
    photo: { type: String, default: '' }, // compressed base64 data URL
    status: { type: String, enum: ['active', 'inactive', 'graduated'], default: 'active' },
    // Optional override of the global borrowing limit for this member (e.g. teachers).
    borrowingLimit: { type: Number, min: 0, default: null }
  },
  { timestamps: true }
);

memberSchema.index({ fullName: 'text', admissionNo: 'text' });
memberSchema.index({ classLevel: 1, stream: 1, dormitory: 1, status: 1 });

module.exports = mongoose.model('Member', memberSchema);
