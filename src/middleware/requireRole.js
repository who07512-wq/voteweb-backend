/**
 * Role-based authorization middleware (RBAC)
 *
 * USAGE:
 *   router.get('/', requireAuth, requireRole('CAD'), handler)
 *   router.get('/', requireAuth, requireRole('ADMIN', 'CAD'), handler)
 *
 * Prebuilt guards:
 *   requireCad   -> CAD only
 *   requireStaff -> ADMIN or CAD (shared "election staff" area)
 *
 * Always returns 401 when unauthenticated and 403 when the role doesn't
 * qualify. The role is read from the server-side session (req.user), never
 * from the client.
 */
const { requireAuth } = require('./requireAuth');

function requireRole(...allowedRoles) {
  if (allowedRoles.length === 0) {
    throw new Error('requireRole() needs at least one role');
  }
  const allowed = allowedRoles.map((r) => String(r).toUpperCase());

  return (req, res, next) => {
    requireAuth(req, res, (err) => {
      if (err) return next(err);

      if (!req.user) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Authentication required.',
          code: 'AUTH_REQUIRED',
        });
      }

      const userRole = String(req.user.role || '').toUpperCase();
      if (!userRole) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Your account has no assigned role.',
          code: 'ROLE_REQUIRED',
        });
      }

      if (!allowed.includes(userRole)) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'You do not have permission to access this resource.',
          code: 'ROLE_FORBIDDEN',
        });
      }

      return next();
    });
  };
}

const requireCad = requireRole('CAD');
const requireStaff = requireRole('ADMIN', 'CAD');

module.exports = { requireRole, requireCad, requireStaff };
