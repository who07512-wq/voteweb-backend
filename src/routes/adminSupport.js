/**
 * Admin Support Request Routes
 */

const express = require('express');
const router = express.Router();
const adminSupportController = require('../controllers/adminSupportController');
const { requireAdmin } = require('../middleware/requireAdmin');
const { csrfProtection } = require('../middleware/csrfProtection');

// All routes require admin
router.use(requireAdmin);

router.get('/', adminSupportController.list.bind(adminSupportController));
router.get('/:id', adminSupportController.get.bind(adminSupportController));
router.patch('/:id', csrfProtection, adminSupportController.update.bind(adminSupportController));

module.exports = router;
