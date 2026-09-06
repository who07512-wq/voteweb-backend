-- Migration: 029_positions_max_selections.sql
-- Adds max_selections to positions (used by result ranking in
-- voteService.getElectionResultsFull). Defaults to 1 (single-choice ballot),
-- which matches existing admin behavior where each position elects one.
-- Existing rows are safe: the column is nullable-friendly; the results service
-- uses COALESCE(p.max_selections, 1) as well.

ALTER TABLE positions
    ADD COLUMN IF NOT EXISTS max_selections INTEGER NOT NULL DEFAULT 1;

COMMENT ON COLUMN positions.max_selections IS
    'Number of winners/seats for this position; default 1 (single-choice).';