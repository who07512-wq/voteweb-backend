/**
 * MFA Challenge Service
 * Manages MFA challenges for TOTP enrollment and verification
 */

const { randomBytes } = require('node:crypto');
const db = require('../db');
const { hashToken } = require('../lib/crypto');
const config = require('../config');

/**
 * Create an MFA challenge for a student
 * @param {number} studentId - Student ID
 * @param {boolean} needsEnrollment - Whether this is for MFA enrollment
 * @returns {Promise<object>} - Challenge and optional enrollment token
 */
async function createMfaChallenge(studentId, needsEnrollment = false) {
  const challenge = randomBytes(32).toString('base64url');
  const enrollmentToken = needsEnrollment ? randomBytes(32).toString('base64url') : null;

  await db.query(
    `INSERT INTO mfa_challenges (challenge_hash, enrollment_hash, student_id, expires_at)
     VALUES ($1, $2, $3, NOW() + ($4 * INTERVAL '1 millisecond'))`,
    [hashToken(challenge), enrollmentToken ? hashToken(enrollmentToken) : null, studentId, config.mfaChallengeMs],
  );

  return { challenge, enrollmentToken };
}

/**
 * Find an MFA challenge
 * @param {string} challengeText - Challenge hash
 * @returns {Promise<object|null>} - Challenge record or null
 */
async function findChallenge(challengeText) {
  const result = await db.query(
    `SELECT c.*, st.external_id, st.name, st.email, st.role,
            st.password_change_required, st.mfa_enabled, st.mfa_secret_encrypted,
            st.password_hash
       FROM mfa_challenges c
       JOIN students st ON st.id = c.student_id
      WHERE c.challenge_hash = $1 AND c.expires_at > NOW()`,
    [hashToken(challengeText)],
  );

  return result.rows[0] || null;
}

/**
 * Increment challenge attempts
 * @param {number} id - Challenge ID
 */
async function incrementChallengeAttempts(id) {
  await db.query(
    'UPDATE mfa_challenges SET attempts = attempts + 1 WHERE id = $1',
    [id],
  );
}

/**
 * Delete a challenge
 * @param {number} id - Challenge ID
 */
async function deleteChallenge(id) {
  await db.query('DELETE FROM mfa_challenges WHERE id = $1', [id]);
}

module.exports = {
  createMfaChallenge,
  findChallenge,
  incrementChallengeAttempts,
  deleteChallenge,
};
