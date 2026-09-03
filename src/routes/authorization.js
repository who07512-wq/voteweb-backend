/**
 * Authorization Routes
 * API endpoints for voter authorization management
 */

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authorizationController');

// GET /api/v1/authorizations/:id - Get single authorization
router.get('/:id', authController.get.bind(authController));

// PATCH /api/v1/authorizations/:id - Update authorization
router.patch('/:id', authController.update.bind(authController));

// DELETE /api/v1/authorizations/:id - Delete authorization
router.delete('/:id', authController.delete.bind(authController));

module.exports = router;
