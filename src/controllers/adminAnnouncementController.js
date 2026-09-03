/**
 * Admin Announcement Controller
 * HTTP handling for admin announcement management
 */

const announcementService = require('../services/announcementService');
const { sanitizeString, validateLength } = require('../lib/sanitize');

class AdminAnnouncementController {
  /**
   * GET /api/v1/admin/announcements
   * List all announcements for admin
   */
  async list(req, res, next) {
    try {
      const { election_id, status, audience, limit, offset } = req.query;

      const publishedOnly = status === 'published';
      const announcements = await announcementService.list({
        electionId: election_id ? parseInt(election_id) : null,
        publishedOnly,
        audience: audience || null,
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0,
      });

      res.json({ data: announcements });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/admin/announcements
   * Create new announcement
   */
  async create(req, res, next) {
    try {
      const { election_id, title, message, audience, priority, is_published } = req.body;

      // Validation
      if (!title || typeof title !== 'string' || title.trim().length === 0) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'title is required and must be a non-empty string',
        });
      }

      const titleError = validateLength(title, 200, 'Title');
      if (titleError) {
        return res.status(400).json({ error: 'Validation Error', message: titleError });
      }

      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'message is required and must be a non-empty string',
        });
      }

      const messageError = validateLength(message, 2000, 'Message');
      if (messageError) {
        return res.status(400).json({ error: 'Validation Error', message: messageError });
      }

      const announcement = await announcementService.create({
        electionId: election_id ? parseInt(election_id) : null,
        title: sanitizeString(title.trim()),
        message: sanitizeString(message.trim()),
        audience: audience || 'all',
        priority: priority || 'normal',
        published: is_published || false,
        createdBy: req.adminId || null,
      });

      // Audit log
      const { auditLog } = require('../db');
      await auditLog({
        action: 'ANNOUNCEMENT_CREATED',
        resource: 'announcement',
        resourceId: announcement.id,
        details: { title: announcement.title },
        adminId: req.adminId,
      });

      res.status(201).json({ data: announcement });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/admin/announcements/:id
   * Get single announcement
   */
  async get(req, res, next) {
    try {
      const { id } = req.params;
      const announcement = await announcementService.getById(parseInt(id));

      if (!announcement) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Announcement not found',
        });
      }

      res.json({ data: announcement });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/admin/announcements/:id
   * Update announcement
   */
  async update(req, res, next) {
    try {
      const { id } = req.params;
      const { title, message, audience, priority, is_published } = req.body;

      const existing = await announcementService.getById(parseInt(id));
      if (!existing) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Announcement not found',
        });
      }

      const announcement = await announcementService.update(parseInt(id), {
        title: title ? sanitizeString(title.trim()) : undefined,
        message: message ? sanitizeString(message.trim()) : undefined,
        audience,
        priority,
        isPublished: is_published,
      });

      // Audit log
      const { auditLog } = require('../db');
      await auditLog({
        action: 'ANNOUNCEMENT_UPDATED',
        resource: 'announcement',
        resourceId: announcement.id,
        details: { title: announcement.title },
        adminId: req.adminId,
      });

      res.json({ data: announcement });
    } catch (err) {
      next(err);
    }
  }

  /**
   * DELETE /api/v1/admin/announcements/:id
   * Delete announcement
   */
  async delete(req, res, next) {
    try {
      const { id } = req.params;

      const existing = await announcementService.getById(parseInt(id));
      if (!existing) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Announcement not found',
        });
      }

      await announcementService.delete(parseInt(id));

      // Audit log
      const { auditLog } = require('../db');
      await auditLog({
        action: 'ANNOUNCEMENT_DELETED',
        resource: 'announcement',
        resourceId: parseInt(id),
        details: { title: existing.title },
        adminId: req.adminId,
      });

      res.status(204).send();
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AdminAnnouncementController();
