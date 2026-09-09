/**
 * Admin Position Routes
 * Administrative operations for position management
 * All routes require admin authentication
 */

const express = require('express');
const router = express.Router();
const positionController = require('../controllers/positionController');
const { requireAdmin } = require('../middleware/requireAdmin');

// PATCH /api/v1/admin/positions/:id - Update position (admin only)
router.patch('/:id', requireAdmin, positionController.update.bind(positionController));

module.exports = router;
