/**
 * Constituency Service
 * Business logic for Class Representative (CR) constituencies.
 *
 * A constituency is (election, department, year, section) and owns exactly
 * one Class Representative position. Creating a constituency auto-creates its
 * position so the ballot is always well-formed and candidates can never be
 * placed on the wrong section's ballot.
 */

const db = require('../db');

const CR_POSITION_NAME = 'Class Representative';

class ConstituencyService {
  /**
   * Build the human-readable constituency label.
   */
  buildName({ department, year, section }) {
    return `${department} ${year} Section ${section}`.trim();
  }

  /**
   * Find all constituencies for an election.
   */
  async findByElectionId(electionId, options = {}) {
    const { activeOnly = true, limit = 100, offset = 0 } = options;

    let query = 'SELECT * FROM constituencies WHERE election_id = $1';
    const params = [electionId];

    if (activeOnly) {
      query += ' AND is_active = true';
    }

    query += ' ORDER BY department, year, section LIMIT $2 OFFSET $3';
    params.push(limit, offset);

    const result = await db.query(query, params);
    return result.rows;
  }

  /**
   * Find a constituency by ID.
   */
  async findById(id) {
    const result = await db.query(
      'SELECT * FROM constituencies WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Find the constituency matching (department, year, section) in an election.
   */
  async findMatching({ electionId, department, year, section, activeOnly = true }) {
    const result = await db.query(
      `SELECT * FROM constituencies
       WHERE election_id = $1
         AND LOWER(department) = LOWER($2)
         AND LOWER(year) = LOWER($3)
         AND LOWER(section) = LOWER($4)
         ${activeOnly ? 'AND is_active = true' : ''}
       ORDER BY id
       LIMIT 1`,
      [electionId, department, year, section]
    );
    return result.rows[0] || null;
  }

  /**
   * Create a constituency and auto-create its Class Representative position.
   */
  async create({ electionId, department, year, section, name }) {
    if (!electionId || !department || !year || !section) {
      const error = new Error('election_id, department, year, section are required.');
      error.code = 'VALIDATION';
      error.status = 400;
      throw error;
    }

    const client = await db.pool.connect();
    let constituency;
    try {
      await client.query('BEGIN');
      const result = await client.query(
        `INSERT INTO constituencies (election_id, department, year, section, name)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [
          electionId,
          String(department).trim(),
          String(year).trim(),
          String(section).trim(),
          name || this.buildName({ department, year, section }),
        ]
      );

      constituency = result.rows[0];

      // Auto-create the locked CR position for this constituency. Guard the
      // insert so creating twice (race) never creates duplicate positions.
      await client.query(
        `INSERT INTO positions (constituency_id, name, description, display_order, max_selections)
         VALUES ($1, $2, $3, 0, 1)`,
        [constituency.id, CR_POSITION_NAME, null]
      );
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }

    return constituency;
  }

  /**
   * Update a constituency (name / is_active only; identity is immutable).
   */
  async update(id, data) {
    const { name, is_active } = data;

    const updates = [];
    const params = [];
    let paramIndex = 1;

    if (name !== undefined) {
      updates.push(`name = $${paramIndex}`);
      params.push(String(name).trim());
      paramIndex++;
    }
    if (is_active !== undefined) {
      updates.push(`is_active = $${paramIndex}`);
      params.push(Boolean(is_active));
      paramIndex++;
    }

    if (updates.length === 0) {
      return this.findById(id);
    }

    updates.push(`updated_at = NOW()`);
    params.push(id);

    const result = await db.query(
      `UPDATE constituencies SET ${updates.join(', ')}
       WHERE id = $${paramIndex}
       RETURNING *`,
      params
    );
    return result.rows[0] || null;
  }

  /**
   * Deactivate a constituency (soft delete; keeps history).
   */
  async deactivate(id) {
    const result = await db.query(
      `UPDATE constituencies SET is_active = false, updated_at = NOW()
       WHERE id = $1 AND is_active = true
       RETURNING *`,
      [id]
    );
    return result.rows[0] || null;
  }

  /**
   * Count constituencies in an election.
   */
  async countByElectionId(electionId, activeOnly = true) {
    const result = await db.query(
      `SELECT COUNT(*) as count FROM constituencies
       WHERE election_id = $1 ${activeOnly ? 'AND is_active = true' : ''}`,
      [electionId]
    );
    return parseInt(result.rows[0].count) || 0;
  }

  /**
   * Election status for a constituency.
   */
  async getElectionStatusByConstituencyId(constituencyId) {
    const result = await db.query(
      `SELECT e.status FROM elections e
       JOIN constituencies ct ON ct.election_id = e.id
       WHERE ct.id = $1`,
      [constituencyId]
    );
    return result.rows[0]?.status || null;
  }

  /**
   * Can a constituency (and its position) be modified? Only in DRAFT/SCHEDULED.
   */
  async canModify(constituencyId) {
    const status = await this.getElectionStatusByConstituencyId(constituencyId);
    return status === 'DRAFT' || status === 'SCHEDULED';
  }
}

module.exports = new ConstituencyService();