/**
 * Notification Controller
 * HTTP handling for user notifications
 *
 * SECURITY:
 * - Student identity comes from req.user.studentId (authenticated session)
 * - Request params/body user_id is IGNORED
 * - Prevents IDOR attacks
 */

const notificationService = require('../services/notificationService');

class NotificationController {
  /**
   * GET /api/v1/notifications
   * List authenticated user's notifications
   */
  async list(req, res, next) {
    try {
      // SECURITY: Get student ID from authenticated session
      const studentId = req.user?.studentId;

      if (!studentId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required.',
          code: 'AUTH_REQUIRED',
        });
      }

      // Optional query params for filtering (but studentId always comes from session)
      const { unread_only, limit, offset } = req.query;

      const notifications = await notificationService.list({
        userId: studentId,
        unreadOnly: unread_only === 'true',
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0,
      });

      const unreadCount = await notificationService.getUnreadCount(studentId);

      res.json({
        data: notifications,
        meta: {
          unread_count: unreadCount,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/notifications/unread-count
   * Get unread notification count for authenticated user
   */
  async getUnreadCount(req, res, next) {
    try {
      const studentId = req.user?.studentId;

      if (!studentId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required.',
          code: 'AUTH_REQUIRED',
        });
      }

      const unreadCount = await notificationService.getUnreadCount(studentId);

      res.json({
        data: {
          unread_count: unreadCount,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/notifications/:id/read
   * Mark notification as read (ownership enforced)
   */
  async markAsRead(req, res, next) {
    try {
      const studentId = req.user?.studentId;

      if (!studentId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required.',
          code: 'AUTH_REQUIRED',
        });
      }

      const { id } = req.params;

      const notification = await notificationService.findById(parseInt(id));

      if (!notification) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Notification not found',
        });
      }

      // SECURITY: Ownership check - student can only mark their own notifications
      if (notification.user_id !== studentId) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot modify another student\'s notification.',
          code: 'ACCESS_DENIED',
        });
      }

      await notificationService.markAsRead(parseInt(id), studentId);

      res.json({ success: true, data: notification });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/notifications/mark-all-read
   * Mark all notifications as read for authenticated user
   */
  async markAllAsRead(req, res, next) {
    try {
      const studentId = req.user?.studentId;

      if (!studentId) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required.',
          code: 'AUTH_REQUIRED',
        });
      }

      // SECURITY: Use authenticated student ID, ignore any body.user_id
      await notificationService.markAllAsRead(studentId);

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new NotificationController();
