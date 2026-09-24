// controllers/activityController.js
const ActivityLog = require('../models/ActivityLog');
const asyncHandler = require('../utils/asyncHandler');

// GET /api/activity?action=&entity=&q=&from=&to=&page=&limit=
const list = asyncHandler(async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 30));
  const filter = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.entity) filter.entity = req.query.entity;
  if (req.query.q) {
    const rx = new RegExp(req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.message = rx;
  }
  if (req.query.from || req.query.to) {
    filter.createdAt = {};
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from);
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to + 'T23:59:59');
  }

  const [items, total, actions, entities] = await Promise.all([
    ActivityLog.find(filter).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    ActivityLog.countDocuments(filter),
    ActivityLog.distinct('action'),
    ActivityLog.distinct('entity')
  ]);

  res.json({
    success: true,
    data: { items, total, page, pages: Math.ceil(total / limit), limit, actions: actions.filter(Boolean), entities: entities.filter(Boolean) }
  });
});

module.exports = { list };
