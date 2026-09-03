/**
 * Seed Authentication Script
 * Creates test users with passwords for authentication testing
 *
 * Usage: node seed-auth.js
 */

require('dotenv').config({ path: './.env' });

// PRODUCTION SAFETY: this script creates accounts with publicly documented
// passwords (ADMIN001 / AdminPassword123!) and disables admin MFA. Never run
// it against a production database unless you really mean to.
if (process.env.NODE_ENV === 'production' && process.env.SEED_ALLOWED_IN_PROD !== 'true') {
  console.error('Refusing to seed test users in production.');
  console.error('Set SEED_ALLOWED_IN_PROD=true to override (NOT recommended).');
  process.exit(1);
}

const { hashPassword } = require('./src/lib/password');
const db = require('./src/db');

async function seed() {
  console.log('Creating test users with passwords...');

  try {
    // Create admin user
    console.log('Creating admin user...');
    const adminHash = await hashPassword('AdminPassword123!');

    // First check if admin student exists
    let adminStudent = await db.query(
      "SELECT id FROM students WHERE external_id = 'ADMIN001'"
    );

    let adminId;
    if (adminStudent.rows.length === 0) {
      // Create admin student
      const result = await db.query(
        `INSERT INTO students (external_id, name, email, role, password_hash, password_change_required)
         VALUES ('ADMIN001', 'Admin User', 'admin@campusvote.edu', 'ADMIN', $1, FALSE)
         RETURNING id`,
        [adminHash]
      );
      adminId = result.rows[0].id;
      console.log(`Created admin student with ID: ${adminId}`);
    } else {
      // Update existing admin
      adminId = adminStudent.rows[0].id;
      await db.query(
        `UPDATE students SET
          password_hash = $1,
          password_change_required = FALSE,
          role = 'ADMIN',
          mfa_enabled = FALSE
         WHERE id = $2`,
        [adminHash, adminId]
      );
      console.log(`Updated admin student with ID: ${adminId}`);
    }

    // Create student user
    console.log('Creating student user...');
    const studentHash = await hashPassword('StudentPassword123!');

    let student = await db.query(
      "SELECT id FROM students WHERE external_id = 'STU001'"
    );

    let studentId;
    if (student.rows.length === 0) {
      const result = await db.query(
        `INSERT INTO students (external_id, name, email, role, password_hash, password_change_required)
         VALUES ('STU001', 'Test Student', 'student@campusvote.edu', 'STUDENT', $1, FALSE)
         RETURNING id`,
        [studentHash]
      );
      studentId = result.rows[0].id;
      console.log(`Created student with ID: ${studentId}`);
    } else {
      studentId = student.rows[0].id;
      await db.query(
        `UPDATE students SET
          password_hash = $1,
          password_change_required = FALSE,
          role = 'STUDENT'
         WHERE id = $2`,
        [studentHash, studentId]
      );
      console.log(`Updated student with ID: ${studentId}`);
    }

    // Create candidate user
    console.log('Creating candidate user...');
    const candidateHash = await hashPassword('CandidatePassword123!');

    let candidate = await db.query(
      "SELECT id FROM students WHERE external_id = 'CAN001'"
    );

    let candidateId;
    if (candidate.rows.length === 0) {
      const result = await db.query(
        `INSERT INTO students (external_id, name, email, role, password_hash, password_change_required)
         VALUES ('CAN001', 'Test Candidate', 'candidate@campusvote.edu', 'CANDIDATE', $1, FALSE)
         RETURNING id`,
        [candidateHash]
      );
      candidateId = result.rows[0].id;
      console.log(`Created candidate with ID: ${candidateId}`);
    } else {
      candidateId = candidate.rows[0].id;
      await db.query(
        `UPDATE students SET
          password_hash = $1,
          password_change_required = FALSE,
          role = 'CANDIDATE'
         WHERE id = $2`,
        [candidateHash, candidateId]
      );
      console.log(`Updated candidate with ID: ${candidateId}`);
    }

    console.log('\n✅ Test users created successfully!\n');
    console.log('Test credentials:');
    console.log('─────────────────');
    console.log('Admin:    ADMIN001 / AdminPassword123!');
    console.log('Student:  STU001 / StudentPassword123!');
    console.log('Candidate: CAN001 / CandidatePassword123!');
    console.log('─────────────────\n');
    console.log('Note: Admin user requires MFA for login.');
    console.log('Set up MFA using the TOTP setup flow or disable MFA for testing.\n');

  } catch (error) {
    console.error('Error seeding users:', error);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

seed();
