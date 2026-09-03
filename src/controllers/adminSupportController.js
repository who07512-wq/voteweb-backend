/**
 * Admin Support Request Controller
 * HTTP handling for admin support management
 */

const supportService = require('../services/supportService');
const { sanitizeString } = require('../lib/sanitize');

class AdminSupportController {
  /**
   * GET /api/v1/admin/support
   * List all support requests
   */
  async list(req, res, next) {
    try {
      const { status, election_id, assigned_to, category, limit, offset } = req.query;

      const assignedTo = assigned_to === 'null' ? null :
                        (assigned_to ? parseInt(assigned_to) : undefined);

      const requests = await supportService.list({
        status: status || null,
        electionId: election_id ? parseInt(election_id) : null,
        assignedTo,
        category: category || null,
        limit: Math.min(parseInt(limit) || 50, 100),
        offset: parseInt(offset) || 0,
      });

      res.json({ data: requests });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/admin/support/:id
   * Get single support request
   */
  async get(req, res, next) {
    try {
      const { id } = req.params;
      const request = await supportService.getById(parseInt(id));

      if (!request) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Support request not found',
        });
      }

      res.json({ data: request });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/admin/support/:id
   * Update support request (assign, respond, close)
   */
  async update(req, res, next) {
    try {
      const { id } = req.params;
      const { status, priority, assigned_to, response } = req.body;

      const updateData = {};
      if (status !== undefined) updateData.status = status;
      if (priority !== undefined) updateData.priority = priority;
      if (assigned_to !== undefined) updateData.assignedTo = assigned_to === 'null' ? null : parseInt(assigned_to);
      if (response !== undefined) updateData.response = sanitizeString(response);

      const request = await supportService.update(parseInt(id), updateData);

      if (!request) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Support request not found',
        });
      }

      // Audit log
      const { auditLog } = require('../db');
      await auditLog({
        action: 'SUPPORT_UPDATE',
        entityType: 'support_request',
        entityId: id,
        details: { status, priority, assigned_to, hasResponse: !!response },
        adminId: req.adminId,
      });

      res.json({ data: request });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/admin/support/stats
   * Get support request statistics
   */
  async stats(req, res, next) {
    try {
      const { election_id } = req.query;

      const stats = await supportService.getStats({
        electionId: election_id ? parseInt(election_id) : null,
      });

      res.json({ data: stats });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new AdminSupportController();
