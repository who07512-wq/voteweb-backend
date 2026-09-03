-- Migration: Add username and mobile_number columns to students and registration_requests
-- Adds required fields for complete user registration

-- Add username column to students (unique, used for login)
ALTER TABLE students ADD COLUMN IF NOT EXISTS username VARCHAR(50) UNIQUE;

-- Add mobile_number column with +91 prefix
ALTER TABLE students ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(15);

-- Add enrollment_number column
ALTER TABLE students ADD COLUMN IF NOT EXISTS enrollment_number VARCHAR(50);

-- Add indexes for new columns
CREATE INDEX IF NOT EXISTS idx_students_username ON students(username);
CREATE INDEX IF NOT EXISTS idx_students_mobile ON students(mobile_number);
CREATE INDEX IF NOT EXISTS idx_students_enrollment ON students(enrollment_number);

-- Add columns to registration_requests table
ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS username VARCHAR(50);
ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS mobile_number VARCHAR(15);
ALTER TABLE registration_requests ADD COLUMN IF NOT EXISTS enrollment_number VARCHAR(50);

COMMENT ON COLUMN students.username IS 'Unique username for login';
COMMENT ON COLUMN students.mobile_number IS 'Mobile number with +91 country code';
COMMENT ON COLUMN students.enrollment_number IS 'Student enrollment number';

COMMENT ON COLUMN registration_requests.username IS 'Requested username';
COMMENT ON COLUMN registration_requests.mobile_number IS 'Mobile number with +91 country code';
COMMENT ON COLUMN registration_requests.enrollment_number IS 'Student enrollment number';
