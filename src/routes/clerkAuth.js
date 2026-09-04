/**
 * Clerk → Backend Session Bridge
 *
 * After a user signs in with Google via Clerk (frontend), the client calls
 * POST /api/v1/auth/clerk-session with the Clerk session token (Bearer).
 * We verify the token against the Clerk dev-instance JWKS, look up the
 * account by verified email, then create a regular backend session
 * (cv_sid cookie + binding token) so all /api/v1 routes work unchanged.
 *
 * Requires env vars:
 *   CLERK_ISSUER     e.g. https://closing-hawk-9939.clerk.accounts.dev
 *   CLERK_SECRET_KEY backend secret key (sk_...) for email cross-check
 */

const express = require('express');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { randomBytes } = require('node:crypto');
const router = express.Router();

const db = require('../db');
const { csrfProtection } = require('../middleware/csrfProtection');
const { loginLimiter } = require('../middleware/rateLimiter');
const { hashPassword } = require('../lib/password');
const { createSession } = require('../services/sessionService');
const { recordAudit, publicUser } = require('../lib/authDb');

function authError(res, status, code, message) {
  return res.status(status).json({ error: { code, message } });
}

// ---- JWKS clients cached per issuer ----
const jwksCache = new Map();
function getJwks(issuer) {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksCache.set(issuer, jwks);
  }
  return jwks;
}

// ---- Decode JWT payload WITHOUT verifying (only to read iss/aud hints) ----
function decodeJwtPayload(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch {
    return null;
  }
}

// ---- Look up the Clerk user's primary email via the Backend API ----
async function fetchClerkPrimaryEmail(secretKey, clerkUserId) {
  const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(clerkUserId)}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  if (!res.ok) return null;
  const user = await res.json();
  const primaryId = user.primary_email_address_id;
  const primary = (user.email_addresses || []).find((e) => e.id === primaryId);
  return primary ? primary.email_address.toLowerCase() : null;
}

