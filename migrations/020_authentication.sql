-- Migration: 020_authentication.sql
-- Authentication and security tables for VoteWeb
-- Integrates authentication from voteweb-auth project

-- Add authentication columns to students table
ALTER TABLE students ADD COLUMN IF NOT EXISTS password_hash TEXT;
ALTER TABLE students ADD COLUMN IF NOT EXISTS password_change_required BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE students ADD COLUMN IF NOT EXISTS mfa_secret_encrypted BYTEA;
ALTER TABLE students ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE students ADD COLUMN IF NOT EXISTS locked_until TIMESTAMPTZ;
ALTER TABLE students ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;

-- Create user_role enum if it doesn't exist
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('STUDENT', 'CANDIDATE', 'ADMIN');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Add role column to students table
ALTER TABLE students ADD COLUMN IF NOT EXISTS role user_role NOT NULL DEFAULT 'STUDENT';

-- Sessions table for authenticated sessions
CREATE TABLE IF NOT EXISTS sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_hash TEXT NOT NULL UNIQUE,
    binding_hash TEXT NOT NULL,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    mfa_verified BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ
);

-- Index for looking up sessions by student
CREATE INDEX IF NOT EXISTS idx_sessions_student_id ON sessions(student_id);

-- Index for session expiry cleanup
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- MFA challenges table for TOTP enrollment and verification
CREATE TABLE IF NOT EXISTS mfa_challenges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    challenge_hash TEXT NOT NULL UNIQUE,
    enrollment_hash TEXT,
    pending_secret_encrypted BYTEA,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for challenge expiry cleanup
CREATE INDEX IF NOT EXISTS idx_mfa_challenges_expires_at ON mfa_challenges(expires_at);

-- Registration requests table for admin approval flow
CREATE TABLE IF NOT EXISTS registration_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    email TEXT NOT NULL,
    student_identifier TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
    reviewed_at TIMESTAMPTZ,
    reviewed_by INTEGER REFERENCES students(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Unique index for student_identifier to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_requests_identifier_lower
    ON registration_requests (LOWER(student_identifier));

-- Unique index for email to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_registration_requests_email_lower
    ON registration_requests (LOWER(email));

-- Auth audit logs (separate from business audit_logs)
CREATE TABLE IF NOT EXISTS auth_audit_logs (
    id BIGSERIAL PRIMARY KEY,
    student_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
    event TEXT NOT NULL,
    ip_address INET,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for audit log queries
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_created_at ON auth_audit_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_logs_student_id ON auth_audit_logs(student_id);

COMMENT ON TABLE sessions IS 'Authenticated user sessions with HttpOnly cookies';
COMMENT ON TABLE mfa_challenges IS 'TOTP MFA enrollment and verification challenges';
COMMENT ON TABLE registration_requests IS 'Student registration requests pending admin approval';
COMMENT ON TABLE auth_audit_logs IS 'Authentication event audit trail';
