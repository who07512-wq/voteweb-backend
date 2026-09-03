/**
 * Position Service
 * Business logic for position management
 */

const db = require('../db');

// Recommended position names (not enforced by database)
const RECOMMENDED_POSITIONS = [
  'Leader',
  'Co-Leader',
  'Secretary',
  'Joint Secretary',
  'Treasurer',
];

class PositionService {
  /**
   * Get recommended position names
   */
  getRecommendedPositions() {
    return RECOMMENDED_POSITIONS;
  }

  /**
   * Find all positions (no club filter)
   */
  async findAll(options = {}) {
    const { activeOnly = true, limit = 100, offset = 0 } = options;

    let query = 'SELECT * FROM positions WHERE 1=1';
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
   * Find all positions for a club
   */
  async findByClubId(clubId, options = {}) {
    const { activeOnly = true, limit = 100, offset = 0 } = options;

    let query = 'SELECT * FROM positions WHERE club_id = $1';
    const params = [clubId];

    if (activeOnly) {
      query += ' AND is_active = true';
    }

    query += ' ORDER BY display_order, id LIMIT $2 OFFSET $3';
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Find position by ID
   */
  async findById(id) {
    const result = await db.query(
      'SELECT * FROM positions WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Create a new position
   */
  async create(data) {
    const { club_id, name, description, display_order } = data;

    const result = await db.query(
      `INSERT INTO positions (club_id, name, description, display_order)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [
        club_id,
        name.trim(),
        description?.trim() || null,
        display_order !== undefined ? display_order : 0,
      ]
    );

    return result.rows[0];
  }

  /**
   * Update a position
   */
  async update(id, data) {
    const position = await this.findById(id);
    if (!position) return null;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    const allowedFields = ['name', 'description', 'display_order'];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updates.push(`${field} = $${paramIndex}`);
        if (field === 'name') {
          params.push(data[field].trim());
        } else if (field === 'description') {
          params.push(data[field]?.trim() || null);
        } else {
          params.push(data[field]);
        }
        paramIndex++;
      }
    }

    if (updates.length === 0) {
      return position;
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const query = `UPDATE positions SET ${updates.join(', ')} WHERE id = $${paramIndex} RETURNING *`;
    const result = await db.query(query, params);
    return result.rows[0];
  }

  /**
   * Check if club exists
   */
  async clubExists(clubId) {
    const result = await db.query(
      'SELECT id FROM clubs WHERE id = $1',
      [clubId]
    );
    return result.rows.length > 0;
  }

  /**
   * Get election status for a position's club
   */
  async getElectionStatus(positionId) {
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
   * Get election status by club ID
   */
  async getElectionStatusByClubId(clubId) {
    const result = await db.query(
      `SELECT e.status FROM elections e
       JOIN clubs c ON c.election_id = e.id
       WHERE c.id = $1`,
      [clubId]
    );
    return result.rows[0]?.status || null;
  }

  /**
   * Check if position can be modified based on election state
   */
  async canModify(positionId, clubId) {
    let status;
    if (positionId) {
      status = await this.getElectionStatus(positionId);
    } else if (clubId) {
      status = await this.getElectionStatusByClubId(clubId);
    }
    return status === 'DRAFT' || status === 'SCHEDULED';
  }
}

module.exports = new PositionService();
