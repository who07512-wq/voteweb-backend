/**
 * Admin Announcement Routes
 */

const express = require('express');
const router = express.Router();
const adminAnnouncementController = require('../controllers/adminAnnouncementController');
const { requireAdmin } = require('../middleware/requireAdmin');
const { csrfProtection } = require('../middleware/csrfProtection');

// All routes require admin
router.use(requireAdmin);

router.get('/', adminAnnouncementController.list.bind(adminAnnouncementController));
router.post('/', csrfProtection, adminAnnouncementController.create.bind(adminAnnouncementController));
router.get('/:id', adminAnnouncementController.get.bind(adminAnnouncementController));
router.patch('/:id', csrfProtection, adminAnnouncementController.update.bind(adminAnnouncementController));
router.delete('/:id', csrfProtection, adminAnnouncementController.delete.bind(adminAnnouncementController));

module.exports = router;
