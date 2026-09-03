-- Migration: 021_otp_challenges.sql
-- OTP challenge table for email-based authentication

-- OTP challenges for login and password reset
CREATE TABLE IF NOT EXISTS otp_challenges (
    id BIGSERIAL PRIMARY KEY,
    -- Purpose: 'LOGIN_OTP' or 'PASSWORD_RESET'
    purpose TEXT NOT NULL,
    -- Target role: 'STUDENT', 'CANDIDATE', or null for password reset
    target_role user_role,
    -- Email the OTP was sent to
    email TEXT NOT NULL,
    -- Secure hash of the OTP (SHA-256 HMAC with secret key)
    otp_hash TEXT NOT NULL,
    -- Expiration timestamp
    expires_at TIMESTAMPTZ NOT NULL,
    -- Attempt counter
    attempts INTEGER NOT NULL DEFAULT 0,
    -- Whether the OTP has been used/consumed
    used BOOLEAN NOT NULL DEFAULT FALSE,
    -- Consumed at timestamp (when verified successfully)
    consumed_at TIMESTAMPTZ,
    -- Created at timestamp
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    -- Rate limit key (email or IP)
    rate_key TEXT
);

-- Index for finding active OTP challenges by email and purpose
CREATE INDEX IF NOT EXISTS idx_otp_challenges_email_purpose
    ON otp_challenges(email, purpose)
    WHERE used = FALSE;

-- Index for cleanup of expired challenges
CREATE INDEX IF NOT EXISTS idx_otp_challenges_expires_at
    ON otp_challenges(expires_at);

-- Index for rate limiting queries
CREATE INDEX IF NOT EXISTS idx_otp_challenges_rate_key
    ON otp_challenges(rate_key, created_at DESC);

COMMENT ON TABLE otp_challenges IS 'OTP challenges for email-based login and password reset';
COMMENT ON COLUMN otp_challenges.purpose IS 'LOGIN_OTP or PASSWORD_RESET';
COMMENT ON COLUMN otp_challenges.target_role IS 'Role being authenticated (STUDENT, CANDIDATE) - null for password reset';
