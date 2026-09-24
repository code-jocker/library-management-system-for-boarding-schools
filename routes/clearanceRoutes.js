// routes/clearanceRoutes.js
const express = require('express');
const ctrl = require('../controllers/clearanceController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', ctrl.list);
router.get('/certificate/:memberId', ctrl.certificate);

module.exports = router;
