/**
 * Candidate Controller
 * HTTP request handling for candidate management
 */

const candidateService = require('../services/candidateService');

class CandidateController {
  /**
   * GET /api/v1/candidates - List all candidates (no position filter)
   */
  async listAll(req, res, next) {
    try {
      const { active_only, limit, offset } = req.query;

      const candidates = await candidateService.findAll({
        activeOnly: active_only !== 'false',
        limit: parseInt(limit) || 100,
        offset: parseInt(offset) || 0,
      });

      res.json({
        data: candidates,
        meta: {
          count: candidates.length,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/positions/:positionId/candidates
   */
  async list(req, res, next) {
    try {
      const { positionId } = req.params;
      const { active_only, limit, offset } = req.query;

      if (!positionId || isNaN(parseInt(positionId))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid position ID',
        });
      }

      // Verify position exists
      const positionExists = await candidateService.positionExists(parseInt(positionId));
      if (!positionExists) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Position with ID ${positionId} not found`,
        });
      }

      const candidates = await candidateService.findByPositionId(parseInt(positionId), {
        activeOnly: active_only !== 'false',
        limit: parseInt(limit) || 100,
        offset: parseInt(offset) || 0,
      });

      res.json({
        data: candidates,
        meta: {
          count: candidates.length,
          positionId: parseInt(positionId),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/candidates/:id
   */
  async get(req, res, next) {
    try {
      const { id } = req.params;

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid candidate ID',
        });
      }

      const candidate = await candidateService.findById(parseInt(id));

      if (!candidate) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Candidate with ID ${id} not found`,
        });
      }

      res.json({ data: candidate });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/positions/:positionId/candidates
   */
  async create(req, res, next) {
    try {
      const { positionId } = req.params;
      const { name, description, image_url, display_order } = req.body;

      if (!positionId || isNaN(parseInt(positionId))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid position ID',
        });
      }

      // Validate required fields
      if (!name || typeof name !== 'string' || name.trim() === '') {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'name is required and must be a non-empty string',
        });
      }

      // Validate name length
      if (name.length > 255) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'name must be 255 characters or less',
        });
      }

      // Validate description length
      if (description && description.length > 5000) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'description must be 5000 characters or less',
        });
      }

      // Validate image_url length
      if (image_url && image_url.length > 500) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'image_url must be 500 characters or less',
        });
      }

      // Validate display_order
      if (display_order !== undefined && (typeof display_order !== 'number' || !Number.isInteger(display_order))) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'display_order must be an integer if provided',
        });
      }

      // Check if position exists
      const positionExists = await candidateService.positionExists(parseInt(positionId));
      if (!positionExists) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Position with ID ${positionId} not found`,
        });
      }

      // Check election state - only allow creation in DRAFT/SCHEDULED
      const canCreate = await candidateService.canCreate(parseInt(positionId));
      if (!canCreate) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot add candidates when election is OPEN or CLOSED',
        });
      }

      const candidate = await candidateService.create({
        position_id: parseInt(positionId),
        name: name.trim(),
        description: description?.trim() || null,
        image_url: image_url?.trim() || null,
        display_order: display_order !== undefined ? display_order : 0,
      });

      res.status(201).json({ data: candidate });
    } catch (err) {
      // Handle duplicate name constraint
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'Conflict',
          message: `A candidate with name '${req.body.name}' already exists in this position`,
        });
      }
      next(err);
    }
  }

  /**
   * PATCH /api/v1/candidates/:id
   */
  async update(req, res, next) {
    try {
      const { id } = req.params;
      const { name, description, image_url, display_order } = req.body;

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid candidate ID',
        });
      }

      // Validate name length if provided
      if (name !== undefined) {
        if (typeof name !== 'string' || name.trim() === '') {
          return res.status(400).json({
            error: 'Validation Error',
            message: 'name must be a non-empty string if provided',
          });
        }
        if (name.length > 255) {
          return res.status(400).json({
            error: 'Validation Error',
            message: 'name must be 255 characters or less',
          });
        }
      }

      // Validate description length if provided
      if (description !== undefined && description.length > 5000) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'description must be 5000 characters or less',
        });
      }

      // Validate image_url length if provided
      if (image_url !== undefined && image_url.length > 500) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'image_url must be 500 characters or less',
        });
      }

      // Validate display_order if provided
      if (display_order !== undefined && (typeof display_order !== 'number' || !Number.isInteger(display_order))) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'display_order must be an integer if provided',
        });
      }

      // Check if candidate exists
      const existingCandidate = await candidateService.findByIdSimple(parseInt(id));
      if (!existingCandidate) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Candidate with ID ${id} not found`,
        });
      }

      // Check election state - only allow modification in DRAFT/SCHEDULED
      const canModify = await candidateService.canModify(parseInt(id));
      if (!canModify) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot modify candidate when election is OPEN or CLOSED',
        });
      }

      const candidate = await candidateService.update(parseInt(id), {
        name,
        description,
        image_url,
        display_order,
      });

      res.json({ data: candidate });
    } catch (err) {
      // Handle duplicate name constraint
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'Conflict',
          message: `A candidate with name '${req.body.name}' already exists in this position`,
        });
      }
      next(err);
    }
  }
}

module.exports = new CandidateController();
