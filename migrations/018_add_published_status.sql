-- Migration: Add PUBLISHED status to election_status enum
-- This allows tracking when election results have been published

ALTER TYPE election_status ADD VALUE IF NOT EXISTS 'PUBLISHED';

COMMENT ON TYPE election_status IS 'Election status: DRAFT, SCHEDULED, OPEN, CLOSED, PUBLISHED';
