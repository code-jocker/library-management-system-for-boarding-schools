// routes/fineRoutes.js
const express = require('express');
const { body } = require('express-validator');
const ctrl = require('../controllers/fineController');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/pay', [
  body('fineId').notEmpty().withMessage('Fine is required'),
  body('amount').isFloat({ gt: 0 }).withMessage('Amount must be greater than zero')
], validate, ctrl.pay);
router.post('/waive', [
  body('fineId').notEmpty().withMessage('Fine is required'),
  body('reason').trim().notEmpty().withMessage('A reason is required')
], validate, ctrl.waive);
router.get('/:id/receipt', ctrl.receipt);

module.exports = router;
