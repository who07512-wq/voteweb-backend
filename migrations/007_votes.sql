-- Migration: 007_votes.sql
-- Creates votes table with strict constraints to enforce voting rules

CREATE TABLE IF NOT EXISTS votes (
    id SERIAL PRIMARY KEY,
    student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE RESTRICT,
    election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE RESTRICT,
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE RESTRICT,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE RESTRICT,
    candidate_id INTEGER NOT NULL REFERENCES candidates(id) ON DELETE RESTRICT,
    -- Vote timestamp
    voted_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- CRITICAL: Enforce one vote per student per position per election
    -- This is the database-level constraint that prevents duplicate voting
    CONSTRAINT votes_unique_student_position_election UNIQUE (student_id, election_id, position_id)
);

-- Index for student votes (common query)
CREATE INDEX IF NOT EXISTS idx_votes_student_id ON votes(student_id);

-- Index for election votes (results aggregation)
CREATE INDEX IF NOT EXISTS idx_votes_election_id ON votes(election_id);

-- Index for club votes
CREATE INDEX IF NOT EXISTS idx_votes_club_id ON votes(club_id);

-- Index for position votes
CREATE INDEX IF NOT EXISTS idx_votes_position_id ON votes(position_id);

-- Index for candidate votes (vote counting)
CREATE INDEX IF NOT EXISTS idx_votes_candidate_id ON votes(candidate_id);

-- Index for timestamp queries
CREATE INDEX IF NOT EXISTS idx_votes_voted_at ON votes(voted_at);

-- Composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_votes_student_election ON votes(student_id, election_id);

COMMENT ON TABLE votes IS 'Individual votes - critical records that preserve voting history';
COMMENT ON CONSTRAINT votes_unique_student_position_election ON votes IS 'Enforces: ONE vote per student per position per election';