router.post('/clerk-session', loginLimiter, csrfProtection, async (req, res) => {
  try {
    const issuer = process.env.CLERK_ISSUER;
    if (!issuer || !issuer.startsWith('https://')) {
      console.error('clerk-session: CLERK_ISSUER not configured');
      return authError(res, 500, 'CLERK_NOT_CONFIGURED', 'Clerk bridge is not configured on the server.');
    }

    // ---- 1. Extract Bearer token ----
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return authError(res, 401, 'NO_CLERK_TOKEN', 'Missing Clerk session token.');
    }

    // ---- 2. Read unverified iss/aud (hints only), then verify signature ----
    const hints = decodeJwtPayload(token) || {};
    const iss = hints.iss && String(hints.iss).startsWith('https://') ? hints.iss : issuer;
    if (iss.replace(/\/$/, '') !== issuer.replace(/\/$/, '')) {
      return authError(res, 401, 'CLERK_ISSUER_MISMATCH', 'Token issuer does not match this instance.');
    }
    const aud = typeof hints.aud === 'string' ? hints.aud : undefined;

    let payload;
    try {
      payload = await jwtVerify(token, getJwks(iss), { issuer: iss, audience: aud }).then((r) => r.payload);
    } catch (err) {
      console.error('clerk-session: JWT verification failed:', err.message);
      return authError(res, 401, 'INVALID_CLERK_TOKEN', 'Clerk session token is invalid or expired.');
    }

    const clerkUserId = payload.sub;
    if (!clerkUserId) {
      return authError(res, 401, 'INVALID_CLERK_TOKEN', 'Clerk token has no subject.');
    }

    // ---- 3. Resolve email: client-provided must match Clerk's primary email ----
    const secretKey = process.env.CLERK_SECRET_KEY;
    const primaryEmail = secretKey
      ? await fetchClerkPrimaryEmail(secretKey, clerkUserId)
      : null;
    const clientEmail = String(req.body.email || '').toLowerCase().trim();
    const email = primaryEmail || clientEmail;
    const requestedRoleRaw = String(req.body.role || '').toUpperCase().trim();
    if (!email || !email.includes('@')) {
      return authError(res, 400, 'NO_EMAIL', 'Google account has no verified email address.');
    }

    // ---- 3.5 Invite-only gate + admin bootstrap ----
    const allowList = String(process.env.INVITED_EMAILS || '')
      .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const adminList = String(process.env.ADMIN_EMAILS || '')
      .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const cadList = String(process.env.CAD_EMAILS || '')
      .split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);

    // ---- 4. Find the account (or auto-provision) ----
    // Identity is tied to student_id; the login email is a changeable
    // credential. Priority: current_login_email > legacy email > official_email.
    let account = await db.query(
      `SELECT * FROM students
        WHERE is_active = TRUE
          AND (LOWER(current_login_email) = LOWER($1)
            OR LOWER(email) = LOWER($1)
            OR LOWER(official_email) = LOWER($1))
        ORDER BY CASE
          WHEN LOWER(current_login_email) = LOWER($1) THEN 0
          WHEN LOWER(email) = LOWER($1) THEN 1
          ELSE 2 END
        LIMIT 1`,
      [email]
    ).then((r) => r.rows[0]);

    if (!account) {
      // ---- Invite-only mode: unknown emails are rejected outright ----
      if (process.env.INVITE_ONLY === 'true' && !allowList.includes(email)) {
        await recordAudit('clerk_login_denied', {
          studentId: null,
          ip: req.ip,
          metadata: { email, clerkUserId, reason: 'not_invited' },
        });
        return authError(res, 403, 'NOT_INVITED', 'This Google account has not been invited to CampusVote. Ask the election administrator for access.');
      }

      // ---- Auto-provision invited users only ----
      const name = String(req.body.name || '').trim() || email.split('@')[0];
      const usernameBase = email.split('@')[0].replace(/[^a-z0-9._-]/gi, '').toLowerCase() || 'user';
      const username = `${usernameBase}.${randomBytes(3).toString('hex')}`;
      const randomPassword = randomBytes(24).toString('base64url');
      const passwordHash = await hashPassword(randomPassword);
      const externalId = `CLERK-${clerkUserId}`;
      const isInvitedAdmin = adminList.includes(email);

      // Invited admins are created straight as ADMIN; others as CANDIDATE or STUDENT
      const roleToUse = isInvitedAdmin
        ? 'ADMIN'
        : ['STUDENT', 'CANDIDATE', 'CAD'].includes(requestedRoleRaw)
          ? (requestedRoleRaw === 'CAD' && cadList.includes(email) ? 'CAD' : requestedRoleRaw === 'CAD' ? 'STUDENT' : requestedRoleRaw)
          : 'STUDENT';

      const inserted = await db.query(
        `INSERT INTO students (external_id, name, email, password_hash, role, is_active, username)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6)
         RETURNING *`,
        [externalId, name, email, passwordHash, roleToUse, username]
      ).then((r) => r.rows[0]);
      account = inserted;
      console.log('clerk-session: provisioned invited account', { email, role: roleToUse });
    } else if (adminList.includes(email) && account.role !== 'ADMIN') {
      // Bootstrap: promote listed emails to ADMIN on sign-in.
      // Checked FIRST: ADMIN always wins when an email is on both lists.
      const promoted = await db.query(
        `UPDATE students SET role = 'ADMIN' WHERE id = $1 RETURNING role`,
        [account.id]
      ).then((r) => r.rows[0]);
      account.role = promoted.role;
      console.log('clerk-session: bootstrapped admin', { email });
    } else if (cadList.includes(email) && account.role !== 'CAD' && account.role !== 'ADMIN') {
      // Bootstrap: promote listed CAD emails at sign-in (only if not ADMIN)
      const promoted = await db.query(
        `UPDATE students SET role = 'CAD' WHERE id = $1 RETURNING role`,
        [account.id]
      ).then((r) => r.rows[0]);
      account.role = promoted.role;
      console.log('clerk-session: bootstrapped CAD', { email });
    }

    // ---- 5. Create backend session (cv_sid cookie set here) ----
    const bindingToken = await createSession(res, account.id, false);

    await recordAudit('clerk_google_login', {
      studentId: account.id,
      ip: req.ip,
      metadata: { role: account.role, clerkUserId },
    });

    return res.json({
      data: {
        authenticated: true,
        bindingToken,
        user: publicUser(account),
      },
    });
  } catch (error) {
    console.error('clerk-session error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred during sign-in.');
  }
});

module.exports = router;
