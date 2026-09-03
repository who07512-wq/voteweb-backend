-- Migration: 005_candidates.sql
-- Creates candidates table (contestants for positions)

CREATE TABLE IF NOT EXISTS candidates (
    id SERIAL PRIMARY KEY,
    position_id INTEGER NOT NULL REFERENCES positions(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    -- Image URL/path for candidate photo
    image_url VARCHAR(500),
    -- Display ordering within the position
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for candidates by position
CREATE INDEX IF NOT EXISTS idx_candidates_position_id ON candidates(position_id);

-- Index for ordering queries
CREATE INDEX IF NOT EXISTS idx_candidates_display_order ON candidates(display_order);

-- Unique constraint: candidate name must be unique within a position
CREATE UNIQUE INDEX IF NOT EXISTS idx_candidates_position_name ON candidates(position_id, name) WHERE is_active = true;

COMMENT ON TABLE candidates IS 'Candidates contesting for positions';
