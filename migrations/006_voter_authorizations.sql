-- Migration: 006_voter_authorizations.sql
-- Creates voter_authorizations table for election eligibility

CREATE TABLE IF NOT EXISTS voter_authorizations (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
    election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    -- Optional: authorize specific clubs only (NULL means all clubs)
    club_id INTEGER REFERENCES clubs(id) ON DELETE CASCADE,
    -- Authorization status
    is_authorized BOOLEAN NOT NULL DEFAULT true,
    -- Optional authorization expiry
    authorized_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    expires_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Prevent duplicate authorizations for same student/election
    CONSTRAINT voter_auth_unique UNIQUE (student_id, election_id, club_id)
);

-- Index for student authorizations (check if student is authorized)
CREATE INDEX IF NOT EXISTS idx_voter_auth_student_id ON voter_authorizations(student_id);

-- Index for election authorizations (get all authorized voters)
CREATE INDEX IF NOT EXISTS idx_voter_auth_election_id ON voter_authorizations(election_id);

-- Index for club-specific authorizations
CREATE INDEX IF NOT EXISTS idx_voter_auth_club_id ON voter_authorizations(club_id);

-- Index for finding active authorizations
CREATE INDEX IF NOT EXISTS idx_voter_auth_active ON voter_authorizations(is_authorized, authorized_at);

COMMENT ON TABLE voter_authorizations IS 'Maps students to elections they are authorized to vote in';
COMMENT ON COLUMN voter_authorizations.club_id IS 'NULL means student can vote in all clubs; set club_id to restrict to specific club';
