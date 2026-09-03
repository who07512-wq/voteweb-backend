/**
 * Candidate Application Routes
 * Routes for candidate application workflow
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const candidateAppController = require('../controllers/candidateApplicationController');

// =====================================================
// CANDIDATE ROUTES (authenticated students)
// =====================================================

// POST /api/candidates/apply - Submit application
router.post('/apply', requireAuth, candidateAppController.apply.bind(candidateAppController));

// GET /api/candidates/me/application - Get current user's application
router.get('/me/application', requireAuth, candidateAppController.getMyApplication.bind(candidateAppController));

// GET /api/candidates/me/access - Check candidate portal access
router.get('/me/access', requireAuth, candidateAppController.getAccess.bind(candidateAppController));

// PATCH /api/candidates/me/profile - Update profile content after approval
router.patch('/me/profile', requireAuth, candidateAppController.updateProfile.bind(candidateAppController));

// POST /api/candidates/me/resubmit - Resubmit after changes requested
router.post('/me/resubmit', requireAuth, candidateAppController.resubmit.bind(candidateAppController));

module.exports = router;
