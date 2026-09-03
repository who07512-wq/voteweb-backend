/**
 * Student Service
 * Business logic for student management
 */

const db = require('../db');

/**
 * Remove sensitive fields from student record
 */
function sanitizeStudent(student) {
  if (!student) return null;
  const { password_hash, mfa_secret_encrypted, ...safe } = student;
  return safe;
}

/**
 * Remove sensitive fields from array of student records
 */
function sanitizeStudents(students) {
  return students.map(sanitizeStudent);
}

class StudentService {
  /**
   * Find all students
   */
  async findAll(options = {}) {
    const { activeOnly = false, limit = 100, offset = 0 } = options;

    let query = 'SELECT * FROM students';
    const params = [];

    if (activeOnly) {
      query += ' WHERE is_active = true';
    }

    query += ' ORDER BY id LIMIT $1 OFFSET $2';
    params.push(limit, offset);

    const result = await db.query(query, params);
    return sanitizeStudents(result.rows);
  }

  /**
   * Find student by ID
   */
  async findById(id) {
    const result = await db.query(
      'SELECT * FROM students WHERE id = $1',
      [id]
    );
    return sanitizeStudent(result.rows[0]) || null;
  }

  /**
   * Find student by external ID
   */
  async findByExternalId(externalId) {
    const result = await db.query(
      'SELECT * FROM students WHERE external_id = $1',
      [externalId]
    );
    return sanitizeStudent(result.rows[0]) || null;
  }

  /**
   * Create a new student
   */
  async create(data) {
    const { external_id, name, email } = data;

    const result = await db.query(
      `INSERT INTO students (external_id, name, email)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [external_id, name, email]
    );

    return sanitizeStudent(result.rows[0]);
  }

  /**
   * Update student
   */
  async update(id, data) {
    const { name, email } = data;

    const result = await db.query(
      `UPDATE students SET name = $1, email = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [name, email, id]
    );

    return sanitizeStudent(result.rows[0]) || null;
  }

  /**
   * Update student status (activate/deactivate)
   */
  async updateStatus(id, isActive) {
    const result = await db.query(
      `UPDATE students SET is_active = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [isActive, id]
    );

    return sanitizeStudent(result.rows[0]) || null;
  }
}

module.exports = new StudentService();
