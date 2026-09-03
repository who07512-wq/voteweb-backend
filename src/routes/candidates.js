/**
 * Candidate Routes
 * API endpoints for candidate management
 */

const express = require('express');
const router = express.Router();
const candidateController = require('../controllers/candidateController');
const { requireAuth } = require('../middleware/requireAuth');
const { csrfProtection } = require('../middleware/csrfProtection');

// GET /api/v1/candidates - List all candidates (public read)
router.get('/', candidateController.listAll.bind(candidateController));

// GET /api/v1/candidates/:id - Get single candidate (public read)
router.get('/:id', candidateController.get.bind(candidateController));

// PATCH /api/v1/candidates/:id - Update candidate (authenticated candidates/admins only)
// Public reads stay open, but writes require an authenticated session, a valid
// CSRF token, and a candidate/admin role.
router.patch('/:id', requireAuth, csrfProtection, (req, res, next) => {
  if (req.user.role !== 'CANDIDATE' && req.user.role !== 'ADMIN') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Only candidates or admins can update candidate records.',
      code: 'FORBIDDEN_ROLE',
    });
  }
  candidateController.update.bind(candidateController)(req, res, next);
});

module.exports = router;
