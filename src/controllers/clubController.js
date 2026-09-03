/**
 * Club Controller
 * HTTP request handling for club management
 */

const clubService = require('../services/clubService');

class ClubController {
  /**
   * GET /api/v1/clubs - List all clubs (no election filter)
   */
  async listAll(req, res, next) {
    try {
      const { active_only, limit, offset } = req.query;

      const clubs = await clubService.findAll({
        activeOnly: active_only !== 'false',
        limit: parseInt(limit) || 100,
        offset: parseInt(offset) || 0,
      });

      res.json({
        data: clubs,
        meta: {
          count: clubs.length,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/elections/:electionId/clubs
   */
  async list(req, res, next) {
    try {
      const { electionId } = req.params;
      const { active_only, limit, offset } = req.query;

      if (!electionId || isNaN(parseInt(electionId))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid election ID',
        });
      }

      const clubs = await clubService.findByElectionId(parseInt(electionId), {
        activeOnly: active_only !== 'false',
        limit: parseInt(limit) || 100,
        offset: parseInt(offset) || 0,
      });

      res.json({
        data: clubs,
        meta: {
          count: clubs.length,
          electionId: parseInt(electionId),
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/clubs/:id
   */
  async get(req, res, next) {
    try {
      const { id } = req.params;

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid club ID',
        });
      }

      const club = await clubService.findById(parseInt(id));

      if (!club) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Club with ID ${id} not found`,
        });
      }

      res.json({ data: club });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/elections/:electionId/clubs
   */
  async create(req, res, next) {
    try {
      const { electionId } = req.params;
      const { name, description, image_url, display_order } = req.body;

      if (!electionId || isNaN(parseInt(electionId))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid election ID',
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

      // Validate display_order
      if (display_order !== undefined && (typeof display_order !== 'number' || !Number.isInteger(display_order))) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'display_order must be an integer if provided',
        });
      }

      // Check if election exists
      const electionExists = await clubService.electionExists(parseInt(electionId));
      if (!electionExists) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Election with ID ${electionId} not found`,
        });
      }

      // Check election status - only allow creation in DRAFT
      const status = await clubService.getElectionStatusByElectionId(parseInt(electionId));
      if (status && status !== 'DRAFT') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot create clubs when election is not in DRAFT status',
        });
      }

      const club = await clubService.create({
        election_id: parseInt(electionId),
        name: name.trim(),
        description,
        image_url,
        display_order,
      });

      res.status(201).json({ data: club });
    } catch (err) {
      // Handle duplicate club name
      if (err.code === '23505' && err.constraint && (err.constraint.includes('election_id') || err.constraint.includes('clubs_election_name'))) {
        return res.status(409).json({
          error: 'Conflict',
          message: `A club with name '${req.body.name}' already exists in this election`,
        });
      }
      next(err);
    }
  }

  /**
   * PATCH /api/v1/clubs/:id
   */
  async update(req, res, next) {
    try {
      const { id } = req.params;
      const { name, description, image_url, display_order } = req.body;

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid club ID',
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

      // Validate display_order if provided
      if (display_order !== undefined && (typeof display_order !== 'number' || !Number.isInteger(display_order))) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'display_order must be an integer if provided',
        });
      }

      // Check if club exists
      const existingClub = await clubService.findById(parseInt(id));
      if (!existingClub) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Club with ID ${id} not found`,
        });
      }

      // Check election status - only allow modification in DRAFT/SCHEDULED
      const canModify = await clubService.canModify(parseInt(id));
      if (!canModify) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Cannot modify club when election is OPEN or CLOSED',
        });
      }

      const club = await clubService.update(parseInt(id), {
        name,
        description,
        image_url,
        display_order,
      });

      res.json({ data: club });
    } catch (err) {
      // Handle duplicate club name
      if (err.code === '23505' && err.constraint && (err.constraint.includes('election_id') || err.constraint.includes('clubs_election_name'))) {
        return res.status(409).json({
          error: 'Conflict',
          message: `A club with name '${req.body.name}' already exists in this election`,
        });
      }
      next(err);
    }
  }
}

module.exports = new ClubController();
