// routes/transactionRoutes.js
const express = require('express');
const { body } = require('express-validator');
const ctrl = require('../controllers/transactionController');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.get('/overdue', ctrl.overdue);
router.post('/issue', [
  body('memberId').notEmpty().withMessage('Member is required'),
  body('bookId').notEmpty().withMessage('Book is required')
], validate, ctrl.issue);
router.post('/return', [
  body('transactionId').notEmpty().withMessage('Loan is required')
], validate, ctrl.returnBook);
router.post('/renew', [
  body('transactionId').notEmpty().withMessage('Loan is required')
], validate, ctrl.renew);
router.post('/mark-lost', [
  body('transactionId').notEmpty().withMessage('Loan is required')
], validate, ctrl.markLostOrDamaged);
router.post('/mark-damaged', [
  body('transactionId').notEmpty().withMessage('Loan is required')
], validate, ctrl.markLostOrDamaged);

module.exports = router;
