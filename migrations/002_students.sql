-- Migration: 002_students.sql
-- Creates students table for student identity management

CREATE TABLE IF NOT EXISTS students (
    id SERIAL PRIMARY KEY,
    -- External identity reference for integration with auth system
    -- This could be student ID number, enrollment number, or auth system user ID
    external_id VARCHAR(255) NOT NULL UNIQUE,
    -- Student display name
    name VARCHAR(255) NOT NULL,
    -- Optional email for notifications
    email VARCHAR(255),
    -- Active status - can be deactivated without deletion
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for looking up students by external ID (auth integration)
CREATE INDEX IF NOT EXISTS idx_students_external_id ON students(external_id);

-- Index for active students queries
CREATE INDEX IF NOT EXISTS idx_students_is_active ON students(is_active);

COMMENT ON TABLE students IS 'Student identity records (no authentication - auth handled separately)';
COMMENT ON COLUMN students.external_id IS 'Reference to external auth system user ID or student enrollment number';
