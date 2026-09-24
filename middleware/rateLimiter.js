// middleware/rateLimiter.js
const rateLimit = require('express-rate-limit');

// Login attempt limit (brute-force protection). Short 1-minute window so a
// mistyped password never locks the librarian out for long.
const loginLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many login attempts. Please try again in a minute.'
  }
});

// General limit for the whole API.
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, slow down a moment.' }
});

module.exports = { loginLimiter, apiLimiter };
