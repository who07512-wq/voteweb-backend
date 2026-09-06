/**
 * Candidate Routes
 * API endpoints for candidate management
 */

const express = require('express');
const router = express.Router();
const candidateController = require('../controllers/candidateController');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { csrfProtection } = require('../middleware/csrfProtection');

// GET /api/v1/candidates - List all candidates (public read)
router.get('/', candidateController.listAll.bind(candidateController));

// GET /api/v1/candidates/:id - Get single candidate (public read)
router.get('/:id', candidateController.get.bind(candidateController));

// PATCH /api/v1/candidates/:id - Update candidate (admin only)
// Public reads stay open; writes require an authenticated ADMIN session, a
// valid CSRF token, and the election must be DRAFT/SCHEDULED. Candidate
// self-edits go through /api/candidates/me/profile (ownership-checked), so
// this ballot-row endpoint is admin-managed.
router.patch('/:id', requireAuth, requireAdmin, csrfProtection, candidateController.update.bind(candidateController));

module.exports = router;
