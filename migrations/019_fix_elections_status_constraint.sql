-- Migration: Fix elections status check constraint to include PUBLISHED
-- Updates the check constraint to allow PUBLISHED status

-- First, ensure the enum has PUBLISHED (may already exist from previous migration)
ALTER TYPE election_status ADD VALUE IF NOT EXISTS 'PUBLISHED';

-- Drop and recreate the check constraint to include PUBLISHED
ALTER TABLE elections DROP CONSTRAINT IF EXISTS elections_status_check;
ALTER TABLE elections ADD CONSTRAINT elections_status_check CHECK (status IN ('DRAFT', 'SCHEDULED', 'OPEN', 'CLOSED', 'PUBLISHED'));

-- Update comment
COMMENT ON COLUMN elections.status IS 'DRAFT: not yet scheduled, SCHEDULED: set up but not started, OPEN: accepting votes, CLOSED: finished, PUBLISHED: results published';
