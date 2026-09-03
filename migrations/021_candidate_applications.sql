-- Migration: 021_candidate_applications.sql
-- Creates candidate_applications table for the application/approval workflow

CREATE TABLE IF NOT EXISTS candidate_applications (
    id SERIAL PRIMARY KEY,
    -- Reference to the student/user who is applying
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    -- Verified information (immutable after approval)
    full_name VARCHAR(255) NOT NULL,
    enrollment_number VARCHAR(100) NOT NULL,
    department VARCHAR(100) NOT NULL,
    year VARCHAR(50) NOT NULL,
    semester VARCHAR(50),
    section VARCHAR(20),
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE RESTRICT,
    -- Contact information
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(20) NOT NULL,
    -- Candidate content (editable after approval)
    profile_photo_url VARCHAR(500),
    bio TEXT,
    manifesto TEXT,
    -- Application status workflow
    status VARCHAR(50) NOT NULL DEFAULT 'under_review' CHECK (
        status IN ('draft', 'submitted', 'under_review', 'changes_requested', 'approved', 'rejected')
    ),
    -- Review information
    rejection_reason TEXT,
    changes_requested_reason TEXT,
    reviewed_by INTEGER REFERENCES students(id),
    reviewed_at TIMESTAMP WITH TIME ZONE,
    -- Timestamps
    submitted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Unique constraint: one application per enrollment number
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_applications_enrollment
    ON candidate_applications(enrollment_number) WHERE status != 'rejected';

-- Index for finding applications by student
CREATE INDEX IF NOT EXISTS idx_candidate_applications_student_id
    ON candidate_applications(student_id);

-- Index for admin listing by status
CREATE INDEX IF NOT EXISTS idx_candidate_applications_status
    ON candidate_applications(status);

-- Index for admin listing by position
CREATE INDEX IF NOT EXISTS idx_candidate_applications_position_id
    ON candidate_applications(position_id);

-- Index for admin listing by department
CREATE INDEX IF NOT EXISTS idx_candidate_applications_department
    ON candidate_applications(department);

-- Unique constraint: student can only have one active application per position
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidate_applications_student_position
    ON candidate_applications(student_id, position_id)
    WHERE status IN ('under_review', 'changes_requested', 'approved');

COMMENT ON TABLE candidate_applications IS 'Candidate applications for election positions with approval workflow';
COMMENT ON COLUMN candidate_applications.status IS 'Application status: draft, submitted, under_review, changes_requested, approved, rejected';
COMMENT ON COLUMN candidate_applications.full_name IS 'Verified candidate full name (immutable after approval)';
COMMENT ON COLUMN candidate_applications.enrollment_number IS 'Verified enrollment number (immutable after approval)';
