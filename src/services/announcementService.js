/**
 * Announcement Service
 * Handles announcement CRUD operations
 */

const db = require('../db');
const notificationService = require('./notificationService');

class AnnouncementService {
  /**
   * Create a new announcement
   * Notifies approved + rejected candidates when the announcement is published.
   */
  async create({ electionId, title, message, audience = 'all', priority = 'normal', published = false, createdBy }) {
    const result = await db.query(
      `INSERT INTO announcements (election_id, title, message, audience, priority, is_published, published_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        electionId || null,
        title,
        message,
        audience,
        priority,
        published,
        published ? new Date() : null,
        createdBy || null
      ]
    );
    const announcement = result.rows[0];

    if (announcement.is_published) {
      await this.notifyCandidates(announcement);
    }

    return announcement;
  }

  /**
   * List announcements with filters
   */
  async list({ electionId, publishedOnly = false, audience, limit = 50, offset = 0 }) {
    let query = 'SELECT * FROM announcements WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (electionId) {
      query += ` AND election_id = $${paramIndex}`;
      params.push(electionId);
      paramIndex++;
    }

    if (publishedOnly) {
      query += ' AND is_published = true';
    }

    if (audience) {
      query += ` AND (audience = $${paramIndex} OR audience = 'all')`;
      params.push(audience);
      paramIndex++;
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get single announcement by ID
   */
  async getById(id, publishedOnly = false) {
    const result = publishedOnly
      ? await db.query(
          'SELECT * FROM announcements WHERE id = $1 AND is_published = true',
          [id]
        )
      : await db.query(
          'SELECT * FROM announcements WHERE id = $1',
          [id]
        );
    return result.rows[0] || null;
  }

  /**
   * Update announcement
   * Notifies approved + rejected candidates when the announcement becomes published.
   */
  async update(id, { title, message, audience, priority, isPublished }) {
    const existing = await this.getById(id);

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramIndex}`);
      params.push(title);
      paramIndex++;
    }

    if (message !== undefined) {
      updates.push(`message = $${paramIndex}`);
      params.push(message);
      paramIndex++;
    }

    if (audience !== undefined) {
      updates.push(`audience = $${paramIndex}`);
      params.push(audience);
      paramIndex++;
    }

    if (priority !== undefined) {
      updates.push(`priority = $${paramIndex}`);
      params.push(priority);
      paramIndex++;
    }

    if (isPublished !== undefined) {
      updates.push(`is_published = $${paramIndex}`);
      params.push(isPublished);
      paramIndex++;
      // Set published_at when publishing
      if (isPublished) {
        updates.push(`published_at = NOW()`);
      }
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const query = `UPDATE announcements SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await db.query(query, params);
    const announcement = result.rows[0] || null;

    // Notify only on a draft → published transition (avoid re-notifying on edits of an already-published announcement).
    if (announcement && announcement.is_published && (!existing || !existing.is_published)) {
      await this.notifyCandidates(announcement);
    }

    return announcement;
  }

  /**
   * Delete announcement
   */
  async delete(id) {
    const result = await db.query(
      'DELETE FROM announcements WHERE id = $1 RETURNING id',
      [id]
    );
    return result.rowCount > 0;
  }

  /**
   * Publish/unpublish announcement
   */
  async setPublished(id, published) {
    return this.update(id, { isPublished: published });
  }

  /**
   * Create a notification for every approved and rejected candidate when a
   * published announcement is created. Respects the audience target:
   * admin-only announcements do not notify candidates.
   */
  async notifyCandidates(announcement) {
    try {
      if (!announcement || !announcement.is_published) {
        return 0;
      }

      if (announcement.audience === 'admins') {
        return 0;
      }

      // Approved + rejected candidates = students with a final decision on
      // their candidate application (status 'approved' or 'rejected').
      const result = await db.query(
        `SELECT DISTINCT student_id
         FROM candidate_applications
         WHERE status IN ('approved', 'rejected') AND student_id IS NOT NULL`
      );

      const userIds = result.rows.map((row) => row.student_id);
      if (!userIds.length) {
        return 0;
      }

      return notificationService.createBulk({
        userIds,
        type: 'info',
        category: 'announcement',
        priority: announcement.priority || 'normal',
        title: announcement.title,
        message: announcement.message,
        actionUrl: null,
        actionLabel: null,
      });
    } catch (err) {
      // Announcement creation must not fail because notification delivery failed.
      console.error('Failed to notify candidates about announcement:', err.message);
      return 0;
    }
  }
}

module.exports = new AnnouncementService();
