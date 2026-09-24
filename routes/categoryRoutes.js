// routes/categoryRoutes.js
const express = require('express');
const { body } = require('express-validator');
const ctrl = require('../controllers/categoryController');
const { requireAuth } = require('../middleware/auth');
const validate = require('../middleware/validate');

const router = express.Router();
router.use(requireAuth);

const rules = [body('name').trim().notEmpty().withMessage('Category name is required')];

router.get('/', ctrl.list);
router.post('/', rules, validate, ctrl.create);
router.put('/:id', rules, validate, ctrl.update);
router.delete('/:id', ctrl.remove);

module.exports = router;
