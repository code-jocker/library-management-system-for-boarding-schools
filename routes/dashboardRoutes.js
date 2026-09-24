// routes/dashboardRoutes.js
const express = require('express');
const ctrl = require('../controllers/dashboardController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.stats);

module.exports = router;
