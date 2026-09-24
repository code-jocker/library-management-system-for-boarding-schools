// routes/reportRoutes.js
const express = require('express');
const ctrl = require('../controllers/reportController');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/books-issued', ctrl.booksIssued);
router.get('/overdue', ctrl.overdueReport);
router.get('/fines-collected', ctrl.finesCollected);
router.get('/most-borrowed', ctrl.mostBorrowed);
router.get('/unreturned-by-class', ctrl.unreturnedByClass);
router.get('/inventory', ctrl.inventory);
router.get('/lost-damaged', ctrl.lostDamaged);

module.exports = router;
