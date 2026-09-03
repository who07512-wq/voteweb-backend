// js
/**
 * Configuration
 * VoteWeb Backend Configuration
 */
 
const path = require('path');
 
// Load dotenv - allow override from environment
require('dotenv').config({ path: path.join(__dirname, '../../.env'), override: false });
 
const config = {
  // Environment
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 3000,
  isProduction: process.env.NODE_ENV === 'production',
  isDevelopment: process.env.NODE_ENV !== 'production',
 
  // Security - Session
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-session-secret-change-in-prod',
  sessionTtlHours: parseInt(process.env.SESSION_TTL_HOURS, 10) || 8,
  sessionTtlMs: (parseInt(process.env.SESSION_TTL_HOURS, 10) || 8) * 60 * 60 * 1000,
 
  // Security - TOTP/MFA
  totpEncryptionKey: process.env.TOTP_ENCRYPTION_KEY || null,
 
  // Security - Cookies
  cookieSecure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
  // SameSite attribute for cookies. Cross-site deployments (frontend and backend on
  // different sites, e.g. separate subdomains of a public-suffix domain like
  // *.onrender.com) require 'none' so the browser stores the cookies.
  cookieSameSite: process.env.COOKIE_SAMESITE || 'lax',
 
  // Security - Rate Limiting
  maxLoginAttempts: 5,
  lockoutDurationMinutes: 15,
  lockoutMs: 15 * 60 * 1000,
  mfaChallengeMs: 5 * 60 * 1000, // 5 minutes
 
  // Security - CORS
  corsOrigin: process.env.CORS_ORIGIN || null,
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3001',
 
  // Database SSL
  dbSsl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined,
};
 
// Validate critical security settings in production
if (config.isProduction) {
  if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
    console.warn('WARNING: SESSION_SECRET should be at least 32 characters in production');
  }
 
  if (!process.env.TOTP_ENCRYPTION_KEY) {
    console.warn('WARNING: TOTP_ENCRYPTION_KEY is not set - MFA will not work');
  }
}
 
module.exports = config;
