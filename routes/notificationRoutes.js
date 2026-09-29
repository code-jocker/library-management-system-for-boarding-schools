// routes/notificationRoutes.js
const express = require('express');
const { body } = require('express-validator');
const ctrl = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

router.get('/channels', ctrl.channels);
router.get('/overdue', ctrl.overdue);
router.get('/export-whatsapp', ctrl.exportWhatsapp);
router.get('/', ctrl.history);
router.post('/overdue/:memberId/send', [
  body('channel').optional().isIn(['whatsapp', 'email', 'both']).withMessage('Channel must be whatsapp, email or both'),
  body('recipientType').optional().isIn(['member', 'guardian']).withMessage('Recipient type must be member or guardian')
], validate, ctrl.sendReminder);
router.post('/bulk', [
  body('channel').optional().isIn(['whatsapp', 'email', 'both']).withMessage('Channel must be whatsapp, email or both'),
  body('limit').optional().isInt({ min: 1, max: 500 }).withMessage('Limit must be between 1 and 500')
], validate, ctrl.sendBulkReminders);

module.exports = router;
