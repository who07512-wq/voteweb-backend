-- Migration: 030_class_representative.sql
-- Adds Class Representative (CR) election support.
--
-- CR is NOT a club/society. It is a constituency defined by
-- (department/course, year, section). This migration adds a parallel,
-- non-breaking track:
--   * elections.category            : 'CLUB' (default) or 'CLASS_REPRESENTATIVE'
--   * constituencies                : per-election (department, year, section) rows
--   * positions.constituency_id     : nullable FK; a CR position points at a
--                                     constituency instead of a club
--   * votes.constituency_id         : nullable FK; CR votes record the
--                                     constituency, club opinion columns relaxed
--   * students.section              : voter's section (server-side eligibility)
--
-- Existing club elections/positions/candidates/votes/results are untouched:
-- all new columns are nullable/defaulted and the club path keeps using
-- club_id on positions and votes.

-- ---- 1. elections.category (informational) ----
-- Mixed elections are allowed: an election may contain both club positions
-- and CR constituencies. The real discriminator is per-position:
-- positions.club_id XOR positions.constituency_id (exactly one is set).
-- 'category' is kept as a display hint only; it does not constrain.
ALTER TABLE elections ADD COLUMN IF NOT EXISTS category VARCHAR(30)
    DEFAULT 'CLUB';

COMMENT ON COLUMN elections.category IS
    'Display hint only. Election kind: CLUB, CLASS_REPRESENTATIVE or MIXED (mixed elections may contain both club and constituency positions). Position-level club_id/constituency_id is the authoritative discriminator.';

-- ---- 2. constituencies ----
CREATE TABLE IF NOT EXISTS constituencies (
    id SERIAL PRIMARY KEY,
    election_id INTEGER NOT NULL REFERENCES elections(id) ON DELETE CASCADE,
    department VARCHAR(100) NOT NULL,
    year VARCHAR(50) NOT NULL,
    section VARCHAR(20) NOT NULL,
    -- display label, e.g. "BCA 2nd Year Section A"
    name VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    -- one position per constituency within an election
    CONSTRAINT constituencies_unique UNIQUE (election_id, department, year, section)
);

CREATE INDEX IF NOT EXISTS idx_constituencies_election_id ON constituencies(election_id);
CREATE INDEX IF NOT EXISTS idx_constituencies_department ON constituencies(department);

COMMENT ON TABLE constituencies IS
    'Class Representative constituencies: (department, year, section) per election';
COMMENT ON COLUMN constituencies.name IS 'Human-readable constituency label, e.g. BCA 2nd Year Section A';

-- ---- 3. positions.constituency_id + relaxed club_id ----
ALTER TABLE positions ADD COLUMN IF NOT EXISTS constituency_id INTEGER REFERENCES constituencies(id) ON DELETE RESTRICT;
ALTER TABLE positions ALTER COLUMN club_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_positions_constituency_id ON positions(constituency_id);

COMMENT ON COLUMN positions.constituency_id IS
    'For CR elections: the constituency this position (Class Representative) belongs to. NULL for club positions.';

-- ---- 4. votes.constituency_id + relaxed club_id ----
ALTER TABLE votes ADD COLUMN IF NOT EXISTS constituency_id INTEGER REFERENCES constituencies(id) ON DELETE RESTRICT;
ALTER TABLE votes ALTER COLUMN club_id DROP NOT NULL;

CREATE INDEX IF NOT EXISTS idx_votes_constituency_id ON votes(constituency_id);

COMMENT ON COLUMN votes.constituency_id IS
    'For CR votes: the constituency voted in. NULL for club votes.';

-- ---- 5. students.section ----
ALTER TABLE students ADD COLUMN IF NOT EXISTS section VARCHAR(20);

COMMENT ON COLUMN students.section IS
    'Student section (A/B/C/...) used for Class Representative voting eligibility';

-- ---- 6. candidate_applications.category + election_id ----
-- Every application targets either a club position (CLUB) or a Class
-- Representative constituency (CLASS_REPRESENTATIVE). CR applications carry
-- department/year/section anyway; election_id records WHICH election the
-- application is for, set at approval time when the admin links the CR
-- applicant to an election. It stays NULL for club applications.
ALTER TABLE candidate_applications ADD COLUMN IF NOT EXISTS category VARCHAR(30) DEFAULT 'CLUB';
ALTER TABLE candidate_applications ADD COLUMN IF NOT EXISTS election_id INTEGER REFERENCES elections(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_candidate_applications_election_id ON candidate_applications(election_id);

COMMENT ON COLUMN candidate_applications.category IS
    'Application target type: CLUB (club/society) or CLASS_REPRESENTATIVE (constituency by department/year/section)';
COMMENT ON COLUMN candidate_applications.election_id IS
    'For CR applications: the election the approved applicant will contest in. NULL for club applications and before approval.';