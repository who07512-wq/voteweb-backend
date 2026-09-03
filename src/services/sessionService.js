/**
 * Session Service
 * Manages user sessions
 */

const { randomBytes } = require('node:crypto');
const db = require('../db');
const { hashToken } = require('../lib/crypto');
const { setSessionCookie, clearSessionCookie, SESSION_COOKIE } = require('../lib/cookies');
const config = require('../config');

/**
 * Create a new session for a student
 * @param {object} res - Express response object
 * @param {number} studentId - Student ID
 * @param {boolean} mfaVerified - Whether MFA has been verified
 * @returns {Promise<string>} - Binding token
 */
async function createSession(res, studentId, mfaVerified = false) {
  const sessionToken = randomBytes(32).toString('base64url');
  const bindingToken = randomBytes(32).toString('base64url');

  await db.query(
    `INSERT INTO sessions (session_hash, binding_hash, student_id, mfa_verified, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 * INTERVAL '1 millisecond'))`,
    [hashToken(sessionToken), hashToken(bindingToken), studentId, mfaVerified, config.sessionTtlMs],
  );

  setSessionCookie(res, sessionToken);
  return bindingToken;
}

/**
 * Revoke a session
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
async function revokeSession(req, res) {
  const sessionId = req.cookies?.[SESSION_COOKIE];

  if (sessionId) {
    await db.query(
      'UPDATE sessions SET revoked_at = NOW() WHERE session_hash = $1 AND revoked_at IS NULL',
      [hashToken(sessionId)],
    );
  }

  clearSessionCookie(res);
}

/**
 * Rotate session (revoke old, create new)
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 * @param {number} studentId - Student ID
 * @param {boolean} mfaVerified - Whether MFA has been verified
 * @returns {Promise<string>} - New binding token
 */
async function rotateSession(req, res, studentId, mfaVerified = false) {
  await revokeSession(req, res);
  return createSession(res, studentId, mfaVerified);
}

module.exports = {
  createSession,
  revokeSession,
  rotateSession,
};
