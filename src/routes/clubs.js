/**
 * Club Routes
 * API endpoints for club management
 * Mounted at: /api/v1/clubs
 */

const express = require('express');
const router = express.Router();
const clubController = require('../controllers/clubController');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { csrfProtection } = require('../middleware/csrfProtection');

// GET /api/v1/clubs - List all clubs (public read)
router.get('/', clubController.listAll.bind(clubController));

// GET /api/v1/clubs/:id - Get single club (public read)
router.get('/:id', clubController.get.bind(clubController));

// PATCH /api/v1/clubs/:id - Update club (admin only)
// Public reads stay open; writes require an authenticated ADMIN session, a
// valid CSRF token, and the election must be in DRAFT/SCHEDULED.
router.patch('/:id', requireAuth, requireAdmin, csrfProtection, clubController.update.bind(clubController));

module.exports = router;
