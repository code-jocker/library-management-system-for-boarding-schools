// routes/assistantRoutes.js
const express = require('express');
const { body } = require('express-validator');
const ctrl = require('../controllers/assistantController');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

// Generous per-route limit: the assistant is chatty, unlike the rest of the API.
const chatLimiter = require('express-rate-limit').rateLimit({
  windowMs: 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many questions. Wait a minute and try again.' }
});

router.get('/status', ctrl.status);
router.post('/chat', chatLimiter, [
  body('message').trim().notEmpty().withMessage('Question is required').isLength({ max: 1000 }).withMessage('Question is too long'),
  body('admissionNo').optional().trim()
], validate, ctrl.chat);

module.exports = router;
