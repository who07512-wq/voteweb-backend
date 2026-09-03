/**
 * Position Routes
 * API endpoints for position management
 */

const express = require('express');
const router = express.Router();
const positionController = require('../controllers/positionController');

// GET /api/v1/positions - List all positions
router.get('/', positionController.listAll.bind(positionController));

// GET /api/v1/positions/recommended - Get recommended position names
router.get('/recommended', positionController.getRecommended.bind(positionController));

// GET /api/v1/positions/:id - Get single position
router.get('/:id', positionController.get.bind(positionController));

// PATCH /api/v1/positions/:id - Update position
router.patch('/:id', positionController.update.bind(positionController));

module.exports = router;
