/**
 * Email Recovery — PUBLIC routes (no authentication)
 *
 * Students who cannot access the email on the authorized list submit a
 * recovery request. An admin later verifies identity and, on approval,
 * the student's login email is updated (see adminEmailRecovery.js).
 *
 * Anti-enumeration: the response is IDENTICAL whether or not the old email
 * exists in the database, so attackers can't probe which emails are registered.
 */
const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();

const db = require('../db');
const { recordAudit } = require('../lib/authDb');

// Strict limiter: abuse here is anonymous, so keep it tight
const recoveryLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } },
});

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/email-recovery', recoveryLimiter, async (req, res) => {
  try {
    // ---- 1. Validate payload ----
    const name = String(req.body.name || '').trim();
    const oldEmail = String(req.body.oldEmail || '').toLowerCase().trim();
    const studentRef = String(req.body.studentRef || '').trim();
    const newEmail = String(req.body.newEmail || '').toLowerCase().trim();
    const reason = String(req.body.reason || '').trim().slice(0, 2000);

    if (!name || name.length > 120) {
      return res.status(400).json({ error: { code: 'INVALID_NAME', message: 'Full name is required (max 120 characters).' } });
    }
    if (!EMAIL_RE.test(oldEmail) || !EMAIL_RE.test(newEmail)) {
      return res.status(400).json({ error: { code: 'INVALID_EMAIL', message: 'A valid registered email and a valid new email are required.' } });
    }
    if (!studentRef || studentRef.length > 64) {
      return res.status(400).json({ error: { code: 'INVALID_STUDENT_REF', message: 'Roll number / Student ID is required (max 64 characters).' } });
    }
    if (oldEmail === newEmail) {
      return res.status(400).json({ error: { code: 'SAME_EMAIL', message: 'The new email must be different from the registered one.' } });
    }

    // ---- 2. Look up the student by OLD email only (never the new one) ----
    // The new email must NOT automatically gain access — no account is
    // created or modified here. Only the request is stored for admin review.
    const student = await db.query(
      `SELECT id, name, student_id FROM students
        WHERE LOWER(current_login_email) = LOWER($1)
           OR LOWER(official_email) = LOWER($1)
        LIMIT 1`,
      [oldEmail]
    ).then((r) => r.rows[0] || null);

    // ---- 3. Always answer the same way (anti-enumeration) ----
    const genericMessage =
      'If this email belongs to an authorized student, your request has been submitted and will be reviewed by the election administrator.';

    if (student) {
      // Duplicate pending request for the same student+new email? Update instead of spamming rows.
      const dup = await db.query(
        `SELECT id FROM email_change_requests
          WHERE student_id = $1 AND LOWER(requested_new_email) = LOWER($2) AND status = 'pending'
          LIMIT 1`,
        [student.id, newEmail]
      ).then((r) => r.rows[0] || null);

      if (dup) {
        await db.query(
          `UPDATE email_change_requests
              SET old_email = $2, reason = $3, request_ip = $4, updated_at = NOW()
            WHERE id = $1`,
          [dup.id, oldEmail, reason, req.ip]
        );
      } else {
        await db.query(
          `INSERT INTO email_change_requests
             (student_id, old_email, requested_new_email, reason, status, request_ip)
           VALUES ($1, $2, $3, $4, 'pending', $5)`,
          [student.id, oldEmail, newEmail, reason, req.ip]
        );
      }

      await recordAudit('email_recovery_requested', {
        studentId: student.id,
        ip: req.ip,
        metadata: { oldEmail, newEmail, studentRef, reason: reason.slice(0, 200) },
      });
    } else {
      // Log without student link — still auditable, still same response
      await recordAudit('email_recovery_unknown_email', {
        studentId: null,
        ip: req.ip,
        metadata: { oldEmail, newEmail, studentRef },
      });
    }

    return res.status(202).json({
      data: {
        submitted: true,
        message: genericMessage,
      },
    });
  } catch (error) {
    console.error('email-recovery error:', error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Could not submit your request. Please try again later.' } });
  }
});

module.exports = router;
