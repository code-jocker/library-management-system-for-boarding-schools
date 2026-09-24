// controllers/settingController.js
const Setting = require('../models/Setting');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../utils/activityLogger');

const MAX_IMAGE_CHARS = 400000;

// GET /api/settings
const get = asyncHandler(async (req, res) => {
  const settings = await Setting.get();
  res.json({ success: true, data: { settings } });
});

// PUT /api/settings
const update = asyncHandler(async (req, res) => {
  const b = req.body;
  if (b.logo && b.logo.length > MAX_IMAGE_CHARS) {
    return res.status(413).json({ success: false, message: 'Logo image is too large' });
  }
  const settings = await Setting.get();
  const editable = [
    'schoolName', 'motto', 'address', 'phone', 'email', 'logo',
    'academicYear', 'term', 'loanDays', 'borrowingLimit', 'teacherBorrowingLimit',
    'finePerDay', 'currency', 'currencySymbol', 'reservationHoldDays', 'defaultLanguage',
    'classLevels', 'streams', 'dormitories'
  ];
  for (const f of editable) if (b[f] !== undefined) settings[f] = b[f];
  await settings.save();
  await logActivity({ req, action: 'settings.update', entity: 'setting', entityId: settings._id, message: 'Updated library settings' });
  res.json({ success: true, data: { settings }, message: 'Settings saved' });
});

module.exports = { get, update };
