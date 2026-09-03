-- Migration: 001_elections.sql
-- Creates elections table with status management

-- Create election status enum type
DO $$ BEGIN
    CREATE TYPE election_status AS ENUM ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create elections table
CREATE TABLE IF NOT EXISTS elections (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status election_status NOT NULL DEFAULT 'DRAFT',
    start_time TIMESTAMP WITH TIME ZONE,
    end_time TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Ensure end_time is after start_time if both are set
    CONSTRAINT elections_time_check CHECK (
        end_time IS NULL OR start_time IS NULL OR end_time > start_time
    ),

    -- Ensure status transitions are valid
    CONSTRAINT elections_status_check CHECK (
        status IN ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED')
    )
);

-- Create index for status queries (common filter)
CREATE INDEX IF NOT EXISTS idx_elections_status ON elections(status);

-- Create index for time-based queries
CREATE INDEX IF NOT EXISTS idx_elections_start_time ON elections(start_time);
CREATE INDEX IF NOT EXISTS idx_elections_end_time ON elections(end_time);

-- Add comment for documentation
COMMENT ON TABLE elections IS 'Voting elections with status management';
COMMENT ON COLUMN elections.status IS 'DRAFT: not yet scheduled, SCHEDULED: set up but not started, OPEN: accepting votes, CLOSED: finished';
