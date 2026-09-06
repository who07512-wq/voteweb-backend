/**
 * Position Routes
 * API endpoints for position management
 */

const express = require('express');
const router = express.Router();
const positionController = require('../controllers/positionController');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { csrfProtection } = require('../middleware/csrfProtection');

// GET /api/v1/positions - List all positions (public read)
router.get('/', positionController.listAll.bind(positionController));

// GET /api/v1/positions/recommended - Get recommended position names
router.get('/recommended', positionController.getRecommended.bind(positionController));

// GET /api/v1/positions/:id - Get single position (public read)
router.get('/:id', positionController.get.bind(positionController));

// PATCH /api/v1/positions/:id - Update position (admin only)
// Public reads stay open; writes require an authenticated ADMIN session, a
// valid CSRF token, and the election must be DRAFT/SCHEDULED.
router.patch('/:id', requireAuth, requireAdmin, csrfProtection, positionController.update.bind(positionController));

module.exports = router;
