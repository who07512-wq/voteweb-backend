/**
 * Student Controller
 * HTTP request handling for student management
 */

const studentService = require('../services/studentService');

class StudentController {
  /**
   * GET /api/v1/students
   */
  async list(req, res, next) {
    try {
      const { active_only, limit, offset } = req.query;

      const students = await studentService.findAll({
        activeOnly: active_only === 'true',
        limit: parseInt(limit) || 100,
        offset: parseInt(offset) || 0,
      });

      res.json({
        data: students,
        meta: {
          count: students.length,
          limit: parseInt(limit) || 100,
          offset: parseInt(offset) || 0,
        },
      });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/students/:id
   */
  async get(req, res, next) {
    try {
      const { id } = req.params;

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid student ID',
        });
      }

      const student = await studentService.findById(parseInt(id));

      if (!student) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Student with ID ${id} not found`,
        });
      }

      res.json({ data: student });
    } catch (err) {
      next(err);
    }
  }

  /**
   * GET /api/v1/students/by-external-id/:externalId
   */
  async getByExternalId(req, res, next) {
    try {
      const { externalId } = req.params;

      if (!externalId) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'External ID is required',
        });
      }

      const student = await studentService.findByExternalId(externalId);

      if (!student) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Student with external ID '${externalId}' not found`,
        });
      }

      res.json({ data: student });
    } catch (err) {
      next(err);
    }
  }

  /**
   * POST /api/v1/students
   */
  async create(req, res, next) {
    try {
      const { external_id, name, email } = req.body;

      // Validate required fields
      const errors = [];
      if (!external_id || typeof external_id !== 'string' || external_id.trim() === '') {
        errors.push('external_id is required and must be a non-empty string');
      }
      if (!name || typeof name !== 'string' || name.trim() === '') {
        errors.push('name is required and must be a non-empty string');
      }
      if (email && typeof email === 'string' && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        errors.push('email format is invalid');
      }

      if (errors.length > 0) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'Invalid input data',
          details: errors,
        });
      }

      const student = await studentService.create({
        external_id: external_id.trim(),
        name: name.trim(),
        email: email ? email.trim() : null,
      });

      res.status(201).json({ data: student });
    } catch (err) {
      // Handle duplicate external_id
      if (err.code === '23505') {
        return res.status(409).json({
          error: 'Conflict',
          message: `A student with external_id '${req.body.external_id}' already exists`,
        });
      }
      next(err);
    }
  }

  /**
   * PATCH /api/v1/students/:id
   */
  async update(req, res, next) {
    try {
      const { id } = req.params;
      const { name, email } = req.body;

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid student ID',
        });
      }

      // Validate optional fields
      if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'name must be a non-empty string if provided',
        });
      }

      if (email !== undefined && email !== null && typeof email === 'string' && !email.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)) {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'email format is invalid',
        });
      }

      const student = await studentService.update(parseInt(id), {
        name: name ? name.trim() : null,
        email: email !== undefined ? (email ? email.trim() : null) : undefined,
      });

      if (!student) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Student with ID ${id} not found`,
        });
      }

      res.json({ data: student });
    } catch (err) {
      next(err);
    }
  }

  /**
   * PATCH /api/v1/students/:id/status
   */
  async updateStatus(req, res, next) {
    try {
      const { id } = req.params;
      const { is_active } = req.body;

      if (!id || isNaN(parseInt(id))) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Invalid student ID',
        });
      }

      if (typeof is_active !== 'boolean') {
        return res.status(400).json({
          error: 'Validation Error',
          message: 'is_active must be a boolean',
        });
      }

      const student = await studentService.updateStatus(parseInt(id), is_active);

      if (!student) {
        return res.status(404).json({
          error: 'Not Found',
          message: `Student with ID ${id} not found`,
        });
      }

      res.json({ data: student });
    } catch (err) {
      next(err);
    }
  }
}

module.exports = new StudentController();
