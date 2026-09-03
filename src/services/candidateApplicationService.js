/**
 * Candidate Application Service
 * Business logic for candidate application workflow
 */

const db = require('../db');

class CandidateApplicationService {
  /**
   * Create a new candidate application
   */
  async create(data, studentId) {
    const {
      fullName,
      enrollmentNumber,
      department,
      year,
      semester,
      section,
      positionId,
      email,
      phone,
      profilePhotoUrl,
      bio,
      manifesto,
    } = data;

    // Check if enrollment number already has an application (not rejected)
    const existingApp = await db.query(
      `SELECT id FROM candidate_applications
       WHERE enrollment_number = $1 AND status != 'rejected'`,
      [enrollmentNumber]
    );

    if (existingApp.rows.length > 0) {
      const error = new Error('An application already exists for this enrollment number.');
      error.code = 'DUPLICATE_ENROLLMENT';
      error.status = 409;
      throw error;
    }

    // Verify position exists
    const positionCheck = await db.query(
      'SELECT id, name FROM positions WHERE id = $1',
      [positionId]
    );

    if (positionCheck.rows.length === 0) {
      const error = new Error('Invalid position selected.');
      error.code = 'INVALID_POSITION';
      error.status = 400;
      throw error;
    }

    // Create the application with status = under_review
    const result = await db.query(
      `INSERT INTO candidate_applications (
        student_id, full_name, enrollment_number, department, year, semester, section,
        position_id, email, phone, profile_photo_url, bio, manifesto,
        status, submitted_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'under_review', NOW())
      RETURNING *`,
      [
        studentId, fullName, enrollmentNumber, department, year, semester || null, section || null,
        positionId, email, phone, profilePhotoUrl || null, bio || null, manifesto || null,
      ]
    );

    return this.formatApplication(result.rows[0]);
  }

