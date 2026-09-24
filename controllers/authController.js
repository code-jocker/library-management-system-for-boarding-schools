// controllers/authController.js
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const asyncHandler = require('../utils/asyncHandler');
const { logActivity } = require('../utils/activityLogger');

function signToken(user) {
  return jwt.sign({ sub: user._id.toString(), role: user.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '8h'
  });
}

function publicUser(user) {
  return {
    id: user._id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    email: user.email,
    phone: user.phone,
    avatar: user.avatar,
    mustChangePassword: user.mustChangePassword
  };
}

// POST /api/auth/login
const login = asyncHandler(async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username: String(username || '').toLowerCase().trim() });
  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid username or password' });
  }
  const ok = await user.comparePassword(password || '');
  if (!ok) {
    return res.status(401).json({ success: false, message: 'Invalid username or password' });
  }

  user.lastLoginAt = new Date();
  await user.save();
  await logActivity({ req, action: 'login', entity: 'user', entityId: user._id, message: `${user.fullName} logged in` });

  return res.json({
    success: true,
    data: { token: signToken(user), user: publicUser(user) },
    message: 'Welcome back'
  });
});

// GET /api/auth/me
const me = asyncHandler(async (req, res) => {
  res.json({ success: true, data: { user: publicUser(req.user) } });
});

// POST /api/auth/change-password
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const user = await User.findById(req.user._id);

  const ok = await user.comparePassword(currentPassword || '');
  if (!ok) {
    return res.status(400).json({
      success: false,
      message: 'Current password is incorrect',
      errors: { currentPassword: 'Current password is incorrect' }
    });
  }

  user.passwordHash = await User.hashPassword(newPassword);
  user.mustChangePassword = false;
  await user.save();
  await logActivity({ req, action: 'change-password', entity: 'user', entityId: user._id, message: 'Password changed' });

  return res.json({ success: true, message: 'Password updated', data: { user: publicUser(user) } });
});

// PUT /api/auth/profile  (librarian edits own contact details/avatar)
const updateProfile = asyncHandler(async (req, res) => {
  const { fullName, email, phone, avatar } = req.body;
  const user = await User.findById(req.user._id);
  if (fullName !== undefined) user.fullName = fullName;
  if (email !== undefined) user.email = email;
  if (phone !== undefined) user.phone = phone;
  if (avatar !== undefined) user.avatar = avatar;
  await user.save();
  await logActivity({ req, action: 'update', entity: 'user', entityId: user._id, message: 'Profile updated' });
  return res.json({ success: true, data: { user: publicUser(user) }, message: 'Profile saved' });
});

module.exports = { login, me, changePassword, updateProfile, publicUser };
