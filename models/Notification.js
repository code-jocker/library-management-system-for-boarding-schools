// models/Notification.js
// Audit trail of every reminder sent to a member or guardian.
const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema(
  {
    member: { type: mongoose.Schema.Types.ObjectId, ref: 'Member', default: null },
    memberName: { type: String, default: '' },
    admissionNo: { type: String, default: '' },
    // Student number, or the guardian number for whatsapp/email reminders.
    channel: { type: String, enum: ['whatsapp', 'email', 'sms', 'manual'], required: true },
    recipient: { type: String, default: '' }, // phone or email address used
    recipientType: { type: String, enum: ['member', 'guardian'], default: 'guardian' },
    kind: {
      type: String,
      enum: ['overdue', 'due-soon', 'fine', 'clearance', 'general'],
      default: 'overdue'
    },
    subject: { type: String, default: '' },
    body: { type: String, default: '' },
    // Deep link that opens WhatsApp with the message pre-filled.
    link: { type: String, default: '' },
    status: { type: String, enum: ['draft', 'queued', 'sent', 'failed', 'skipped'], default: 'draft' },
    error: { type: String, default: '' },
    relatedBooks: { type: [String], default: [] },
    amount: { type: Number, default: 0 },
    sentBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    sentByName: { type: String, default: '' },
    sentAt: { type: Date, default: null }
  },
  { timestamps: true }
);

notificationSchema.index({ member: 1, createdAt: -1 });
notificationSchema.index({ status: 1, createdAt: -1 });
notificationSchema.index({ admissionNo: 1, createdAt: -1 });

module.exports = mongoose.model('Notification', notificationSchema);
