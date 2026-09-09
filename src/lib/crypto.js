/**
 * Cryptographic Utilities
 * CommonJS implementation based on voteweb-auth/src/crypto.js
 * Provides encryption/decryption for TOTP secrets and token hashing
 */

const { createCipheriv, createDecipheriv, createHmac, randomBytes } = require('node:crypto');

/**
 * Get TOTP encryption key from environment
 * @returns {Buffer} - 32-byte encryption key
 */
function getTotpEncryptionKey() {
  const keyValue = process.env.TOTP_ENCRYPTION_KEY || '';
  let key;

  try {
    key = Buffer.from(keyValue, 'base64');
  } catch (error) {
    throw new Error('TOTP_ENCRYPTION_KEY must be base64 encoded');
  }

  if (key.length !== 32) {
    throw new Error('TOTP_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }

  return key;
}

/**
 * Hash a session token for storage
 * Uses HMAC-SHA256 with session secret
 * @param {string} token - Plain text token
 * @returns {string} - Hex-encoded hash
 */
function hashToken(token) {
  const secret = process.env.SESSION_SECRET || 'dev-only-session-secret-32chars!';
  return createHmac('sha256', secret).update(token).digest('hex');
}

/**
 * Encrypt a TOTP secret using AES-256-GCM
 * @param {string} value - Plain text value to encrypt
 * @returns {Buffer} - Encrypted value with IV and auth tag
 */
function encryptSecret(value) {
  const key = getTotpEncryptionKey();
  const iv = randomBytes(12);

  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  // Format: IV (12 bytes) + AuthTag (16 bytes) + Encrypted data
  return Buffer.concat([iv, authTag, encrypted]);
}

/**
 * Decrypt a TOTP secret
 * @param {Buffer} value - Encrypted value
 * @returns {string} - Decrypted plain text
 */
function decryptSecret(value) {
  const key = getTotpEncryptionKey();

  // Ensure we have a Buffer
  const data = Buffer.isBuffer(value) ? value : Buffer.from(value);

  // Extract components
  const iv = data.subarray(0, 12);
  const authTag = data.subarray(12, 28);
  const encrypted = data.subarray(28);

  // Decrypt
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

module.exports = {
  hashToken,
  encryptSecret,
  decryptSecret,
  getTotpEncryptionKey
};
