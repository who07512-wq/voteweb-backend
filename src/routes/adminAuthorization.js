/**
 * Admin Authorization Routes
 * Administrative operations for voter authorization management
 * All routes require admin authentication
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authorizationController');
const { requireAdmin } = require('../middleware/requireAdmin');

// PATCH /api/v1/admin/authorizations/:id - Update authorization (admin only)
router.patch('/:id', requireAdmin, authController.update.bind(authController));

// DELETE /api/v1/admin/authorizations/:id - Delete authorization (admin only)
router.delete('/:id', requireAdmin, authController.delete.bind(authController));

module.exports = router;
