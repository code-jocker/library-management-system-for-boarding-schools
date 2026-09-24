// routes/settingRoutes.js
const express = require('express');
const ctrl = require('../controllers/settingController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.get);
router.put('/', ctrl.update);

module.exports = router;
