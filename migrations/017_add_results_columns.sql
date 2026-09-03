-- Migration: Add election results publication tracking
-- Track when results are published and by whom

ALTER TABLE elections ADD COLUMN IF NOT EXISTS results_published_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE elections ADD COLUMN IF NOT EXISTS results_published_by INTEGER REFERENCES students(id);

COMMENT ON COLUMN elections.results_published_at IS 'Timestamp when results were published';
COMMENT ON COLUMN elections.results_published_by IS 'Admin who published the results';
