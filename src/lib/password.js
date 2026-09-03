/**
 * Password Hashing Utilities
 * CommonJS implementation based on voteweb-auth/src/password.js
 * Uses scrypt for password hashing with high cost factor
 */

const { promisify } = require('node:util');
const { randomBytes, scrypt, timingSafeEqual } = require('node:crypto');

const scryptAsync = promisify(scrypt);

// scrypt parameters - high cost factor for security
const N = 16_384;  // CPU/memory cost parameter
const r = 8;       // block size
const p = 1;       // parallelization
const KEY_LENGTH = 64;  // output length in bytes

/**
 * Hash a password using scrypt
 * @param {string} password - Plain text password
 * @returns {Promise<string>} - Hashed password in format: scrypt$N$r$p$salt$hash
 */
async function hashPassword(password) {
  const salt = randomBytes(16);
  const derived = await scryptAsync(password, salt, KEY_LENGTH, { N, r, p, maxmem: 32 * 1024 * 1024 });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64url')}$${Buffer.from(derived).toString('base64url')}`;
}

/**
 * Verify a password against a stored hash
 * @param {string} password - Plain text password to verify
 * @param {string} encoded - Stored password hash
 * @returns {Promise<boolean>} - True if password matches
 */
async function verifyPassword(password, encoded) {
  try {
    const [algorithm, n, costR, costP, saltText, hashText] = encoded.split('$');

    if (algorithm !== 'scrypt') {
      return false;
    }

    const salt = Buffer.from(saltText, 'base64url');
    const expected = Buffer.from(hashText, 'base64url');

    const actual = await scryptAsync(password, salt, expected.length, {
      N: Number(n),
      r: Number(costR),
      p: Number(costP),
      maxmem: 32 * 1024 * 1024,
    });

    // Use timing-safe comparison to prevent timing attacks
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch (error) {
    // Log error but don't expose details
    console.error('Password verification error:', error.message);
    return false;
  }
}

// Common passwords that should be rejected
const COMMON_PASSWORDS = new Set([
  'password', 'password123', '123456789', '12345678', 'qwertyuiop',
  'letmein', 'welcome', 'admin123', 'campusvote', 'changeme',
  'student', 'student123', 'vote', 'vote123', 'election',
  '123456', '1234567', 'abc123', 'admin', 'root', 'test'
]);

/**
 * Validate password against security policy
 * @param {string} password - Password to validate
 * @param {string} identifier - User identifier (student ID) for contextual validation
 * @returns {string|null} - Error message if invalid, null if valid
 */
function validatePasswordPolicy(password, identifier = '') {
  // Check minimum length
  if (typeof password !== 'string' || password.length < 12) {
    return 'Password must be at least 12 characters.';
  }

  // Check maximum length
  if (password.length > 128) {
    return 'Password is too long (maximum 128 characters).';
  }

  const normalized = password.toLowerCase();

  // Check for common passwords
  if (COMMON_PASSWORDS.has(normalized)) {
    return 'Choose a less common password.';
  }

  // Check for repetitive patterns
  if (/^(.)\1+$/.test(password)) {
    return 'Password is too easy to guess.';
  }

  // Check for sequential patterns
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/i.test(password)) {
    return 'Password is too easy to guess.';
  }

  // Check that password doesn't contain username/identifier
  if (identifier && password.toLowerCase().includes(identifier.toLowerCase())) {
    return 'Password must not contain your username or student ID.';
  }

  return null; // Password is valid
}

module.exports = {
  hashPassword,
  verifyPassword,
  validatePasswordPolicy
};
