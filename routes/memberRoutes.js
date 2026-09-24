// routes/memberRoutes.js
const express = require('express');
const { body } = require('express-validator');
const ctrl = require('../controllers/memberController');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

// admissionNo is optional: the system auto-generates one when it is omitted.
const rules = [
  body('admissionNo').optional({ values: 'falsy' }).trim(),
  body('fullName').trim().notEmpty().withMessage('Full name is required')
];

router.get('/', ctrl.list);
router.get('/lookup', ctrl.lookup);
router.get('/:id', ctrl.getOne);
router.get('/:id/card', ctrl.cardData);
router.post('/', rules, validate, ctrl.create);
router.post('/bulk-delete', ctrl.bulkRemove);
router.put('/:id', rules, validate, ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
