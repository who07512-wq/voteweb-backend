/**
 * OTP Service
 * Manages OTP generation, hashing, verification, and expiration
 */

const crypto = require('node:crypto');
const db = require('../db');

const OTP_LENGTH = 6;
const OTP_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000; // 60 seconds

// HMAC secret for OTP hashing - should be in environment
const OTP_SECRET = process.env.OTP_SECRET || 'dev-otp-secret-change-in-production';

/**
 * Generate a cryptographically secure 6-digit OTP
 * @returns {string} 6-digit OTP
 */
function generateOtp() {
  const otp = crypto.randomInt(100000, 999999).toString();
  return otp;
}

/**
 * Create HMAC hash of OTP
 * @param {string} otp - Plain OTP
 * @returns {string} HMAC-SHA256 hash
 */
function hashOtp(otp) {
  return crypto
    .createHmac('sha256', OTP_SECRET)
    .update(otp)
    .digest('hex');
}

/**
 * Verify OTP against stored hash
 * @param {string} otp - Plain OTP from user
 * @param {string} storedHash - Stored hash
 * @returns {boolean} True if OTP matches
 */
function verifyOtp(otp, storedHash) {
  const inputHash = hashOtp(otp);
  return crypto.timingSafeEqual(
    Buffer.from(inputHash),
    Buffer.from(storedHash)
  );
}

/**
 * Create a new OTP challenge
 * @param {string} email - Target email
 * @param {string} purpose - 'LOGIN_OTP' or 'PASSWORD_RESET'
 * @param {string|null} targetRole - 'STUDENT', 'CANDIDATE', or null
 * @param {string} rateKey - Rate limit key (IP or email)
 * @returns {Promise<{id: number, otp: string, expiresAt: Date}>}
 */
async function createOtpChallenge(email, purpose, targetRole = null, rateKey = null) {
  // Check for recent OTP (rate limit / resend cooldown)
  const recentOtp = await findRecentOtp(email, purpose);
  if (recentOtp) {
    const timeSinceCreation = Date.now() - new Date(recentOtp.created_at).getTime();
    if (timeSinceCreation < RESEND_COOLDOWN_MS) {
      const remainingSeconds = Math.ceil((RESEND_COOLDOWN_MS - timeSinceCreation) / 1000);
      throw new Error(`RESEND_COOLDOWN:${remainingSeconds}`);
    }
  }

  // Generate OTP and hash
  const otp = generateOtp();
  const otpHash = hashOtp(otp);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MS);

  // Insert challenge
  const result = await db.query(
    `INSERT INTO otp_challenges (purpose, target_role, email, otp_hash, expires_at, rate_key)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [purpose, targetRole, email.toLowerCase(), otpHash, expiresAt, rateKey]
  );

  // Mark old unused OTPs as used
  await db.query(
    `UPDATE otp_challenges
     SET used = TRUE
     WHERE email = $1 AND purpose = $2 AND id != $3 AND used = FALSE`,
    [email.toLowerCase(), purpose, result.rows[0].id]
  );

  return {
    id: result.rows[0].id,
    otp,
    expiresAt,
  };
}

/**
 * Find recent OTP for rate limiting
 * @param {string} email
 * @param {string} purpose
 * @returns {Promise<object|null>}
 */
async function findRecentOtp(email, purpose) {
  const result = await db.query(
    `SELECT id, created_at, expires_at
     FROM otp_challenges
     WHERE email = $1 AND purpose = $2 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC
     LIMIT 1`,
    [email.toLowerCase(), purpose]
  );
  return result.rows[0] || null;
}

/**
 * Find valid OTP challenge
 * @param {string} email
 * @param {string} purpose - 'LOGIN_OTP' or 'PASSWORD_RESET'
 * @param {string|null} targetRole - 'STUDENT' or 'CANDIDATE' for LOGIN_OTP (null for PASSWORD_RESET)
 * @returns {Promise<object|null>}
 */
async function findValidChallenge(email, purpose, targetRole = null) {
  let query = `SELECT * FROM otp_challenges
     WHERE email = $1 AND purpose = $2 AND used = FALSE AND expires_at > NOW()`;
  const params = [email.toLowerCase(), purpose];

  // Filter by target_role for LOGIN_OTP (PASSWORD_RESET has null target_role)
  if (targetRole && purpose === 'LOGIN_OTP') {
    query += ` AND target_role = $3`;
    params.push(targetRole);
  }

  query += ` ORDER BY created_at DESC LIMIT 1`;

  const result = await db.query(query, params);
  return result.rows[0] || null;
}

/**
 * Verify OTP and mark as used
 * @param {string} email
 * @param {string} purpose
 * @param {string} otp
 * @param {string|null} targetRole - Role to verify (for LOGIN_OTP)
 * @returns {Promise<{success: boolean, error: string|null, challenge: object|null}>}
 */
async function verifyOtpChallenge(email, purpose, otp, targetRole = null) {
  const challenge = await findValidChallenge(email, purpose, targetRole);

  if (!challenge) {
    return { success: false, error: 'OTP_EXPIRED', challenge: null };
  }

  // Check attempt limit
  if (challenge.attempts >= MAX_ATTEMPTS) {
    await db.query(
      'UPDATE otp_challenges SET used = TRUE WHERE id = $1',
      [challenge.id]
    );
    return { success: false, error: 'MAX_ATTEMPTS', challenge: null };
  }

  // Increment attempt count
  await db.query(
    'UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1',
    [challenge.id]
  );

  // Verify OTP
  if (!verifyOtp(otp, challenge.otp_hash)) {
    return { success: false, error: 'INVALID_OTP', challenge };
  }

  // Mark as consumed
  await db.query(
    'UPDATE otp_challenges SET used = TRUE, consumed_at = NOW() WHERE id = $1',
    [challenge.id]
  );

  return { success: true, error: null, challenge };
}

/**
 * Get rate limit status for IP
 * @param {string} ip - Client IP
 * @returns {Promise<{allowed: boolean, remainingAttempts: number, retryAfterMs: number}>}
 */
async function checkRateLimit(ip) {
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const result = await db.query(
    `SELECT COUNT(*) as count FROM otp_challenges
     WHERE rate_key = $1 AND created_at > $2`,
    [ip, oneHourAgo]
  );

  const count = parseInt(result.rows[0].count, 10);
  const MAX_PER_HOUR = 10;

  if (count >= MAX_PER_HOUR) {
    return { allowed: false, remainingAttempts: 0, retryAfterMs: 60 * 60 * 1000 };
  }

  return { allowed: true, remainingAttempts: MAX_PER_HOUR - count, retryAfterMs: 0 };
}

/**
 * Clean up expired OTP challenges
 * @returns {Promise<number>} Number of deleted challenges
 */
async function cleanupExpired() {
  const result = await db.query(
    'DELETE FROM otp_challenges WHERE expires_at < NOW() AND used = FALSE'
  );
  return result.rowCount;
}

module.exports = {
  generateOtp,
  hashOtp,
  verifyOtp,
  createOtpChallenge,
  findRecentOtp,
  findValidChallenge,
  verifyOtpChallenge,
  checkRateLimit,
  cleanupExpired,
  OTP_EXPIRY_MS,
  MAX_ATTEMPTS,
  RESEND_COOLDOWN_MS,
};
