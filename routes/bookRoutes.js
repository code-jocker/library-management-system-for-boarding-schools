// routes/bookRoutes.js
const express = require('express');
const { body } = require('express-validator');
const ctrl = require('../controllers/bookController');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

const bookRules = [
  body('title').trim().notEmpty().withMessage('Title is required'),
  body('author').trim().notEmpty().withMessage('Author is required'),
  body('isbn').trim().notEmpty().withMessage('ISBN / book code is required'),
  body('totalCopies').optional().isInt({ min: 0 }).withMessage('Copies must be a number')
];

router.get('/', ctrl.list);
router.get('/meta/options', ctrl.options);
router.get('/lookup', ctrl.lookup);
router.get('/:id', ctrl.getOne);
router.post('/', bookRules, validate, ctrl.create);
router.put('/:id', bookRules, validate, ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
