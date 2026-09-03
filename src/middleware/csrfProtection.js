/**
 * CSRF Protection Middleware
 * Double-submit cookie pattern for CSRF protection
 */

const { CSRF_COOKIE } = require('../lib/cookies');

/**
 * Timing-safe string comparison
 * @param {string} left - First string
 * @param {string} right - Second string
 * @returns {boolean} - True if strings are equal
 */
function sameToken(left, right) {
  if (!left || !right) return false;

  const { timingSafeEqual } = require('node:crypto');
  const a = Buffer.from(left);
  const b = Buffer.from(right);

  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * CSRF protection middleware
 * Validates CSRF token on state-changing requests
 * Only applies to POST, PUT, PATCH, DELETE methods
 */
function csrfProtection(req, res, next) {
  // Only check state-changing methods
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE];
  const headerToken = req.get('X-CSRF-Token');

  if (!cookieToken || !headerToken) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid CSRF token.',
      code: 'CSRF_INVALID',
    });
  }

  if (!sameToken(cookieToken, headerToken)) {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Invalid CSRF token.',
      code: 'CSRF_INVALID',
    });
  }

  return next();
}

module.exports = { csrfProtection };
