/**
 * Club Routes
 * API endpoints for club management
 * Mounted at: /api/v1/clubs
 */

const express = require('express');
const router = express.Router();
const clubController = require('../controllers/clubController');

// GET /api/v1/clubs - List all clubs
router.get('/', clubController.listAll.bind(clubController));

// GET /api/v1/clubs/:id - Get single club
router.get('/:id', clubController.get.bind(clubController));

// PATCH /api/v1/clubs/:id - Update club
router.patch('/:id', clubController.update.bind(clubController));

module.exports = router;
