/**
 * Authentication Routes
 * Handles login, logout, MFA, OTP, and password management
 * Supports role-aware authentication for STUDENT, CANDIDATE, and ADMIN
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { loadSession } = require('../middleware/loadSession');
const { requireAuth } = require('../middleware/requireAuth');
const { csrfProtection } = require('../middleware/csrfProtection');
const { loginLimiter, mfaLimiter, registerLimiter, otpLimiter, passwordResetLimiter } = require('../middleware/rateLimiter');
const { hashPassword, verifyPassword, validatePasswordPolicy } = require('../lib/password');
const { verifyTotp, generateTotpSecret, provisioningUri } = require('../lib/totp');
const { encryptSecret, decryptSecret, hashToken } = require('../lib/crypto');
const { mintCsrfToken, CSRF_COOKIE } = require('../lib/cookies');
const { createSession, revokeSession, rotateSession } = require('../services/sessionService');
const { createMfaChallenge, findChallenge, deleteChallenge, incrementChallengeAttempts } = require('../services/mfaService');
const { createOtpChallenge, findValidChallenge, verifyOtpChallenge, checkRateLimit, RESEND_COOLDOWN_MS } = require('../services/otpService');
const { sendLoginOtp, sendPasswordResetOtp } = require('../services/brevoService');
const { recordAudit, findStudentByIdentifierOrEmail, publicUser, isLocked } = require('../lib/authDb');

// Helper for consistent error responses
function authError(res, status, code, message) {
  return res.status(status).json({
    error: { code, message },
  });
}

// =====================================================
// CSRF TOKEN
// =====================================================
router.get('/csrf', (req, res) => {
  const csrfToken = mintCsrfToken(res);
  return res.json({
    data: { csrfToken },
  });
});

// =====================================================
// DEBUG: Check Brevo email status
// =====================================================
router.get('/debug/brevo-status', (req, res) => {
  const apiKey = process.env.BREVO_API_KEY;
  res.json({
    configured: !!apiKey,
    apiKeyPrefix: apiKey ? apiKey.substring(0, 8) + '...' : null,
    senderEmail: process.env.BREVO_SENDER_EMAIL,
    senderName: process.env.BREVO_SENDER_NAME,
    nodeEnv: process.env.NODE_ENV,
  });
});

// =====================================================
// CURRENT USER
// =====================================================
router.get('/me', loadSession, (req, res) => {
  if (!req.user || !req.user.studentId) {
    return res.json({ data: { authenticated: false } });
  }
  return res.json({
    data: {
      authenticated: true,
      user: req.user,
    },
  });
});

// =====================================================
// LOGIN - Role-aware authentication
// =====================================================
router.post('/login', loginLimiter, csrfProtection, async (req, res) => {
  try {
    const { userIdentifier, password, role } = req.body;

    // Validate input
    if (!userIdentifier || typeof userIdentifier !== 'string' || userIdentifier.trim().length < 3) {
      return authError(res, 400, 'INVALID_INPUT', 'Username or email is required (min 3 characters).');
    }

    if (!password || typeof password !== 'string' || password.length < 1) {
      return authError(res, 400, 'INVALID_INPUT', 'Password is required.');
    }

    // Validate role
    const validRoles = ['STUDENT', 'CANDIDATE', 'ADMIN'];
    const requestedRole = (role || 'STUDENT').toUpperCase();
    if (!validRoles.includes(requestedRole)) {
      return authError(res, 400, 'INVALID_ROLE', 'Invalid login role.');
    }

    // Find account by identifier
    const account = await findStudentByIdentifierOrEmail(userIdentifier.trim());

    // Check if account exists
    if (!account) {
      await recordAudit('login_failed', {
        ip: req.ip,
        metadata: { identifier: userIdentifier, role: requestedRole, reason: 'account_not_found' },
      });
      return authError(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }

    // ENFORCE ROLE SEPARATION - Critical security check
    if (account.role !== requestedRole) {
      await recordAudit('login_failed', {
        studentId: account.id,
        ip: req.ip,
        metadata: { identifier: userIdentifier, requestedRole, actualRole: account.role, reason: 'role_mismatch' },
      });
      // Use generic message to prevent account enumeration
      return authError(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }

    // Check if account is locked
    if (isLocked(account)) {
      await recordAudit('login_locked', {
        studentId: account.id,
        ip: req.ip,
        metadata: { identifier: userIdentifier },
      });
      return authError(res, 423, 'ACCOUNT_LOCKED', 'This account is temporarily locked. Please try again later.');
    }

    // Verify password
    const valid = await verifyPassword(password, account.password_hash);
    if (!valid) {
      // Increment failed attempts
      await db.query(
        'UPDATE students SET failed_login_attempts = failed_login_attempts + 1 WHERE id = $1',
        [account.id]
      );

      await recordAudit('login_failed', {
        studentId: account.id,
        ip: req.ip,
        metadata: { identifier: userIdentifier, reason: 'invalid_password' },
      });

      return authError(res, 401, 'INVALID_CREDENTIALS', 'Invalid username or password.');
    }

    // Reset failed attempts on successful password verification
    await db.query(
      'UPDATE students SET failed_login_attempts = 0, last_login_at = NOW() WHERE id = $1',
      [account.id]
    );

    // ADMIN accounts require MFA
    if (account.role === 'ADMIN') {
      // Check for MFA bypass in development
      if (process.env.ALLOW_DEV_ADMIN === 'true' && process.env.NODE_ENV !== 'production') {
        const bindingToken = await createSession(res, account.id, true);
        await recordAudit('login_completed', {
          studentId: account.id,
          ip: req.ip,
          metadata: { method: 'mfa_bypass' },
        });
        return res.json({
          data: {
            authenticated: true,
            requiresPasswordChange: account.password_change_required,
            bindingToken,
            user: publicUser(account),
          },
        });
      }

      const requiresMfaSetup = !account.mfa_enabled;

      // Create MFA challenge
      const challenge = await createMfaChallenge(account.id, requiresMfaSetup);

      return res.json({
        data: {
          authenticated: false,
          mfaRequired: true,
          requiresMfaSetup,
          mfaChallenge: challenge.challenge,
          enrollmentToken: challenge.enrollmentToken || undefined,
        },
      });
    }

    // STUDENT and CANDIDATE get session directly
    const bindingToken = await createSession(res, account.id, false);

    await recordAudit('login_completed', {
      studentId: account.id,
      ip: req.ip,
    });

    return res.json({
      data: {
        authenticated: true,
        requiresPasswordChange: account.password_change_required,
        bindingToken,
        user: publicUser(account),
      },
    });
  } catch (error) {
    console.error('Login error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred during login.');
  }
});

// =====================================================
// OTP: Send Login OTP
// =====================================================
router.post('/otp/send-login', otpLimiter, csrfProtection, async (req, res) => {
  try {
    const { email, role } = req.body;

    // Validate input
    if (!email || typeof email !== 'string') {
      return authError(res, 400, 'INVALID_INPUT', 'Email is required.');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.toLowerCase())) {
      return authError(res, 400, 'INVALID_EMAIL', 'Please enter a valid email address.');
    }

    // Validate role - only STUDENT and CANDIDATE can use OTP login
    const validRoles = ['STUDENT', 'CANDIDATE'];
    const requestedRole = (role || 'STUDENT').toUpperCase();
    if (!validRoles.includes(requestedRole)) {
      return authError(res, 400, 'INVALID_ROLE', 'OTP login is not available for this role.');
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(email.toLowerCase(), 'LOGIN_OTP');
    if (!rateCheck.allowed) {
      return authError(res, 429, 'RATE_LIMITED',
        `Too many OTP requests. Please try again in ${Math.ceil(rateCheck.retryAfterMs / 1000)} seconds.`);
    }

    // Find account by email
    const account = await db.query(
      'SELECT * FROM students WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase()]
    ).then(r => r.rows[0]);

    if (account) {
      // Account exists - check role matches
      if (account.role !== requestedRole) {
        // Role mismatch - use generic response to prevent enumeration
        // Still send OTP to prevent account enumeration, but it won't work for wrong role
        // Actually, don't send OTP - just return success to prevent enumeration
        return res.json({
          data: {
            message: 'If an account matches the information provided, a verification code has been sent.',
          },
        });
      }

      // Valid account - create OTP
      const { id: challengeId, otp, expiresAt } = await createOtpChallenge(
        email.toLowerCase(),
        'LOGIN_OTP',
        requestedRole,
        req.ip
      );

      // Send email
      try {
        await sendLoginOtp(email.toLowerCase(), otp);
      } catch (emailError) {
        console.error('Failed to send OTP email:', emailError.message);
        return authError(res, 500, 'EMAIL_FAILED', 'Failed to send verification code. Please try again.');
      }

      await recordAudit('otp_sent', {
        studentId: account.id,
        ip: req.ip,
        metadata: { purpose: 'LOGIN_OTP', role: requestedRole },
      });

      return res.json({
        data: {
          message: 'Verification code sent.',
          challengeId,
          expiresIn: 300, // 5 minutes in seconds
        },
      });
    } else {
      // No account exists - create OTP challenge anyway for account enumeration protection
      const { id: challengeId, otp, expiresAt } = await createOtpChallenge(
        email.toLowerCase(),
        'LOGIN_OTP',
        requestedRole,
        req.ip
      );

      // Send email (will fail for non-existent email, but that's expected)
      try {
        await sendLoginOtp(email.toLowerCase(), otp);
      } catch (emailError) {
        // Non-existent email - this is expected, don't show error
      }

      // Return same response as if account existed (account enumeration protection)
      return res.json({
        data: {
          message: 'If an account matches the information provided, a verification code has been sent.',
        },
      });
    }
  } catch (error) {
    // Handle RESEND_COOLDOWN error from createOtpChallenge
    if (error.message && error.message.startsWith('RESEND_COOLDOWN:')) {
      const seconds = error.message.split(':')[1];
      return authError(res, 429, 'RESEND_COOLDOWN',
        `Please wait ${seconds} seconds before requesting a new code.`);
    }
    // Log full error details for debugging (server-side only)
    console.error('OTP send error details:', {
      message: error.message,
      code: error.code,
      stack: error.stack,
      name: error.name,
    });
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred.');
  }
});

// =====================================================
// OTP: Verify Login OTP
// =====================================================
router.post('/otp/verify-login', otpLimiter, csrfProtection, async (req, res) => {
  try {
    const { email, otp, role } = req.body;

    if (!email || !otp) {
      return authError(res, 400, 'INVALID_INPUT', 'Verification code is required.');
    }

    // Validate role
    const validRoles = ['STUDENT', 'CANDIDATE'];
    const requestedRole = (role || 'STUDENT').toUpperCase();
    if (!validRoles.includes(requestedRole)) {
      return authError(res, 400, 'INVALID_ROLE', 'Invalid role.');
    }

    // First check if account exists
    const accountData = await db.query(
      'SELECT * FROM students WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase()]
    ).then(r => r.rows[0]);

    if (!accountData) {
      // No account found - verify OTP is valid, then return needsRegistration
      // Use findValidChallenge to NOT mark OTP as used yet
      const { findValidChallenge, verifyOtp } = require('../services/otpService');
      const challenge = await findValidChallenge(email.toLowerCase(), 'LOGIN_OTP', requestedRole);

      if (!challenge) {
        return authError(res, 400, 'OTP_EXPIRED', 'Verification code has expired. Please request a new one.');
      }

      // Check attempt limit
      if (challenge.attempts >= 5) {
        await db.query('UPDATE otp_challenges SET used = TRUE WHERE id = $1', [challenge.id]);
        return authError(res, 400, 'MAX_ATTEMPTS', 'Too many attempts. Please request a new code.');
      }

      // Increment attempts but DON'T mark as used yet
      await db.query('UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1', [challenge.id]);

      // Verify OTP (but don't mark as used)
      if (!verifyOtp(otp, challenge.otp_hash)) {
        return authError(res, 400, 'INVALID_OTP', 'Invalid verification code.');
      }

      // Return needsRegistration so frontend can show registration form
      return res.json({
        data: {
          needsRegistration: true,
          email: email.toLowerCase(),
          role: requestedRole,
          message: 'No account found with this email. Please complete your registration.',
        },
      });
    }

    // Account exists - now verify OTP and mark as used
    const result = await verifyOtpChallenge(email.toLowerCase(), 'LOGIN_OTP', otp, requestedRole);

    if (!result.success) {
      if (result.error === 'EXPIRED') {
        return authError(res, 400, 'OTP_EXPIRED', 'Verification code has expired. Please request a new one.');
      }
      if (result.error === 'MAX_ATTEMPTS') {
        return authError(res, 400, 'MAX_ATTEMPTS', 'Too many attempts. Please request a new code.');
      }
      if (result.error === 'INVALID_OTP') {
        return authError(res, 400, 'INVALID_OTP', 'Invalid verification code.');
      }
      if (result.error === 'ALREADY_USED') {
        return authError(res, 400, 'OTP_USED', 'This code has already been used.');
      }
      return authError(res, 400, 'INVALID_OTP', 'Invalid verification code.');
    }

    // Verify role matches (belt and suspenders check)
    if (accountData.role !== requestedRole) {
      return authError(res, 403, 'ROLE_MISMATCH', 'This account does not match the selected role.');
    }

    // Create session
    const bindingToken = await createSession(res, accountData.id, false);

    await recordAudit('otp_login_completed', {
      studentId: accountData.id,
      ip: req.ip,
      metadata: { role: requestedRole },
    });

    return res.json({
      data: {
        authenticated: true,
        requiresPasswordChange: accountData.password_change_required,
        bindingToken,
        user: publicUser(accountData),
      },
    });
  } catch (error) {
    // Handle RESEND_COOLDOWN error
    if (error.message && error.message.startsWith('RESEND_COOLDOWN:')) {
      const seconds = error.message.split(':')[1];
      return authError(res, 429, 'RESEND_COOLDOWN',
        `Please wait ${seconds} seconds before requesting a new code.`);
    }
    console.error('OTP verify error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred.');
  }
});

// =====================================================
// OTP: Check if email has existing account
// =====================================================
router.post('/otp/check-email', otpLimiter, csrfProtection, async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email || typeof email !== 'string') {
      return authError(res, 400, 'INVALID_INPUT', 'Email is required.');
    }

    // Validate role
    const validRoles = ['STUDENT', 'CANDIDATE'];
    const requestedRole = (role || 'STUDENT').toUpperCase();
    if (!validRoles.includes(requestedRole)) {
      return authError(res, 400, 'INVALID_ROLE', 'Invalid role.');
    }

    // Check if account exists
    const account = await db.query(
      'SELECT id, role FROM students WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase()]
    ).then(r => r.rows[0]);

    if (account) {
      // Account exists
      if (account.role !== requestedRole) {
        // Role mismatch - don't reveal which role the email belongs to
        return res.json({
          data: {
            emailExists: false,
            message: 'Please check your email for the verification code.',
          },
        });
      }
      return res.json({
        data: {
          emailExists: true,
          canLogin: true,
        },
      });
    }

    // No account - user needs to register
    return res.json({
      data: {
        emailExists: false,
        canLogin: false,
        needsRegistration: true,
      },
    });
  } catch (error) {
    console.error('Email check error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred.');
  }
});

// =====================================================
// OTP: Send Password Reset OTP
// =====================================================
router.post('/otp/send-reset', passwordResetLimiter, csrfProtection, async (req, res) => {
  try {
    const { email, role } = req.body;

    if (!email || typeof email !== 'string') {
      return authError(res, 400, 'INVALID_INPUT', 'Email is required.');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.toLowerCase())) {
      return authError(res, 400, 'INVALID_EMAIL', 'Please enter a valid email address.');
    }

    // Validate role - only STUDENT and CANDIDATE can reset password via OTP
    const validRoles = ['STUDENT', 'CANDIDATE'];
    const requestedRole = (role || 'STUDENT').toUpperCase();
    if (!validRoles.includes(requestedRole)) {
      return authError(res, 400, 'INVALID_ROLE', 'Password reset is not available for this role.');
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(email.toLowerCase(), 'PASSWORD_RESET');
    if (!rateCheck.allowed) {
      return authError(res, 429, 'RATE_LIMITED',
        `Too many reset requests. Please try again in ${Math.ceil(rateCheck.retryAfterMs / 1000)} seconds.`);
    }

    // Find account by email
    const account = await db.query(
      'SELECT * FROM students WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase()]
    ).then(r => r.rows[0]);

    if (account) {
      // Verify role matches
      if (account.role !== requestedRole) {
        // Generic response for role mismatch
        return res.json({
          data: {
            message: 'If an account matches the information provided, a reset code has been sent.',
          },
        });
      }

      // Create OTP
      const { id: challengeId, otp, expiresAt } = await createOtpChallenge(
        email.toLowerCase(),
        'PASSWORD_RESET',
        null, // No specific role for password reset
        req.ip
      );

      // Send email
      try {
        await sendPasswordResetOtp(email.toLowerCase(), otp);
      } catch (emailError) {
        console.error('Failed to send reset email:', emailError.message);
        return authError(res, 500, 'EMAIL_FAILED', 'Failed to send reset code. Please try again.');
      }

      await recordAudit('password_reset_requested', {
        studentId: account.id,
        ip: req.ip,
      });

      return res.json({
        data: {
          message: 'Reset code sent.',
          challengeId,
          expiresIn: 300,
        },
      });
    }

    // No account - generic response
    return res.json({
      data: {
        message: 'If an account matches the information provided, a reset code has been sent.',
      },
    });
  } catch (error) {
    // Handle RESEND_COOLDOWN error
    if (error.message && error.message.startsWith('RESEND_COOLDOWN:')) {
      const seconds = error.message.split(':')[1];
      return authError(res, 429, 'RESEND_COOLDOWN',
        `Please wait ${seconds} seconds before requesting a new code.`);
    }
    console.error('Password reset request error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred.');
  }
});

// =====================================================
// OTP: Verify Password Reset
// =====================================================
router.post('/otp/verify-reset', passwordResetLimiter, csrfProtection, async (req, res) => {
  try {
    const { email, otp, role } = req.body;

    if (!email || !otp) {
      return authError(res, 400, 'INVALID_INPUT', 'Reset code is required.');
    }

    // Validate role
    const validRoles = ['STUDENT', 'CANDIDATE'];
    const requestedRole = (role || 'STUDENT').toUpperCase();
    if (!validRoles.includes(requestedRole)) {
      return authError(res, 400, 'INVALID_ROLE', 'Invalid role.');
    }

    // Find and verify the challenge
    const result = await verifyOtpChallenge(challengeId, otp, 'PASSWORD_RESET', requestedRole);

    if (result.error) {
      if (result.error === 'EXPIRED') {
        return authError(res, 400, 'OTP_EXPIRED', 'Reset code has expired. Please request a new one.');
      }
      if (result.error === 'MAX_ATTEMPTS') {
        return authError(res, 400, 'MAX_ATTEMPTS', 'Too many attempts. Please request a new code.');
      }
      if (result.error === 'INVALID') {
        return authError(res, 400, 'INVALID_OTP', 'Invalid reset code.');
      }
      if (result.error === 'ALREADY_USED') {
        return authError(res, 400, 'OTP_USED', 'This code has already been used.');
      }
      return authError(res, 400, 'INVALID_OTP', 'Invalid reset code.');
    }

    const { studentId } = result;

    // Get the account to verify role
    const account = await db.query(
      'SELECT id, role FROM students WHERE id = $1 AND is_active = TRUE',
      [studentId]
    ).then(r => r.rows[0]);

    if (!account) {
      return authError(res, 400, 'ACCOUNT_NOT_FOUND', 'Account not found.');
    }

    // Verify role matches
    if (account.role !== requestedRole) {
      return authError(res, 400, 'INVALID_REQUEST', 'Reset code does not match the selected role.');
    }

    // Generate a temporary reset token
    const resetToken = require('node:crypto').randomBytes(32).toString('base64url');

    // Store the reset token (simplified - in production, store in DB with expiration)
    // For now, we return success and the frontend uses the challengeId to complete reset

    await recordAudit('password_reset_verified', {
      studentId,
      ip: req.ip,
    });

    return res.json({
      data: {
        verified: true,
        resetChallengeId: challengeId,
        expiresIn: 300,
      },
    });
  } catch (error) {
    console.error('Password reset verify error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred.');
  }
});

// =====================================================
// Password Reset: Complete
// =====================================================
router.post('/reset-password', passwordResetLimiter, csrfProtection, async (req, res) => {
  try {
    const { challengeId, newPassword, confirmPassword, role } = req.body;

    if (!challengeId) {
      return authError(res, 400, 'INVALID_INPUT', 'Invalid reset request.');
    }

    if (!newPassword || !confirmPassword) {
      return authError(res, 400, 'INVALID_INPUT', 'Both passwords are required.');
    }

    if (newPassword !== confirmPassword) {
      return authError(res, 400, 'PASSWORD_MISMATCH', 'Passwords do not match.');
    }

    // Validate role
    const validRoles = ['STUDENT', 'CANDIDATE'];
    const requestedRole = (role || 'STUDENT').toUpperCase();
    if (!validRoles.includes(requestedRole)) {
      return authError(res, 400, 'INVALID_ROLE', 'Invalid role.');
    }

    // Find the challenge
    const challenge = await db.query(
      `SELECT c.*, s.id as student_id, s.role, s.password_hash
       FROM otp_challenges c
       JOIN students s ON s.id = c.student_id
       WHERE c.id = $1 AND c.purpose = 'PASSWORD_RESET' AND c.used = FALSE AND c.expires_at > NOW()`,
      [challengeId]
    ).then(r => r.rows[0]);

    if (!challenge) {
      return authError(res, 400, 'INVALID_CHALLENGE', 'Reset request not found or expired.');
    }

    // Verify role
    if (challenge.role !== requestedRole) {
      return authError(res, 400, 'INVALID_ROLE', 'Reset request does not match selected role.');
    }

    // Validate password policy
    const passwordError = validatePasswordPolicy(newPassword);
    if (passwordError) {
      return authError(res, 400, 'WEAK_PASSWORD', passwordError);
    }

    // Hash new password
    const passwordHash = await hashPassword(newPassword);

    // Update password and mark challenge as used
    await db.query('BEGIN');
    try {
      await db.query(
        'UPDATE students SET password_hash = $1, failed_login_attempts = 0 WHERE id = $2',
        [passwordHash, challenge.student_id]
      );
      await db.query(
        'UPDATE otp_challenges SET used = TRUE, consumed_at = NOW() WHERE id = $1',
        [challengeId]
      );
      await db.query('COMMIT');
    } catch (err) {
      await db.query('ROLLBACK');
      throw err;
    }

    // Revoke all existing sessions for this user
    await db.query(
      'UPDATE sessions SET revoked_at = NOW() WHERE student_id = $1 AND revoked_at IS NULL',
      [challenge.student_id]
    );

    await recordAudit('password_reset_completed', {
      studentId: challenge.student_id,
      ip: req.ip,
    });

    return res.json({
      data: {
        message: 'Password has been reset. Please sign in with your new password.',
      },
    });
  } catch (error) {
    console.error('Password reset error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred.');
  }
});

// =====================================================
// OTP: Register New Account
// =====================================================
router.post('/register/otp', registerLimiter, csrfProtection, async (req, res) => {
  try {
    const { email, username, password, confirmPassword, role } = req.body;

    // Validate input
    if (!email || typeof email !== 'string') {
      return authError(res, 400, 'INVALID_INPUT', 'Email is required.');
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.toLowerCase())) {
      return authError(res, 400, 'INVALID_EMAIL', 'Please enter a valid email address.');
    }

    if (!username || typeof username !== 'string' || username.trim().length < 3) {
      return authError(res, 400, 'INVALID_USERNAME', 'Username must be at least 3 characters.');
    }

    if (!password || !confirmPassword) {
      return authError(res, 400, 'INVALID_INPUT', 'Both passwords are required.');
    }

    if (password !== confirmPassword) {
      return authError(res, 400, 'PASSWORD_MISMATCH', 'Passwords do not match.');
    }

    // Validate role - only STUDENT and CANDIDATE can register via OTP
    const validRoles = ['STUDENT', 'CANDIDATE'];
    const requestedRole = (role || 'STUDENT').toUpperCase();
    if (!validRoles.includes(requestedRole)) {
      return authError(res, 400, 'INVALID_ROLE', 'Registration is not available for this role.');
    }

    // Check rate limit
    const rateCheck = await checkRateLimit(email.toLowerCase(), 'LOGIN_OTP');
    if (!rateCheck.allowed) {
      return authError(res, 429, 'RATE_LIMITED',
        `Too many registration attempts. Please try again in ${Math.ceil(rateCheck.retryAfterMs / 1000)} seconds.`);
    }

    // Check if email already exists
    const existingEmail = await db.query(
      'SELECT id, role FROM students WHERE email = $1 AND is_active = TRUE',
      [email.toLowerCase()]
    ).then(r => r.rows[0]);

    if (existingEmail) {
      if (existingEmail.role === requestedRole) {
        return authError(res, 400, 'EMAIL_EXISTS', 'An account with this email already exists.');
      }
      // Different role - generic response
      return authError(res, 400, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }

    // Check if username already exists
    const existingUsername = await db.query(
      'SELECT id FROM students WHERE external_id = $1',
      [username.trim()]
    ).then(r => r.rows[0]);

    if (existingUsername) {
      return authError(res, 400, 'USERNAME_EXISTS', 'This username is already taken.');
    }

    // Validate password policy
    const passwordError = validatePasswordPolicy(password);
    if (passwordError) {
      return authError(res, 400, 'WEAK_PASSWORD', passwordError);
    }

    // Create OTP challenge with registration data
    const { id: challengeId, otp, expiresAt } = await createOtpChallenge(
      email.toLowerCase(),
      'LOGIN_OTP',
      requestedRole,
      req.ip
    );

    // DEV MODE: Log OTP to console as fallback
    console.log('\n========================================');
    console.log('DEV MODE - OTP for registration:');
    console.log('Email:', email);
    console.log('OTP:', otp);
    console.log('========================================\n');

    // Store registration data in a separate table or use the challenge
    // For simplicity, we'll store registration data in otp_challenges metadata
    // In production, use a separate registration_challenges table
    await db.query(
      `UPDATE otp_challenges SET rate_key = $1 WHERE id = $2`,
      [JSON.stringify({ username: username.trim(), passwordHash: await hashPassword(password), role: requestedRole }), challengeId]
    );

    // Send email
    try {
      await sendLoginOtp(email.toLowerCase(), otp);
    } catch (emailError) {
      console.error('Failed to send OTP email:', emailError.message);
      return authError(res, 500, 'EMAIL_FAILED', 'Failed to send verification code. Please try again.');
    }

    return res.json({
      data: {
        message: 'Verification code sent.',
        challengeId,
        expiresIn: 300,
        needsVerification: true,
      },
    });
  } catch (error) {
    // Handle RESEND_COOLDOWN error
    if (error.message && error.message.startsWith('RESEND_COOLDOWN:')) {
      const seconds = error.message.split(':')[1];
      return authError(res, 429, 'RESEND_COOLDOWN',
        `Please wait ${seconds} seconds before requesting a new code.`);
    }
    console.error('Registration OTP error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred.');
  }
});

// =====================================================
// OTP: Complete Registration
// =====================================================
router.post('/register/verify', otpLimiter, csrfProtection, async (req, res) => {
  try {
    const { email, otp, username, fullName, mobileNumber, enrollmentNumber, password, role } = req.body;

    if (!email || !otp || !username || !password) {
      return authError(res, 400, 'INVALID_INPUT', 'All fields are required.');
    }

    // Validate role
    const validRoles = ['STUDENT', 'CANDIDATE'];
    const requestedRole = (role || 'STUDENT').toUpperCase();
    if (!validRoles.includes(requestedRole)) {
      return authError(res, 400, 'INVALID_ROLE', 'Invalid role.');
    }

    // Check if email already exists (one email = one account)
    const existingEmail = await db.query(
      'SELECT id FROM students WHERE email = $1',
      [email.toLowerCase()]
    ).then(r => r.rows[0]);

    if (existingEmail) {
      return authError(res, 400, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }

    // Check if username already exists
    const existingUsername = await db.query(
      'SELECT id FROM students WHERE username = $1',
      [username.trim().toLowerCase()]
    ).then(r => r.rows[0]);

    if (existingUsername) {
      return authError(res, 400, 'USERNAME_EXISTS', 'This username is already taken.');
    }

    // Validate mobile number if provided
    let formattedMobile = null;
    if (mobileNumber) {
      const mobileDigits = mobileNumber.replace(/\D/g, '');
      if (mobileDigits.length !== 10) {
        return authError(res, 400, 'INVALID_MOBILE', 'Mobile number must be 10 digits.');
      }
      formattedMobile = '+91' + mobileDigits;
    }

    // Find and verify the challenge
    const challenge = await db.query(
      `SELECT * FROM otp_challenges
       WHERE email = $1 AND purpose = 'LOGIN_OTP' AND used = FALSE AND expires_at > NOW()
         AND target_role = $2
       ORDER BY created_at DESC LIMIT 1`,
      [email.toLowerCase(), requestedRole]
    ).then(r => r.rows[0]);

    if (!challenge) {
      return authError(res, 400, 'INVALID_CHALLENGE', 'Verification code not found or expired.');
    }

    // Verify OTP
    const { verifyOtp: verify } = require('../services/otpService');
    const otpValid = verify(otp, challenge.otp_hash);

    if (!otpValid) {
      // Increment attempts
      await db.query(
        'UPDATE otp_challenges SET attempts = attempts + 1 WHERE id = $1',
        [challenge.id]
      );

      // Check if max attempts reached
      if (challenge.attempts + 1 >= 5) {
        await db.query('UPDATE otp_challenges SET used = TRUE WHERE id = $1', [challenge.id]);
        return authError(res, 400, 'MAX_ATTEMPTS', 'Too many attempts. Please request a new code.');
      }

      return authError(res, 400, 'INVALID_OTP', 'Invalid verification code.');
    }

    // Get username and password from request body
    if (!username || !password) {
      return authError(res, 400, 'INVALID_INPUT', 'Username and password are required.');
    }

    // Verify role matches
    if (challenge.target_role !== requestedRole) {
      return authError(res, 400, 'ROLE_MISMATCH', 'Verification code does not match selected role.');
    }

    // Create the account
    const passwordHash = await hashPassword(password);
    await db.query('BEGIN');
    try {
      // Use username as external_id if enrollment number not provided
      const externalId = enrollmentNumber || username;

      const result = await db.query(
        `INSERT INTO students (external_id, name, email, password_hash, role, is_active, username, mobile_number, enrollment_number)
         VALUES ($1, $2, $3, $4, $5, TRUE, $6, $7, $8)
         RETURNING id`,
        [externalId, fullName || username, email.toLowerCase(), passwordHash, requestedRole, username.trim().toLowerCase(), formattedMobile, enrollmentNumber || null]
      );

      const newStudentId = result.rows[0].id;

      // Mark challenge as used
      await db.query(
        'UPDATE otp_challenges SET used = TRUE, consumed_at = NOW() WHERE id = $1',
        [challenge.id]
      );

      await db.query('COMMIT');

      // Create session
      const bindingToken = await createSession(res, newStudentId, false);

      await recordAudit('account_created', {
        studentId: newStudentId,
        ip: req.ip,
        metadata: { role: requestedRole },
      });

      // Get the new account
      const newAccount = await db.query(
        'SELECT * FROM students WHERE id = $1',
        [newStudentId]
      ).then(r => r.rows[0]);

      return res.json({
        data: {
          authenticated: true,
          requiresPasswordChange: false,
          bindingToken,
          user: publicUser(newAccount),
        },
      });
    } catch (err) {
      await db.query('ROLLBACK');
      if (err.code === '23505') { // Unique constraint violation
        return authError(res, 400, 'USERNAME_EXISTS', 'This username is already taken.');
      }
      throw err;
    }
  } catch (error) {
    // Handle RESEND_COOLDOWN error
    if (error.message && error.message.startsWith('RESEND_COOLDOWN:')) {
      const seconds = error.message.split(':')[1];
      return authError(res, 429, 'RESEND_COOLDOWN',
        `Please wait ${seconds} seconds before requesting a new code.`);
    }
    console.error('Registration verify error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred.');
  }
});

// =====================================================
// LOGOUT
// =====================================================
router.post('/logout', csrfProtection, async (req, res) => {
  try {
    if (req.user && req.user.sessionId) {
      await revokeSession(req.user.sessionId);
      await recordAudit('logout', {
        studentId: req.user.studentId,
        sessionId: req.user.sessionId,
        ip: req.ip,
      });
    }

    res.clearCookie('session');
    res.clearCookie('csrf_token');

    return res.json({ data: { message: 'Logged out successfully.' } });
  } catch (error) {
    console.error('Logout error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred during logout.');
  }
});

// =====================================================
// MFA VERIFY
// =====================================================
router.post('/mfa/verify', mfaLimiter, csrfProtection, async (req, res) => {
  try {
    const { challenge, code } = req.body;

    if (!challenge || !code) {
      return authError(res, 400, 'INVALID_INPUT', 'Challenge and code are required.');
    }

    // Find challenge
    const challengeData = await findChallenge(challenge);

    if (!challengeData) {
      return authError(res, 400, 'INVALID_CHALLENGE', 'Invalid or expired challenge.');
    }

    if (challengeData.attempts >= 5) {
      await deleteChallenge(challengeData.id);
      return authError(res, 429, 'MAX_ATTEMPTS', 'Too many attempts. Please start over.');
    }

    // Verify TOTP
    const isValid = await verifyTotp(code, decryptSecret(challengeData.mfa_secret_encrypted));

    if (!isValid) {
      await incrementChallengeAttempts(challengeData.id);
      return authError(res, 400, 'INVALID_CODE', 'Invalid verification code.');
    }

    // Mark MFA as verified in session
    const bindingToken = await createSession(res, challengeData.student_id, true);
    await deleteChallenge(challengeData.id);

    await recordAudit('mfa_verified', {
      studentId: challengeData.student_id,
      ip: req.ip,
    });

    const account = await db.query(
      'SELECT * FROM students WHERE id = $1',
      [challengeData.student_id]
    ).then(r => r.rows[0]);

    return res.json({
      data: {
        authenticated: true,
        requiresPasswordChange: account.password_change_required,
        bindingToken,
        user: publicUser(account),
      },
    });
  } catch (error) {
    console.error('MFA verify error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred.');
  }
});

// =====================================================
// MFA SETUP
// =====================================================
router.post('/mfa/setup', mfaLimiter, csrfProtection, async (req, res) => {
  try {
    if (!req.user || !req.user.studentId) {
      return authError(res, 401, 'NOT_AUTHENTICATED', 'Authentication required.');
    }

    const studentId = req.user.studentId;
    const account = await db.query(
      'SELECT * FROM students WHERE id = $1',
      [studentId]
    ).then(r => r.rows[0]);

    if (!account) {
      return authError(res, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
    }

    if (account.mfa_enabled) {
      return authError(res, 400, 'MFA_ALREADY_ENABLED', 'MFA is already enabled.');
    }

    // Generate new TOTP secret
    const { secret, uri } = await generateTotpSecret(account.email);

    // Encrypt and store the secret
    const encryptedSecret = encryptSecret(secret);

    await db.query(
      'UPDATE students SET mfa_secret_encrypted = $1 WHERE id = $2',
      [encryptedSecret, studentId]
    );

    // Get the challenge token from the request
    const { enrollmentToken } = req.body;

    if (!enrollmentToken) {
      return authError(res, 400, 'INVALID_INPUT', 'Enrollment token is required.');
    }

    // Verify enrollment token
    const challengeData = await db.query(
      `SELECT * FROM mfa_challenges
       WHERE enrollment_hash = $1 AND student_id = $2 AND expires_at > NOW()`,
      [hashToken(enrollmentToken), studentId]
    ).then(r => r.rows[0]);

    if (!challengeData) {
      return authError(res, 400, 'INVALID_TOKEN', 'Invalid or expired enrollment token.');
    }

    await recordAudit('mfa_setup_started', {
      studentId,
      ip: req.ip,
    });

    return res.json({
      data: {
        secret,
        uri,
        message: 'Scan the QR code with your authenticator app, then verify with a code.',
      },
    });
  } catch (error) {
    console.error('MFA setup error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred.');
  }
});

// =====================================================
// MFA VERIFY SETUP
// =====================================================
router.post('/mfa/verify-setup', mfaLimiter, csrfProtection, async (req, res) => {
  try {
    if (!req.user || !req.user.studentId) {
      return authError(res, 401, 'NOT_AUTHENTICATED', 'Authentication required.');
    }

    const studentId = req.user.studentId;
    const { code, challenge } = req.body;

    if (!code) {
      return authError(res, 400, 'INVALID_INPUT', 'Verification code is required.');
    }

    const account = await db.query(
      'SELECT * FROM students WHERE id = $1',
      [studentId]
    ).then(r => r.rows[0]);

    if (!account) {
      return authError(res, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
    }

    if (account.mfa_enabled) {
      return authError(res, 400, 'MFA_ALREADY_ENABLED', 'MFA is already enabled.');
    }

    if (!account.mfa_secret_encrypted) {
      return authError(res, 400, 'MFA_NOT_SETUP', 'Please start MFA setup first.');
    }

    // Verify the code
    const secret = decryptSecret(account.mfa_secret_encrypted);
    const isValid = await verifyTotp(code, secret);

    if (!isValid) {
      return authError(res, 400, 'INVALID_CODE', 'Invalid verification code.');
    }

    // Enable MFA
    await db.query(
      'UPDATE students SET mfa_enabled = TRUE WHERE id = $1',
      [studentId]
    );

    // Delete the challenge
    if (challenge) {
      await db.query(
        'DELETE FROM mfa_challenges WHERE challenge_hash = $1',
        [hashToken(challenge)]
      );
    }

    await recordAudit('mfa_enabled', {
      studentId,
      ip: req.ip,
    });

    return res.json({
      data: {
        message: 'MFA has been enabled successfully.',
      },
    });
  } catch (error) {
    console.error('MFA verify setup error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred.');
  }
});

// =====================================================
// CHANGE PASSWORD
// =====================================================
router.post('/change-password', loadSession, requireAuth, csrfProtection, async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return authError(res, 400, 'INVALID_INPUT', 'All passwords are required.');
    }

    if (newPassword !== confirmPassword) {
      return authError(res, 400, 'PASSWORD_MISMATCH', 'New passwords do not match.');
    }

    const account = await db.query(
      'SELECT * FROM students WHERE id = $1',
      [req.user.studentId]
    ).then(r => r.rows[0]);

    if (!account) {
      return authError(res, 404, 'ACCOUNT_NOT_FOUND', 'Account not found.');
    }

    // Verify current password
    const valid = await verifyPassword(currentPassword, account.password_hash);
    if (!valid) {
      return authError(res, 400, 'INVALID_PASSWORD', 'Current password is incorrect.');
    }

    // Validate new password
    const passwordError = validatePasswordPolicy(newPassword);
    if (passwordError) {
      return authError(res, 400, 'WEAK_PASSWORD', passwordError);
    }

    // Hash and update
    const passwordHash = await hashPassword(newPassword);
    await db.query(
      'UPDATE students SET password_hash = $1, password_change_required = FALSE WHERE id = $2',
      [passwordHash, req.user.studentId]
    );

    // Revoke all other sessions (session fixation protection)
    await db.query(
      'UPDATE sessions SET revoked_at = NOW() WHERE student_id = $1 AND id != $2 AND revoked_at IS NULL',
      [req.user.studentId, req.user.sessionId]
    );

    await recordAudit('password_changed', {
      studentId: req.user.studentId,
      ip: req.ip,
    });

    return res.json({
      data: {
        message: 'Password changed successfully.',
      },
    });
  } catch (error) {
    console.error('Change password error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred.');
  }
});

// =====================================================
// REGISTER (for admin-approved registration)
// =====================================================
router.post('/register', registerLimiter, csrfProtection, async (req, res) => {
  try {
    const {
      username,
      fullName,
      email,
      mobileNumber,
      enrollmentNumber,
      password,
      confirmPassword
    } = req.body;

    // Validate all required fields
    if (!username || !fullName || !email || !mobileNumber || !enrollmentNumber || !password || !confirmPassword) {
      return authError(res, 400, 'INVALID_INPUT', 'All fields are required.');
    }

    // Validate password match
    if (password !== confirmPassword) {
      return authError(res, 400, 'PASSWORD_MISMATCH', 'Passwords do not match.');
    }

    // Validate username (3-30 chars, alphanumeric and underscore only)
    const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
    if (!usernameRegex.test(username.trim())) {
      return authError(res, 400, 'INVALID_USERNAME', 'Username must be 3-30 characters (letters, numbers, underscore only).');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.toLowerCase())) {
      return authError(res, 400, 'INVALID_EMAIL', 'Please enter a valid email address.');
    }

    // Validate mobile number (10 digits, auto-add +91)
    const mobileDigits = mobileNumber.replace(/\D/g, '');
    if (mobileDigits.length !== 10) {
      return authError(res, 400, 'INVALID_MOBILE', 'Mobile number must be 10 digits.');
    }
    const formattedMobile = '+91' + mobileDigits;

    // Validate enrollment number (not empty, trimmed)
    if (enrollmentNumber.trim().length < 3) {
      return authError(res, 400, 'INVALID_ENROLLMENT', 'Please enter a valid enrollment number.');
    }

    // Validate password strength
    const passwordError = validatePasswordPolicy(password);
    if (passwordError) {
      return authError(res, 400, 'WEAK_PASSWORD', passwordError);
    }

    // Check if username exists
    const existingUsername = await db.query(
      'SELECT id FROM students WHERE username = $1',
      [username.trim().toLowerCase()]
    ).then(r => r.rows[0]);

    if (existingUsername) {
      return authError(res, 400, 'USERNAME_EXISTS', 'This username is already taken.');
    }

    // Check if email exists
    const existingEmail = await db.query(
      'SELECT id FROM students WHERE email = $1',
      [email.toLowerCase()]
    ).then(r => r.rows[0]);

    if (existingEmail) {
      return authError(res, 400, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }

    // Check if enrollment number exists
    const existingEnrollment = await db.query(
      'SELECT id FROM students WHERE external_id = $1',
      [enrollmentNumber.trim()]
    ).then(r => r.rows[0]);

    if (existingEnrollment) {
      return authError(res, 400, 'DUPLICATE_ENROLLMENT', 'This enrollment number is already registered.');
    }

    // Check if mobile exists
    const existingMobile = await db.query(
      'SELECT id FROM students WHERE mobile_number = $1',
      [formattedMobile]
    ).then(r => r.rows[0]);

    if (existingMobile) {
      return authError(res, 400, 'MOBILE_EXISTS', 'This mobile number is already registered.');
    }

    // Create registration request (admin approval required)
    const passwordHash = await hashPassword(password);
    await db.query(
      `INSERT INTO registration_requests (full_name, email, student_identifier, password_hash, username, mobile_number)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT DO NOTHING`,
      [fullName.trim(), email.toLowerCase(), enrollmentNumber.trim(), passwordHash, username.trim().toLowerCase(), formattedMobile],
    );

    await recordAudit('registration_requested', {
      ip: req.ip,
      metadata: { username: username.trim(), enrollmentNumber: enrollmentNumber.trim() },
    });

    return res.status(202).json({
      data: {
        message: 'Registration submitted for administrator approval.',
      },
    });
  } catch (error) {
    console.error('Registration error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred during registration.');
  }
});

// =====================================================
// Instant Registration (creates account immediately)
// =====================================================
router.post('/register/instant', registerLimiter, csrfProtection, async (req, res) => {
  try {
    const { email, username, fullName, mobileNumber, enrollmentNumber, password, confirmPassword, role } = req.body;

    // Validate all fields
    if (!email || !username || !fullName || !enrollmentNumber || !password || !confirmPassword) {
      return authError(res, 400, 'INVALID_INPUT', 'All fields are required.');
    }

    if (password !== confirmPassword) {
      return authError(res, 400, 'PASSWORD_MISMATCH', 'Passwords do not match.');
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.toLowerCase())) {
      return authError(res, 400, 'INVALID_EMAIL', 'Invalid email format.');
    }

    // Validate username
    if (!/^[a-zA-Z0-9_]{3,30}$/.test(username)) {
      return authError(res, 400, 'INVALID_USERNAME', 'Username must be 3-30 characters, alphanumeric and underscores only.');
    }

    // Validate password strength
    const passwordError = validatePasswordPolicy(password);
    if (passwordError) {
      return authError(res, 400, 'WEAK_PASSWORD', passwordError);
    }

    // Validate enrollment
    if (enrollmentNumber.trim().length < 4) {
      return authError(res, 400, 'INVALID_ENROLLMENT', 'Enrollment number must be at least 4 characters.');
    }

    // Validate mobile
    let formattedMobile = null;
    if (mobileNumber) {
      const digits = mobileNumber.replace(/\D/g, '');
      if (digits.length !== 10) {
        return authError(res, 400, 'INVALID_MOBILE', 'Mobile must be 10 digits.');
      }
      formattedMobile = '+91' + digits;
    }

    // Validate role
    const validRoles = ['STUDENT', 'CANDIDATE'];
    const requestedRole = (role || 'STUDENT').toUpperCase();
    if (!validRoles.includes(requestedRole)) {
      return authError(res, 400, 'INVALID_ROLE', 'Invalid role.');
    }

    // Check duplicates
    const existingEmail = await db.query(
      'SELECT id FROM students WHERE LOWER(email) = LOWER($1)',
      [email.toLowerCase()]
    ).then(r => r.rows[0]);

    if (existingEmail) {
      return authError(res, 400, 'EMAIL_EXISTS', 'An account with this email already exists.');
    }

    const existingUsername = await db.query(
      'SELECT id FROM students WHERE LOWER(username) = LOWER($1)',
      [username.trim().toLowerCase()]
    ).then(r => r.rows[0]);

    if (existingUsername) {
      return authError(res, 400, 'USERNAME_EXISTS', 'This username is already taken.');
    }

    const existingEnrollment = await db.query(
      'SELECT id FROM students WHERE LOWER(external_id) = LOWER($1)',
      [enrollmentNumber.trim()]
    ).then(r => r.rows[0]);

    if (existingEnrollment) {
      return authError(res, 400, 'ENROLLMENT_EXISTS', 'This enrollment number is already registered.');
    }

    // Hash password
    const passwordHash = await hashPassword(password);

    // Create account
    const result = await db.query(
      `INSERT INTO students (username, external_id, name, email, password_hash, mobile_number, enrollment_number, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE)
       RETURNING id, username, external_id, name, email, role`,
      [username.trim().toLowerCase(), 'EXT-' + Date.now(), fullName.trim(), email.toLowerCase(), passwordHash, formattedMobile, enrollmentNumber.trim().toUpperCase(), requestedRole]
    );

    const newUser = result.rows[0];

    // Create session (sets session cookie automatically)
    await createSession(res, newUser.id);

    await recordAudit('registration_completed', {
      studentId: newUser.id,
      email: newUser.email,
      role: requestedRole,
      ip: req.ip,
    });

    return res.status(201).json({
      data: {
        success: true,
        message: 'Account created successfully!',
        user: {
          id: newUser.id,
          username: newUser.username,
          name: newUser.name,
          email: newUser.email,
          role: newUser.role,
        },
      },
    });

  } catch (error) {
    console.error('Instant registration error:', error);
    return authError(res, 500, 'INTERNAL_ERROR', 'An error occurred during registration.');
  }
});

module.exports = router;
