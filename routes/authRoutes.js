// routes/authRoutes.js
const express = require('express');
const { body } = require('express-validator');
const ctrl = require('../controllers/authController');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { loginLimiter } = require('../middleware/rateLimiter');

const router = express.Router();

router.post('/login', loginLimiter, [
  body('username').trim().notEmpty().withMessage('Username is required'),
  body('password').notEmpty().withMessage('Password is required')
], validate, ctrl.login);

router.get('/me', requireAuth, ctrl.me);

router.post('/change-password', requireAuth, [
  body('currentPassword').notEmpty().withMessage('Current password is required'),
  body('newPassword').isLength({ min: 8 }).withMessage('New password must be at least 8 characters')
], validate, ctrl.changePassword);

router.put('/profile', requireAuth, [
  body('fullName').optional().trim().notEmpty().withMessage('Name cannot be empty')
], validate, ctrl.updateProfile);

module.exports = router;
