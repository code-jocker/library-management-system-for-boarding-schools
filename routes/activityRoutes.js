// routes/activityRoutes.js
const express = require('express');
const ctrl = require('../controllers/activityController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.list);

module.exports = router;
