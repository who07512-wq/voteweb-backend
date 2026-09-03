/**
 * Notification Service
 * Handles notification CRUD and creation
 */

const db = require('../db');

class NotificationService {
  /**
   * List notifications for a user
   */
  async list({ userId, unreadOnly = false, limit = 50, offset = 0 }) {
    let query = 'SELECT * FROM notifications WHERE user_id = $1';
    const params = [userId];

    if (unreadOnly) {
      query += ' AND is_read = false';
    }

    query += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId) {
    const result = await db.query(
      'SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_read = false',
      [userId]
    );
    return parseInt(result.rows[0].count);
  }

  /**
   * Find a single notification by id
   */
  async findById(id, userId) {
    const result = await db.query(
      'SELECT * FROM notifications WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Mark notification as read
   */
  async markAsRead(id, userId) {
    const result = await db.query(
      `UPDATE notifications SET is_read = true, read_at = NOW()
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [id, userId]
    );
    return result.rows[0] || null;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId) {
    await db.query(
      'UPDATE notifications SET is_read = true, read_at = NOW() WHERE user_id = $1 AND is_read = false',
      [userId]
    );
    return true;
  }
}

module.exports = new NotificationService();
