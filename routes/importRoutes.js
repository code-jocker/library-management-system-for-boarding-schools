// routes/importRoutes.js
const express = require('express');
const ctrl = require('../controllers/importController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.post('/books/preview', ctrl.previewBooks);
router.post('/books/commit', ctrl.commitBooks);
router.post('/members/preview', ctrl.previewMembers);
router.post('/members/commit', ctrl.commitMembers);

module.exports = router;
