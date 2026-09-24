// middleware/auth.js
// JWT protection. Every route except POST /auth/login passes through requireAuth.
const jwt = require('jsonwebtoken');
const User = require('../models/User');

async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    let payload;
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      const msg = e.name === 'TokenExpiredError' ? 'Session expired' : 'Invalid token';
      return res.status(401).json({ success: false, message: msg, code: 'TOKEN_INVALID' });
    }

    const user = await User.findById(payload.sub).select('-passwordHash');
    if (!user) {
      return res.status(401).json({ success: false, message: 'User no longer exists' });
    }

    req.user = user;
    req.token = token;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = { requireAuth };
