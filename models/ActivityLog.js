// models/ActivityLog.js
const mongoose = require('mongoose');

const activityLogSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    userName: { type: String, default: 'System' },
    action: {
      type: String,
      required: true
      // e.g. login, issue, return, renew, mark-lost, create, update, delete,
      // payment, waive, import, settings.update
    },
    entity: { type: String, default: '' }, // book, member, transaction, fine...
    entityId: { type: String, default: '' },
    message: { type: String, default: '' },
    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
    ip: { type: String, default: '' }
  },
  { timestamps: true }
);

activityLogSchema.index({ createdAt: -1 });
activityLogSchema.index({ action: 1, entity: 1 });

module.exports = mongoose.model('ActivityLog', activityLogSchema);
