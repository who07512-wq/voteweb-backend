/**
 * Authentication Middleware
 * Requires valid authentication for protected routes
 */

/**
 * Require authentication middleware
 * Returns 401 if user is not authenticated
 */
function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required.',
      code: 'AUTH_REQUIRED',
    });
  }
  return next();
}

module.exports = {
  requireAuth,
};
