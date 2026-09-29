// routes/importRoutes.js
const express = require('express');
const ctrl = require('../controllers/importController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// JSON-based import (existing)
router.post('/books/preview', ctrl.previewBooks);
router.post('/books/commit', ctrl.commitBooks);
router.post('/members/preview', ctrl.previewMembers);
router.post('/members/commit', ctrl.commitMembers);

// File upload import (new)
router.post('/books/preview/file', ctrl.upload, ctrl.previewBooksFile);
router.post('/books/commit/file', ctrl.upload, ctrl.commitBooksFile);
router.post('/members/preview/file', ctrl.upload, ctrl.previewMembersFile);
router.post('/members/commit/file', ctrl.upload, ctrl.commitMembersFile);

// Excel-like cell editing for import preview
router.post('/validate-row', ctrl.validateImportRow);
router.post('/update-row', ctrl.updateImportRow);

module.exports = router;
