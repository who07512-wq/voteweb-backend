/**
 * Constituency Routes
 * Public reads for Class Representative (CR) ballot data.
 */

const express = require('express');
const router = express.Router();
const constituencyController = require('../controllers/constituencyController');

// GET /api/v1/constituencies?election_id= - List constituencies (ballot data)
router.get('/', constituencyController.list.bind(constituencyController));

// GET /api/v1/constituencies/:id/positions - CR position for a constituency
router.get('/:id/positions', constituencyController.listPositions.bind(constituencyController));

module.exports = router;