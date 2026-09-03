-- Migration: 003_clubs.sql
-- Creates clubs table (organization units within elections)

CREATE TABLE IF NOT EXISTS clubs (
    id SERIAL PRIMARY KEY,
    election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    -- Image URL/path for club logo/avatar
    image_url VARCHAR(500),
    -- Display ordering within the election
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for clubs by election (common query)
CREATE INDEX IF NOT EXISTS idx_clubs_election_id ON clubs(election_id);

-- Index for ordering queries
CREATE INDEX IF NOT EXISTS idx_clubs_display_order ON clubs(display_order);

-- Unique constraint: club name must be unique within an election
CREATE UNIQUE INDEX IF NOT EXISTS idx_clubs_election_name ON clubs(election_id, name) WHERE is_active = true;

COMMENT ON TABLE clubs IS 'Clubs/groups within an election where positions are created';
