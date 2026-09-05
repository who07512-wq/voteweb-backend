/**
 * Verify a Clerk session token (JWT) issued to a signed-in user.
 *
 * Used by the registration and forgot-password endpoints: the frontend
 * proves email ownership by completing a Clerk email-code challenge, then
 * sends the Clerk session token as a Bearer token. We verify the signature
 * against the instance JWKS and resolve the primary email server-side (via
 * the Clerk Backend API when CLERK_SECRET_KEY is configured).
 *
 * Throws an Error with .code and .status on failure.
 */

const { createRemoteJWKSet, jwtVerify } = require('jose');

// ---- JWKS clients cached per issuer ----
const jwksCache = new Map();
function getJwks(issuer) {
  let jwks = jwksCache.get(issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
    jwksCache.set(issuer, issuer && jwks);
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
  return primary && primary.verification && primary.verification.status === 'verified'
    ? primary.email_address.toLowerCase()
    : primary
      ? primary.email_address.toLowerCase()
      : null;
}

/**
 * Verify a Clerk session token and resolve the user's email.
 * @param {string} token - Bearer token from the frontend Clerk session
 * @param {string} [clientEmail] - email the client claims (used only as a
 *   fallback when CLERK_SECRET_KEY is not configured on the server)
 * @returns {Promise<{clerkUserId: string, email: string}>}
 */
async function verifyClerkSessionToken(token, clientEmail) {
  const issuer = process.env.CLERK_ISSUER;
  if (!issuer || !issuer.startsWith('https://')) {
    const err = new Error('Clerk sign-in bridge is not configured on the server.');
    err.code = 'CLERK_NOT_CONFIGURED';
    err.status = 500;
    throw err;
  }

  const hints = decodeJwtPayload(token) || {};
  const iss = hints.iss && String(hints.iss).startsWith('https://') ? hints.iss : issuer;
  if (iss.replace(/\/$/, '') !== issuer.replace(/\/$/, '')) {
    const err = new Error('Sign-in token does not match this platform.');
    err.code = 'CLERK_ISSUER_MISMATCH';
    err.status = 401;
    throw err;
  }
  const aud = typeof hints.aud === 'string' ? hints.aud : undefined;

  let payload;
  try {
    payload = await jwtVerify(token, getJwks(iss), { issuer: iss, audience: aud }).then((r) => r.payload);
  } catch {
    const err = new Error('Sign-in token is invalid or expired. Please sign in again.');
    err.code = 'INVALID_CLERK_TOKEN';
    err.status = 401;
    throw err;
  }

  const clerkUserId = payload.sub;
  if (!clerkUserId) {
    const err = new Error('Sign-in token is invalid.');
    err.code = 'INVALID_CLERK_TOKEN';
    err.status = 401;
    throw err;
  }

  const secretKey = process.env.CLERK_SECRET_KEY;
  const serverEmail = secretKey ? await fetchClerkPrimaryEmail(secretKey, clerkUserId) : null;
  const email = (serverEmail || String(clientEmail || '')).toLowerCase().trim();
  if (!email || !email.includes('@')) {
    const err = new Error('The verified account has no usable email address.');
    err.code = 'NO_EMAIL';
    err.status = 400;
    throw err;
  }

  return { clerkUserId, email };
}

module.exports = { verifyClerkSessionToken, fetchClerkPrimaryEmail };
