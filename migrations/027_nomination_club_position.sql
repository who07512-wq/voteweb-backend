-- 027: Club & Society nomination fields on candidate applications
--
-- The application form matches the official club nomination form:
--   * Nomination For Club (fixed list of 10 clubs)
--   * Applied for the Position (Vice President (Batch 2020) / Secretary (Batch 2021))
--
-- position_id becomes optional: it referenced the empty admin-managed
-- positions table, which made every application submission fail. The
-- text columns are the source of truth now.

ALTER TABLE candidate_applications ADD COLUMN IF NOT EXISTS nomination_club VARCHAR(255);
ALTER TABLE candidate_applications ADD COLUMN IF NOT EXISTS contesting_position VARCHAR(255);

-- position_id is no longer mandatory (was NOT NULL REFERENCES positions(id))
ALTER TABLE candidate_applications ALTER COLUMN position_id DROP NOT NULL;

COMMENT ON COLUMN candidate_applications.nomination_club IS 'Club nominated for (official club nomination form list)';
COMMENT ON COLUMN candidate_applications.contesting_position IS 'Position applied for, e.g. Vice President (Batch 2020)';
