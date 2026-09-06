/**
 * Authorization Routes
 * API endpoints for voter authorization management
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authorizationController');
const authService = require('../services/authorizationService');
const { requireAuth } = require('../middleware/requireAuth');
const { requireAdmin } = require('../middleware/requireAdmin');
const { csrfProtection } = require('../middleware/csrfProtection');

// Ownership guard: a student may only read their own authorization; admins
// and CAD staff may read any. Prevents the public IDOR that leaked the
// linked student email/external_id.
const canViewAuthorization = async (req, res, next) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: 'Bad Request', message: 'Invalid authorization ID' });
    }
    const auth = await authService.findByIdSimple(parseInt(id));
    if (!auth) {
      return res.status(404).json({ error: 'Not Found', message: `Authorization with ID ${id} not found` });
    }
    const role = (req.user.role || '').toUpperCase();
    if (role === 'ADMIN' || role === 'CAD' || auth.student_id === req.user.studentId) {
      return next();
    }
    return res.status(403).json({
      error: 'Forbidden',
      message: 'You can only view your own authorization.',
      code: 'FORBIDDEN',
    });
  } catch (err) {
    return next(err);
  }
};

// GET /api/v1/authorizations/:id - Get single authorization (owner or staff only)
router.get('/:id', requireAuth, canViewAuthorization, authController.get.bind(authController));

// PATCH /api/v1/authorizations/:id - Change authorization state. Admin-only.
// The router is app.use-mounted (see app.js), so without requireAdmin any
// authenticated student could self-authorize during DRAFT/SCHEDULED.
router.patch('/:id', requireAuth, requireAdmin, csrfProtection, authController.update.bind(authController));

// DELETE /api/v1/authorizations/:id - Revoke authorization. Admin-only (same
// reason as PATCH above; admin duplicates live on /api/v1/admin/authorizations).
router.delete('/:id', requireAuth, requireAdmin, csrfProtection, authController.delete.bind(authController));

module.exports = router;
