/**
 * Admin Club Routes
 * Administrative operations for club management
 * All routes require admin authentication
 */

const express = require('express');
const router = express.Router();
const clubController = require('../controllers/clubController');
const { requireAdmin } = require('../middleware/requireAdmin');

// PATCH /api/v1/admin/clubs/:id - Update club (admin only)
router.patch('/:id', requireAdmin, clubController.update.bind(clubController));

module.exports = router;
