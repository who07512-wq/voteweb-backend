-- Migration: Create vote_receipts table for vote verification
-- This table stores cryptographic proofs of votes for verification

CREATE TABLE IF NOT EXISTS vote_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vote_id INTEGER NOT NULL UNIQUE REFERENCES votes(id) ON DELETE CASCADE,
  election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  receipt_hash VARCHAR(128) NOT NULL,
  nullifier VARCHAR(64) NOT NULL UNIQUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Index for public verification by receipt hash
  CONSTRAINT vote_receipts_hash_unique UNIQUE (receipt_hash)
);

-- Index for looking up by election
CREATE INDEX IF NOT EXISTS idx_vote_receipts_election ON vote_receipts(election_id);

-- Index for looking up by student
CREATE INDEX IF NOT EXISTS idx_vote_receipts_student ON vote_receipts(student_id);

-- Index for nullifier lookups
CREATE INDEX IF NOT EXISTS idx_vote_receipts_nullifier ON vote_receipts(nullifier);

COMMENT ON TABLE vote_receipts IS 'Stores cryptographic vote receipts for public verification';
COMMENT ON COLUMN vote_receipts.receipt_hash IS 'SHA-256 hash of vote details for verification';
COMMENT ON COLUMN vote_receipts.nullifier IS 'Unique nullifier to prevent double-spending without revealing vote content';
