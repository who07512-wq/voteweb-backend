/**
 * Election Routes - READ ONLY
 * Public read access for elections
 */

const express = require('express');
const router = express.Router();
const electionController = require('../controllers/electionController');

// GET /api/v1/elections - List all elections (public)
router.get('/', electionController.list.bind(electionController));

// GET /api/v1/elections/:id - Get single election (public)
router.get('/:id', electionController.get.bind(electionController));

// GET /api/v1/elections/:id/results - Get election results (public, respects publication rules)
router.get('/:id/results', electionController.getResults.bind(electionController));

module.exports = router;
