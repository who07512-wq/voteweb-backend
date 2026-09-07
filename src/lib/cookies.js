/**
 * Cookie Utilities
 * CommonJS implementation based on voteweb-auth/src/cookies.js
 * Provides secure cookie handling for sessions and CSRF tokens
 */

const { randomBytes } = require('node:crypto');
const config = require('../config');

// Cookie names
const SESSION_COOKIE = 'cv_sid';
const CSRF_COOKIE = 'cv_csrf';

/**
 * Get cookie options based on type
 * @param {boolean} httpOnly - Whether cookie should be HttpOnly
 * @param {boolean} crossSite - Whether cookie needs to work cross-site (for CSRF cookies)
 * @returns {object} - Cookie options object
 */
function cookieOptions(httpOnly, crossSite = false) {
  const options = {
    httpOnly,
    path: '/',
    maxAge: httpOnly ? config.sessionTtlMs : 60 * 60 * 1000, // 1 hour for CSRF
  };

  // The frontend proxies every /api call through Next.js rewrites, so the
  // browser only ever talks to the frontend origin. That makes the CSRF and
  // session cookies first-party, and SameSite=Lax + Secure is the most
  // iOS/ITP-compatible configuration. Keep an opt-out env to allow
  // SameSite=None for a non-proxied deployment (COOKIE_SAMESITE=none).
  options.sameSite = config.cookieSameSite;
  options.secure = config.cookieSecure;

  return options;
}

/**
 * Generate a random CSRF token and set it as a cookie
 * @param {object} res - Express response object
 * @returns {string} - Base64url-encoded random token
 */
function mintCsrfToken(res) {
  const token = randomBytes(32).toString('base64url');
  // Set HttpOnly: false so JS can read it for the header
  // The cookie is first-party: the frontend proxies /api, so the browser sees
  // it as SameSite=Lax + Secure (see cookieOptions). COOKIE_SAMESITE=none
  // restores the old cross-site behavior if ever needed.
  res.cookie(CSRF_COOKIE, token, cookieOptions(false));
  return token;
}

/**
 * Set session cookie on response
 * @param {object} response - Express response object
 * @param {string} token - Session token
 */
function setSessionCookie(response, token) {
  response.cookie(SESSION_COOKIE, token, cookieOptions(true));
}

/**
 * Clear session cookie
 * @param {object} response - Express response object
 */
function clearSessionCookie(response) {
  response.clearCookie(SESSION_COOKIE, { ...cookieOptions(true), maxAge: undefined });
}

module.exports = {
  SESSION_COOKIE,
  CSRF_COOKIE,
  cookieOptions,
  mintCsrfToken,
  setSessionCookie,
  clearSessionCookie,
};
