/**
 * Admin Authorization Middleware
 *
 * SECURITY:
 * - This is an AUTHORIZATION boundary, NOT authentication
 * - Authentication is handled by loadSession middleware
 * - req.user must be populated by the authentication layer
 *
 * Production mode (NODE_ENV=production):
 *   - Development bypasses are COMPLETELY DISABLED
 *   - Real authentication must populate req.user
 *   - Session/JWT validation is mandatory
 *
 * Development mode:
 *   - Set ALLOW_DEV_ADMIN=true for development testing
 *   - DEV_MFA_BYPASS=true to skip MFA (admin login)
 *   - NEVER use these in production
 *
 * Usage in routes:
 *   const { requireAdmin } = require('./middleware/requireAdmin');
 *   router.post('/', requireAdmin, controller.create);
 */

const config = require('../config');

/**
 * Get development admin context
 *
 * WARNING: Returns null in production regardless of environment variables
 *
 * @returns {object|null} Dev admin context or null
 */
function getDevAdminContext() {
  // PRODUCTION SAFETY: Never allow dev bypass in production
  if (config.isProduction) {
    return null;
  }

  const allowDevAdmin = process.env.ALLOW_DEV_ADMIN === 'true';

  if (!allowDevAdmin) {
    return null;
  }

  console.warn('⚠️  [DEV MODE] Admin bypass is enabled - NOT PRODUCTION SAFE');

  const devAdminId = process.env.DEV_ADMIN_ID;

  if (devAdminId) {
    return {
      id: parseInt(devAdminId),
      role: 'ADMIN',
      isDevAdmin: true
    };
  }

  // Return a default dev admin context
  return {
    id: 0,
    role: 'ADMIN',
    isDevAdmin: true,
  };
}

/**
 * Require admin role middleware
 *
 * Priority:
 * 1. Development admin bypass (only if NODE_ENV !== 'production')
 * 2. req.user.role === 'ADMIN' (production)
 *
 * @param {object} req - Express request
 * @param {object} res - Express response
 * @param {function} next - Express next
 */
function requireAdmin(req, res, next) {
  // Development bypass (disabled in production)
  if (!config.isProduction) {
    const devAdmin = getDevAdminContext();
    if (devAdmin) {
      req.adminUser = devAdmin;
      return next();
    }
  }

  // Production path: req.user must be populated by authentication middleware
  if (!req.user) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required.',
      code: 'AUTH_REQUIRED'
    });
  }

  // Check admin role
  const userRole = req.user.role;
  if (!userRole || typeof userRole !== 'string') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Insufficient permissions. Admin role required.',
      code: 'ROLE_REQUIRED'
    });
  }

  // Case-insensitive role check
  if (userRole.toUpperCase() !== 'ADMIN') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Insufficient permissions. Admin role required.',
      code: 'ADMIN_REQUIRED'
    });
  }

  // Admin authenticated
  req.adminUser = {
    id: req.user.id,
    role: req.user.role,
    externalId: req.user.externalId
  };

  next();
}

module.exports = {
  requireAdmin,
  getDevAdminContext
};
