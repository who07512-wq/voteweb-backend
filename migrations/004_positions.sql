-- Migration: 004_positions.sql
-- Creates positions table (roles within clubs)

CREATE TABLE IF NOT EXISTS positions (
    id SERIAL PRIMARY KEY,
    club_id INTEGER NOT NULL REFERENCES clubs(id) ON DELETE RESTRICT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    -- Display ordering within the club
    display_order INTEGER NOT NULL DEFAULT 0,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for positions by club
CREATE INDEX IF NOT EXISTS idx_positions_club_id ON positions(club_id);

-- Index for ordering queries
CREATE INDEX IF NOT EXISTS idx_positions_display_order ON positions(display_order);

-- Unique constraint: position name must be unique within a club
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_club_name ON positions(club_id, name) WHERE is_active = true;

COMMENT ON TABLE positions IS 'Positions/roles within clubs - names are admin-defined, not hardcoded';
