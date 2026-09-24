// utils/activityLogger.js
// Fire-and-forget activity logging. Never blocks or crashes a request.
const ActivityLog = require('../models/ActivityLog');

/**
 * @param {object} opts
 * @param {object} [opts.req]     Express request (for user + ip).
 * @param {string} opts.action    e.g. 'issue', 'create', 'payment'.
 * @param {string} [opts.entity]  book, member, transaction, fine...
 * @param {string} [opts.entityId]
 * @param {string} [opts.message] Human-readable summary.
 * @param {object} [opts.meta]    Extra structured data.
 */
async function logActivity({ req, action, entity = '', entityId = '', message = '', meta = {} }) {
  try {
    const user = req && req.user ? req.user : null;
    await ActivityLog.create({
      user: user ? user._id : null,
      userName: user ? user.fullName : 'System',
      action,
      entity,
      entityId: entityId ? String(entityId) : '',
      message,
      meta,
      ip: req ? (req.headers['x-forwarded-for'] || req.ip || '').toString().split(',')[0].trim() : ''
    });
  } catch (err) {
    // Logging must never break the main flow.
    console.warn('[activity] failed to log:', err.message);
  }
}

module.exports = { logActivity };
