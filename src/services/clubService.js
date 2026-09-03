/**
 * Club Service
 * Business logic for club management
 */

const db = require('../db');

class ClubService {
  /**
   * Find all clubs (no election filter)
   */
  async findAll(options = {}) {
    const { activeOnly = true, limit = 100, offset = 0 } = options;

    let query = 'SELECT * FROM clubs WHERE 1=1';
    const params = [];

    if (activeOnly) {
      query += ' AND is_active = true';
    }

    query += ' ORDER BY display_order, id LIMIT $1 OFFSET $2';
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Find all clubs for an election
   */
  async findByElectionId(electionId, options = {}) {
    const { activeOnly = true, limit = 100, offset = 0 } = options;

    let query = 'SELECT * FROM clubs WHERE election_id = $1';
    const params = [electionId];

    if (activeOnly) {
      query += ' AND is_active = true';
    }

    query += ' ORDER BY display_order, id LIMIT $2 OFFSET $3';
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Find club by ID
   */
  async findById(id) {
    const result = await db.query(
      'SELECT * FROM clubs WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Create a new club
   */
  async create(data) {
    const { election_id, name, description, image_url, display_order } = data;

    const result = await db.query(
      `INSERT INTO clubs (election_id, name, description, image_url, display_order)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        election_id,
        name.trim(),
        description?.trim() || null,
        image_url?.trim() || null,
        display_order !== undefined ? display_order : 0,
      ]
    );

    return result.rows[0];
  }

  /**
   * Update a club
   */
  async update(id, data) {
    const club = await this.findById(id);
    if (!club) return null;

    const updates = [];
    const params = [];
    let paramIndex = 1;

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
      return club;
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const query = `UPDATE clubs SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await db.query(query, params);
    return result.rows[0];
  }

  /**
   * Check if election exists
   */
  async electionExists(electionId) {
    const result = await db.query(
      'SELECT id FROM elections WHERE id = $1',
      [electionId]
    );
    return result.rows.length > 0;
  }

  /**
   * Get election status for a club
   */
  async getElectionStatus(clubId) {
    const result = await db.query(
      `SELECT e.status FROM elections e
       JOIN clubs c ON c.election_id = e.id
       WHERE c.id = $1`,
      [clubId]
    );
    return result.rows[0]?.status || null;
  }

  /**
   * Get election status by election ID
   */
  async getElectionStatusByElectionId(electionId) {
    const result = await db.query(
      'SELECT status FROM elections WHERE id = $1',
      [electionId]
    );
    return result.rows[0]?.status || null;
  }

  /**
   * Check if club can be modified based on election state
   */
  async canModify(clubId) {
    const status = await this.getElectionStatus(clubId);
    // Can modify if DRAFT or SCHEDULED
    return status === 'DRAFT' || status === 'SCHEDULED';
  }
}

module.exports = new ClubService();
