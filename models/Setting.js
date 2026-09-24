// models/Setting.js
// Single-document settings collection. Defaults are created on first run.
const mongoose = require('mongoose');

const settingSchema = new mongoose.Schema(
  {
    schoolName: { type: String, default: 'Green Hills Boarding School' },
    motto: { type: String, default: 'Knowledge · Discipline · Service' },
    address: { type: String, default: 'P.O. Box 123, Kigali, Rwanda' },
    phone: { type: String, default: '+250 788 000 000' },
    email: { type: String, default: 'library@greenhills.rw' },
    logo: { type: String, default: '' }, // compressed base64 data URL

    academicYear: { type: String, default: '2024-2025' },
    term: { type: String, default: 'Term 1' },

    loanDays: { type: Number, default: 14, min: 1 },
    borrowingLimit: { type: Number, default: 3, min: 1 },
    teacherBorrowingLimit: { type: Number, default: 5, min: 1 },
    finePerDay: { type: Number, default: 100, min: 0 },
    currency: { type: String, default: 'RWF' },
    currencySymbol: { type: String, default: 'RF' },

    reservationHoldDays: { type: Number, default: 3, min: 1 },
    defaultLanguage: { type: String, default: 'en' },

    classLevels: { type: [String], default: ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'] },
    streams: { type: [String], default: ['A', 'B', 'C', 'Science', 'Arts'] },
    dormitories: {
      type: [String],
      default: ['Nyagatare', 'Kigali', 'Butare', 'Gisenyi', 'Musanze']
    }
  },
  { timestamps: true }
);

const SETTING_ID = new mongoose.Types.ObjectId('000000000000000000000001');

// Always returns the single settings document, creating defaults if needed.
settingSchema.statics.get = async function get() {
  let doc = await this.findById(SETTING_ID);
  if (!doc) doc = await this.create({ _id: SETTING_ID });
  return doc;
};

module.exports = mongoose.model('Setting', settingSchema);
module.exports.SETTING_ID = SETTING_ID;
