/**
 * Public Announcement Routes
 * Read-only announcement endpoints (published announcements only)
 */

const express = require('express');
const router = express.Router();
const announcementController = require('../controllers/announcementController');

// GET /api/v1/announcements - List published announcements (public)
router.get('/', announcementController.list.bind(announcementController));

// GET /api/v1/announcements/:id - Get single published announcement (public)
router.get('/:id', announcementController.get.bind(announcementController));

module.exports = router;