/**
 * TOTP (Time-based One-Time Password) Utilities
 * CommonJS implementation based on voteweb-auth/src/totp.js
 * Implements RFC 6238 TOTP
 */

const { createHmac, randomBytes } = require('node:crypto');

// Base32 alphabet for TOTP secret encoding
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/**
 * Generate a random TOTP secret
 * @returns {string} - Base32-encoded secret
 */
function generateTotpSecret() {
  const bytes = randomBytes(20);
  let bits = '';

  for (const byte of bytes) {
    bits += byte.toString(2).padStart(8, '0');
  }

  let result = '';
  for (let index = 0; index < bits.length; index += 5) {
    result += BASE32[parseInt(bits.slice(index, index + 5).padEnd(5, '0'), 2)];
  }

  return result;
}

/**
 * Decode a Base32 string to bytes
 * @param {string} value - Base32-encoded string
 * @returns {Buffer} - Decoded bytes
 */
function decodeBase32(value) {
  const normalized = value.toUpperCase().replace(/[^A-Z2-7]/g, '');
  let bits = '';

  for (const character of normalized) {
    bits += BASE32.indexOf(character).toString(2).padStart(5, '0');
  }

  const bytes = [];
  for (let index = 0; index + 8 <= bits.length; index += 8) {
    bytes.push(parseInt(bits.slice(index, index + 8), 2));
  }

  return Buffer.from(bytes);
}

/**
 * Generate a TOTP code for the given secret and timestamp
 * @param {string} secret - Base32-encoded TOTP secret
 * @param {number} [timestamp=Date.now()] - Timestamp in milliseconds
 * @returns {string} - 6-digit TOTP code
 */
function getTotpCode(secret, timestamp = Date.now()) {
  // Calculate the counter value (30-second windows)
  const counter = Math.floor(timestamp / 30_000);

  // Create an 8-byte counter buffer (big-endian)
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));

  // Generate HMAC-SHA1
  const digest = createHmac('sha1', decodeBase32(secret)).update(counterBuffer).digest();

  // Dynamic truncation
  const offset = digest[digest.length - 1] & 0x0f;
  const binary = (
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff)
  );

  // Return 6-digit code, padded with leading zeros
  return String(binary % 1_000_000).padStart(6, '0');
}

/**
 * Verify a TOTP code against a secret
 * Allows for ±1 window (clock drift tolerance)
 * @param {string} secret - Base32-encoded TOTP secret
 * @param {string} code - 6-digit TOTP code to verify
 * @param {number} [timestamp=Date.now()] - Timestamp in milliseconds
 * @returns {boolean} - True if code is valid
 */
function verifyTotp(secret, code, timestamp = Date.now()) {
  // Validate code format
  if (!/^\d{6}$/.test(String(code))) {
    return false;
  }

  // Allow for clock drift of one 30-second window
  return [-30_000, 0, 30_000].some((offset) => {
    return getTotpCode(secret, timestamp + offset) === String(code);
  });
}

/**
 * Generate a provisioning URI for authenticator apps
 * Format: otpauth://totp/{issuer}:{account}?secret={secret}&issuer={issuer}&algorithm=SHA1&digits=6&period=30
 * @param {string} secret - Base32-encoded TOTP secret
 * @param {string} identifier - User identifier (account name)
 * @param {string} [issuer='CampusVote'] - Service name
 * @returns {string} - otpauth:// URI
 */
function provisioningUri(secret, identifier, issuer = 'CampusVote') {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(identifier)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

module.exports = {
  generateTotpSecret,
  getTotpCode,
  verifyTotp,
  provisioningUri,
};
