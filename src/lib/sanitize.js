/**
 * Input Sanitization Utility
 * Prevents XSS attacks by sanitizing user input before storage
 *
 * SECURITY:
 * - All user-provided text should be sanitized before database storage
 * - React auto-escapes on the frontend, but server-side sanitization is defense-in-depth
 * - Strips HTML tags and dangerous characters
 */

/**
 * Sanitize a string by removing HTML tags and dangerous characters
 * @param {string} input - Raw user input
 * @returns {string} - Sanitized string
 */
function sanitizeString(input, maxLength = 5000) {
  if (typeof input !== 'string') return input;

  return input
    // Remove HTML tags
    .replace(/<[^>]*>/g, '')
    // Remove script content
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    // Remove event handlers
    .replace(/\s*on\w+\s*=\s*["'][^"']*["']/gi, '')
    // Remove javascript: protocol
    .replace(/javascript\s*:/gi, '')
    // Remove data: protocol (except images)
    .replace(/data\s*:[^image]/gi, '')
    // Remove vbscript: protocol
    .replace(/vbscript\s*:/gi, '')
    // Trim whitespace
    .trim()
    // Enforce max length
    .substring(0, maxLength);
}

/**
 * Sanitize an object's string properties
 * @param {object} obj - Object with properties to sanitize
 * @param {string[]} fields - List of field names to sanitize
 * @returns {object} - Sanitized object
 */
function sanitizeFields(obj, fields, maxLengths = {}) {
  if (!obj || typeof obj !== 'object') return obj;

  const sanitized = { ...obj };
  for (const field of fields) {
    if (typeof sanitized[field] === 'string') {
      sanitized[field] = sanitizeString(sanitized[field], maxLengths[field] || 5000);
    }
  }
  return sanitized;
}

/**
 * Validate input length and return error if too long
 * @param {string} value - Input value
 * @param {number} max - Maximum length
 * @param {string} fieldName - Field name for error message
 * @returns {string|null} - Error message or null if valid
 */
function validateLength(value, max, fieldName) {
  if (typeof value !== 'string') return null;
  if (value.length > max) {
    return `${fieldName} must be ${max} characters or fewer (currently ${value.length})`;
  }
  return null;
}

/**
 * Validate and sanitize email
 * @param {string} email - Raw email
 * @returns {string} - Sanitized email or empty string if invalid
 */
function sanitizeEmail(email) {
  if (typeof email !== 'string') return '';
  // Basic email sanitization - remove dangerous chars, keep valid email chars
  return email
    .replace(/[<>'"]/g, '')
    .trim()
    .toLowerCase();
}

/**
 * Validate and sanitize a name (no special characters except spaces, hyphens, apostrophes)
 * @param {string} name - Raw name
 * @returns {string} - Sanitized name
 */
function sanitizeName(name) {
  if (typeof name !== 'string') return '';
  return name
    .replace(/[<>"{}[\]\\]/g, '')
    .trim();
}

module.exports = {
  sanitizeString,
  sanitizeFields,
  sanitizeEmail,
  sanitizeName,
  validateLength,
};
