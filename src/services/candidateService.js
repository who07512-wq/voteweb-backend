/**
 * Candidate Service
 * Business logic for candidate management
 */

const db = require('../db');

class CandidateService {
  /**
   * Find all candidates (no position filter)
   */
  async findAll(options = {}) {
    const { activeOnly = true, limit = 100, offset = 0 } = options;

    let query = 'SELECT * FROM candidates WHERE 1=1';
    const params = [];

    if (activeOnly) {
      query += ' AND is_active = true';
    }

    query += ' ORDER BY id LIMIT $1 OFFSET $2';
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Find all candidates for a position
   */
  async findByPositionId(positionId, options = {}) {
    const { activeOnly = true, limit = 100, offset = 0 } = options;

    let query = 'SELECT * FROM candidates WHERE position_id = $1';
    const params = [positionId];

    if (activeOnly) {
      query += ' AND is_active = true';
    }

    query += ' ORDER BY display_order, id LIMIT $2 OFFSET $3';
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Find candidate by ID with full hierarchy
   */
  async findById(id) {
    const result = await db.query(
      `SELECT c.*,
              p.name as position_name, p.club_id,
              cl.name as club_name, cl.election_id,
              e.name as election_name, e.status as election_status
       FROM candidates c
       JOIN positions p ON c.position_id = p.id
       JOIN clubs cl ON p.club_id = cl.id
       JOIN elections e ON cl.election_id = e.id
       WHERE c.id = $1`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Find candidate by ID (simple)
   */
  async findByIdSimple(id) {
    const result = await db.query(
      'SELECT * FROM candidates WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Create a new candidate
   */
  async create(data) {
    const { position_id, name, description, image_url, display_order } = data;

    const result = await db.query(
      `INSERT INTO candidates (position_id, name, description, image_url, display_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        position_id,
        name.trim(),
        description?.trim() || null,
        image_url?.trim() || null,
        display_order !== undefined ? display_order : 0,
      ]
    );

    return result.rows[0];
  }

  /**
   * Update a candidate (only allowed fields)
   */
  async update(id, data) {
    const candidate = await this.findByIdSimple(id);
    if (!candidate) return null;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    // Allowed fields for update
    const allowedFields = ['name', 'description', 'image_url', 'display_order'];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updates.push(`${field} = $${paramIndex}`);
        if (field === 'name') {
          params.push(data[field].trim());
        } else if (field === 'description' || field === 'image_url') {
          params.push(data[field]?.trim() || null);
        } else {
          params.push(data[field]);
        }
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return candidate;
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const query = `UPDATE candidates SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await db.query(query, params);
    return result.rows[0];
  }

  /**
   * Check if position exists
   */
  async positionExists(positionId) {
    const result = await db.query(
      'SELECT id FROM positions WHERE id = $1',
      [positionId]
    );
    return result.rows.length > 0;
  }

  /**
   * Get election status by position ID
   */
  async getElectionStatusByPositionId(positionId) {
    const result = await db.query(
      `SELECT e.status FROM elections e
       JOIN clubs c ON c.election_id = e.id
       JOIN positions p ON p.club_id = c.id
       WHERE p.id = $1`,
      [positionId]
    );
    return result.rows[0]?.status || null;
  }

  /**
   * Check if candidate can be modified based on election state
   */
  async canModify(candidateId) {
    const candidate = await this.findByIdSimple(candidateId);
    if (!candidate) return false;

    const status = await this.getElectionStatusByPositionId(candidate.position_id);
    return status === 'DRAFT' || status === 'SCHEDULED';
  }

  /**
   * Check if candidate can be created for a position based on election state
   */
  async canCreate(positionId) {
    const status = await this.getElectionStatusByPositionId(positionId);
    return status === 'DRAFT' || status === 'SCHEDULED';
  }
}

module.exports = new CandidateService();