  /**
   * Get application by student ID
   */
  async getByStudentId(studentId) {
    const result = await db.query(
      `SELECT ca.*, p.name as position_name
       FROM candidate_applications ca
       LEFT JOIN positions p ON ca.position_id = p.id
       WHERE ca.student_id = $1
       ORDER BY ca.created_at DESC
       LIMIT 1`,
      [studentId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.formatApplication(result.rows[0]);
  }

  /**
   * Get application by ID
   */
  async getById(id) {
    const result = await db.query(
      `SELECT ca.*, p.name as position_name,
              r.name as reviewer_name
       FROM candidate_applications ca
       LEFT JOIN positions p ON ca.position_id = p.id
       LEFT JOIN students r ON ca.reviewed_by = r.id
       WHERE ca.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return null;
    }

    return this.formatApplication(result.rows[0]);
  }

  /**
   * List all applications for admin (with filtering)
   */
  async listForAdmin(filters = {}) {
    const { status, department, positionId, search, limit = 100, offset = 0 } = filters;

    let query = `
      SELECT ca.*, p.name as position_name
      FROM candidate_applications ca
      LEFT JOIN positions p ON ca.position_id = p.id
      WHERE 1=1
    `;
    const params = [];
    let paramIndex = 1;

    if (status && status !== 'all') {
      query += ` AND ca.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (department && department !== 'all') {
      query += ` AND ca.department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }

    if (positionId && positionId !== 'all') {
      query += ` AND ca.position_id = $${paramIndex}`;
      params.push(parseInt(positionId));
      paramIndex++;
    }

    if (search) {
      query += ` AND (
        ca.full_name ILIKE $${paramIndex} OR
        ca.enrollment_number ILIKE $${paramIndex} OR
        ca.email ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    query += ` ORDER BY ca.submitted_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await db.query(query, params);
    return result.rows.map(row => this.formatApplication(row));
  }

  /**
   * Count applications for admin
   */
  async countForAdmin(filters = {}) {
    const { status, department, positionId, search } = filters;

    let query = `SELECT COUNT(*) as total FROM candidate_applications ca WHERE 1=1`;
    const params = [];
    let paramIndex = 1;

    if (status && status !== 'all') {
      query += ` AND ca.status = $${paramIndex}`;
      params.push(status);
      paramIndex++;
    }

    if (department && department !== 'all') {
      query += ` AND ca.department = $${paramIndex}`;
      params.push(department);
      paramIndex++;
    }

    if (positionId && positionId !== 'all') {
      query += ` AND ca.position_id = $${paramIndex}`;
      params.push(parseInt(positionId));
      paramIndex++;
    }

    if (search) {
      query += ` AND (
        ca.full_name ILIKE $${paramIndex} OR
        ca.enrollment_number ILIKE $${paramIndex} OR
        ca.email ILIKE $${paramIndex}
      )`;
      params.push(`%${search}%`);
    }

    const result = await db.query(query, params);
    return parseInt(result.rows[0].total);
  }

  /**
   * Approve application
   */
  async approve(id, adminId) {
    const app = await this.getById(id);

    if (!app) {
      const error = new Error('Application not found.');
      error.code = 'NOT_FOUND';
      error.status = 404;
      throw error;
    }

    if (app.status !== 'under_review') {
      const error = new Error('Application cannot be approved from current status.');
      error.code = 'INVALID_STATUS_TRANSITION';
      error.status = 400;
      throw error;
    }

    const result = await db.query(
      `UPDATE candidate_applications
       SET status = 'approved',
           reviewed_by = $1,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [adminId, id]
    );

    return this.formatApplication(result.rows[0]);
  }

  /**
   * Reject application
   */
  async reject(id, reason, adminId) {
    const app = await this.getById(id);

    if (!app) {
      const error = new Error('Application not found.');
      error.code = 'NOT_FOUND';
      error.status = 404;
      throw error;
    }

    if (app.status !== 'under_review') {
      const error = new Error('Application cannot be rejected from current status.');
      error.code = 'INVALID_STATUS_TRANSITION';
      error.status = 400;
      throw error;
    }

    const result = await db.query(
      `UPDATE candidate_applications
       SET status = 'rejected',
           rejection_reason = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [reason, adminId, id]
    );

    return this.formatApplication(result.rows[0]);
  }

  /**
   * Request changes
   */
  async requestChanges(id, reason, adminId) {
    const app = await this.getById(id);

    if (!app) {
      const error = new Error('Application not found.');
      error.code = 'NOT_FOUND';
      error.status = 404;
      throw error;
    }

    if (app.status !== 'under_review') {
      const error = new Error('Application cannot request changes from current status.');
      error.code = 'INVALID_STATUS_TRANSITION';
      error.status = 400;
      throw error;
    }

    const result = await db.query(
      `UPDATE candidate_applications
       SET status = 'changes_requested',
           changes_requested_reason = $1,
           reviewed_by = $2,
           reviewed_at = NOW(),
           updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [reason, adminId, id]
    );

    return this.formatApplication(result.rows[0]);
  }

  /**
   * Resubmit application (candidate updates after changes_requested)
   */
  async resubmit(id, data, studentId) {
    const app = await this.getById(id);

    if (!app) {
      const error = new Error('Application not found.');
      error.code = 'NOT_FOUND';
      error.status = 404;
      throw error;
    }

    // Only changes_requested applications can be resubmitted
    if (app.status !== 'changes_requested') {
      const error = new Error('Application can only be resubmitted when changes are requested.');
      error.code = 'INVALID_STATUS';
      error.status = 400;
      throw error;
    }

    // Verify ownership
    if (app.studentId !== studentId) {
      const error = new Error('You can only update your own application.');
      error.code = 'FORBIDDEN';
      error.status = 403;
      throw error;
    }

    // Update only allowed fields (verified fields are NOT allowed to change)
    const { bio, manifesto, profilePhotoUrl, email, phone } = data;

    const result = await db.query(
      `UPDATE candidate_applications
       SET status = 'under_review',
           bio = COALESCE($1, bio),
           manifesto = COALESCE($2, manifesto),
           profile_photo_url = COALESCE($3, profile_photo_url),
           email = COALESCE($4, email),
           phone = COALESCE($5, phone),
           changes_requested_reason = NULL,
           reviewed_by = NULL,
           reviewed_at = NULL,
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [bio, manifesto, profilePhotoUrl, email, phone, id]
    );

    return this.formatApplication(result.rows[0]);
  }

  /**
   * Update profile after approval (only editable fields)
   */
  async updateProfile(id, data, studentId) {
    const app = await this.getById(id);

    if (!app) {
      const error = new Error('Application not found.');
      error.code = 'NOT_FOUND';
      error.status = 404;
      throw error;
    }

    // Verify ownership
    if (app.studentId !== studentId) {
      const error = new Error('You can only update your own application.');
      error.code = 'FORBIDDEN';
      error.status = 403;
      throw error;
    }

    // If not approved, they shouldn't be accessing profile update
    if (app.status !== 'approved') {
      const error = new Error('Profile can only be updated after approval.');
      error.code = 'NOT_APPROVED';
      error.status = 403;
      throw error;
    }

    // Only allow editable fields
    const { bio, manifesto, profilePhotoUrl } = data;

    const result = await db.query(
      `UPDATE candidate_applications
       SET bio = COALESCE($1, bio),
           manifesto = COALESCE($2, manifesto),
           profile_photo_url = COALESCE($3, profile_photo_url),
           updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [bio, manifesto, profilePhotoUrl, id]
    );

    return this.formatApplication(result.rows[0]);
  }

  /**
   * Get access info for candidate portal
   */
  async getAccessInfo(studentId) {
    const app = await this.getByStudentId(studentId);

    if (!app) {
      return {
        hasApplication: false,
        status: null,
        isApproved: false,
        canAccessCandidatePortal: false,
      };
    }

    return {
      hasApplication: true,
      status: app.status,
      isApproved: app.status === 'approved',
      canAccessCandidatePortal: app.status === 'approved',
    };
  }

  /**
   * Format application for API response
   */
  formatApplication(row) {
    if (!row) return null;

    return {
      id: row.id,
      studentId: row.student_id,
      fullName: row.full_name,
      enrollmentNumber: row.enrollment_number,
      department: row.department,
      year: row.year,
      semester: row.semester,
      section: row.section,
      positionId: row.position_id,
      positionName: row.position_name,
      email: row.email,
      phone: row.phone,
      profilePhotoUrl: row.profile_photo_url,
      bio: row.bio,
      manifesto: row.manifesto,
      status: row.status,
      rejectionReason: row.rejection_reason,
      changesRequestedReason: row.changes_requested_reason,
      reviewedBy: row.reviewed_by,
      reviewerName: row.reviewer_name,
      reviewedAt: row.reviewed_at,
      submittedAt: row.submitted_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

module.exports = new CandidateApplicationService();
