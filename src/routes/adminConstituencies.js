/**
 * Admin Constituency Routes
 * Administrative CR constituency management.
 * All routes require an ADMIN session.
 */

const express = require('express');
const router = express.Router();
const constituencyController = require('../controllers/constituencyController');
const { csrfProtection } = require('../middleware/csrfProtection');

// POST /api/v1/admin/constituencies - Create a constituency (+ its CR position)
router.post('/', csrfProtection, constituencyController.create.bind(constituencyController));

// PATCH /api/v1/admin/constituencies/:id - Update name / is_active
router.patch('/:id', csrfProtection, constituencyController.update.bind(constituencyController));

// DELETE /api/v1/admin/constituencies/:id - Deactivate a constituency
router.delete('/:id', csrfProtection, constituencyController.remove.bind(constituencyController));

module.exports = router;