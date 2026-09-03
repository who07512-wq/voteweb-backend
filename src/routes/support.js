/**
 * Support Request Routes (Student-facing)
 *
 * SECURITY:
 * - All routes require authentication
 * - Student identity comes from req.user.studentId (never from request params/body)
 * - Prevents IDOR attacks on support request access
 */

const express = require('express');
const router = express.Router();
const supportController = require('../controllers/supportController');
const { requireAuth } = require('../middleware/requireAuth');
const { csrfProtection } = require('../middleware/csrfProtection');

// All routes require authentication
router.use(requireAuth);

// Create support request (state-changing: CSRF protected)
router.post('/', csrfProtection, supportController.create.bind(supportController));

// List student's support requests
router.get('/', supportController.list.bind(supportController));

// Get single support request
router.get('/:id', supportController.get.bind(supportController));

module.exports = router;
