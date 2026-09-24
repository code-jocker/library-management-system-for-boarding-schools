// routes/reservationRoutes.js
const express = require('express');
const { body } = require('express-validator');
const ctrl = require('../controllers/reservationController');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.post('/', [
  body('bookId').notEmpty().withMessage('Book is required'),
  body('memberId').notEmpty().withMessage('Member is required')
], validate, ctrl.create);
router.post('/:id/fulfill', ctrl.fulfill);
router.post('/:id/cancel', ctrl.cancel);

module.exports = router;
