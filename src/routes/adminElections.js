/**
 * Admin Election Routes
 * Administrative operations for election management
 * All routes require admin authentication
 */

const express = require('express');
const router = express.Router();
const electionController = require('../controllers/electionController');
const { requireAdmin } = require('../middleware/requireAdmin');
const { csrfProtection } = require('../middleware/csrfProtection');

// GET /api/v1/admin/elections - List all elections (admin only)
router.get('/', requireAdmin, electionController.list.bind(electionController));

// POST /api/v1/admin/elections - Create election (admin only)
router.post('/', requireAdmin, csrfProtection, electionController.create.bind(electionController));

// PATCH /api/v1/admin/elections/:id - Update election (admin only)
router.patch('/:id', requireAdmin, csrfProtection, electionController.update.bind(electionController));

// PATCH /api/v1/admin/elections/:id/status - Update election status (admin only)
router.patch('/:id/status', requireAdmin, csrfProtection, electionController.updateStatus.bind(electionController));

// GET /api/v1/admin/elections/:id/readiness - Check election readiness (admin only)
router.get('/:id/readiness', requireAdmin, electionController.getReadiness.bind(electionController));

// POST /api/v1/admin/elections/:id/publish - Publish election results (admin only)
router.post('/:id/publish', requireAdmin, csrfProtection, electionController.publishResults.bind(electionController));

module.exports = router;
