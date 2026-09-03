/**
 * Support Request Service
 * Handles support ticket CRUD operations
 */

const db = require('../db');

class SupportService {
  VALID_CATEGORIES = ['login', 'voting', 'candidate_info', 'receipt', 'technical', 'account', 'other'];
  VALID_STATUSES = ['open', 'in_review', 'waiting', 'resolved', 'closed'];

  /**
   * Create a new support request
   */
  async create({ studentId, electionId, category, subject, description }) {
    // Validate category
    if (!this.VALID_CATEGORIES.includes(category)) {
      throw new Error(`Invalid category. Must be one of: ${this.VALID_CATEGORIES.join(', ')}`);
    }

    const result = await db.query(
      `INSERT INTO support_requests (student_id, election_id, category, subject, description)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [studentId, electionId || null, category, subject, description]
    );
    return result.rows[0];
  }

  /**
   * List support requests with filters
   */
  async list({ studentId, status, electionId, assignedTo, limit = 50, offset = 0 }) {
    let query = 'SELECT * FROM support_requests WHERE 1=1';
    const params = [];
    let paramIndex = 1;

    if (studentId) {
      query += ` AND student_id = $${paramIndex}`;
      params.push(studentId);
      paramIndex++;
    }

    if (status) {
      query += ` AND status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (electionId) {
      query += ` AND election_id = $${paramIndex}`;
      params.push(electionId);
      paramIndex++;
    }

    if (assignedTo !== undefined) {
      if (assignedTo === null) {
        query += ' AND assigned_to IS NULL';
      } else {
        query += ` AND assigned_to = $${paramIndex}`;
        params.push(assignedTo);
        paramIndex++;
      }
    }

    query += ` ORDER BY created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Get single request by ID
   */
  async getById(id) {
    const result = await db.query(
      'SELECT * FROM support_requests WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Update request status
   */
  async updateStatus(id, { status, assignedTo, response }) {
    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (status !== undefined) {
      if (!this.VALID_STATUSES.includes(status)) {
        throw new Error(`Invalid status. Must be one of: ${this.VALID_STATUSES.join(', ')}`);
      }
      updates.push(`status = $${paramIndex}`);
      params.push(status);
      paramIndex++;

      if (status === 'resolved' || status === 'closed') {
        updates.push(`resolved_at = NOW()`);
      }
    }

    if (assignedTo !== undefined) {
      updates.push(`assigned_to = $${paramIndex}`);
      params.push(assignedTo);
      paramIndex++;
    }

    if (response !== undefined) {
      updates.push(`response = $${paramIndex}`);
      params.push(response);
      paramIndex++;
      updates.push(`responded_at = NOW()`);
    }

    updates.push(`updated_at = NOW()`);

    if (updates.length === 1) return this.getById(id);

    params.push(id);
    await db.query(
      `UPDATE support_requests SET ${updates.join(', ')} WHERE id = $${paramIndex}`,
      params
    );

    return this.getById(id);
  }
}

module.exports = new SupportService();
