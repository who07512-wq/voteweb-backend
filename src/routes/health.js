const express = require('express');
const db = require('../db');

const router = express.Router();

// Basic health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'voteweb-api',
    timestamp: new Date().toISOString(),
  });
});

// Database health check
router.get('/health/db', async (req, res) => {
  try {
    const dbHealth = await db.healthCheck();
    res.json({
      status: 'ok',
      database: 'postgresql',
      ...dbHealth,
    });
  } catch (err) {
    console.error('Database health check failed:', err.message);
    res.status(503).json({
      status: 'error',
      database: 'postgresql',
      error: 'Database connection failed',
      timestamp: new Date().toISOString(),
    });
  }
});

// Brevo/Email configuration check
router.get('/health/brevo', (req, res) => {
  const hasApiKey = !!process.env.BREVO_API_KEY;
  const hasSenderEmail = !!process.env.BREVO_SENDER_EMAIL;
  const hasSenderName = !!process.env.BREVO_SENDER_NAME;

  res.json({
    hasApiKey,
    hasSenderEmail,
    hasSenderName,
    senderEmail: process.env.BREVO_SENDER_EMAIL || 'NOT SET',
    senderName: process.env.BREVO_SENDER_NAME || 'NOT SET',
    apiKeyPrefix: process.env.BREVO_API_KEY ? process.env.BREVO_API_KEY.substring(0, 8) + '...' : 'NOT SET',
  });
});

// Debug: Check OTP challenge for email (dev only)
router.get('/debug/otp/:email', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  const { email } = req.params;
  const challenges = await db.query(
    `SELECT id, email, purpose, target_role, used, attempts, expires_at, created_at
     FROM otp_challenges
     WHERE email = $1
     ORDER BY created_at DESC
     LIMIT 5`,
    [email.toLowerCase()]
  );
  res.json({ challenges: challenges.rows });
});

// Debug: Check sessions for student
router.get('/debug/sessions/:studentId', async (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  const { studentId } = req.params;
  const sessions = await db.query(
    `SELECT id, student_id, expires_at, revoked_at, created_at
     FROM sessions
     WHERE student_id = $1
     ORDER BY id DESC
     LIMIT 5`,
    [studentId]
  );
  res.json({ sessions: sessions.rows });
});

module.exports = router;
