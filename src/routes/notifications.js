/**
 * Notification Routes (Student-facing)
 *
 * SECURITY:
 * - All routes require authentication
 * - Student identity comes from req.user.studentId (never from request params/body)
 * - Prevents IDOR attacks on notification access
 */

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { requireAuth } = require('../middleware/requireAuth');
const { csrfProtection } = require('../middleware/csrfProtection');

// All routes require authentication
router.use(requireAuth);

// List notifications - student can only see their own
router.get('/', notificationController.list.bind(notificationController));

// Get unread count - student can only see their own
router.get('/unread-count', notificationController.getUnreadCount.bind(notificationController));

// Mark as read - student can only mark their own (state-changing: CSRF protected)
router.patch('/:id/read', csrfProtection, notificationController.markAsRead.bind(notificationController));

// Mark all as read - student can only mark their own (state-changing: CSRF protected)
router.post('/mark-all-read', csrfProtection, notificationController.markAllAsRead.bind(notificationController));

module.exports = router;
