/**
 * Admin Candidate Routes
 * Administrative operations for candidate management
 * All routes require admin authentication
 */

const express = require('express');
const router = express.Router();
const candidateController = require('../controllers/candidateController');
const { requireAdmin } = require('../middleware/requireAdmin');

// PATCH /api/v1/admin/candidates/:id - Update candidate (admin only)
router.patch('/:id', requireAdmin, candidateController.update.bind(candidateController));

module.exports = router;
