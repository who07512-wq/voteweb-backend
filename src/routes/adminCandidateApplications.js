/**
 * Admin Candidate Application Routes
 * Routes for admin to review candidate applications
 */

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/requireAuth');
const candidateAppController = require('../controllers/candidateApplicationController');

// =====================================================
// ADMIN ROUTES (require admin role)
// =====================================================

// Middleware to check admin role
const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      message: 'Admin access required.',
    });
  }
  next();
};

// GET /api/admin/candidates - List all candidate applications
router.get('/', requireAuth, requireAdmin, candidateAppController.listForAdmin.bind(candidateAppController));

// GET /api/admin/candidates/:id - Get single application details
router.get('/:id', requireAuth, requireAdmin, candidateAppController.getForAdmin.bind(candidateAppController));

// PATCH /api/admin/candidates/:id/approve - Approve application
router.patch('/:id/approve', requireAuth, requireAdmin, candidateAppController.approve.bind(candidateAppController));

// PATCH /api/admin/candidates/:id/reject - Reject application
router.patch('/:id/reject', requireAuth, requireAdmin, candidateAppController.reject.bind(candidateAppController));

// PATCH /api/admin/candidates/:id/request-changes - Request changes
router.patch('/:id/request-changes', requireAuth, requireAdmin, candidateAppController.requestChanges.bind(candidateAppController));

module.exports = router;
