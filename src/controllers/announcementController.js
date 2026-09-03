/**
 * Announcement Controller
 * HTTP handling for announcement management
 */

const announcementService = require('../services/announcementService');

class AnnouncementController {
  /**
   * GET /api/v1/announcements
   * List published announcements (public)
   */
  async list(req, res, next) {
    try {
      const { election_id, audience, limit, offset } = req.query;

      const announcements = await announcementService.list({
        electionId: election_id ? parseInt(election_id) : null,
        publishedOnly: true,
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
   * GET /api/v1/announcements/:id
   * Get single announcement (public if published)
   */
  async get(req, res, next) {
    try {
      const { id } = req.params;
      const announcement = await announcementService.getById(parseInt(id), true);

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
}

module.exports = new AnnouncementController();
