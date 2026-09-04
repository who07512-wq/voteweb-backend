-- 024: Student identity + email recovery system
--
-- Identity model: a student's identity and voting eligibility are tied to
-- their unique student_id (and internal id), NEVER to their login email.
-- Login email (email / current_login_email) is just a credential that can be
-- changed after admin-approved verification. official_email preserves the
-- original institute address forever.
--
-- Vote uniqueness ("one student = one vote per position") is enforced by the
-- votes table's unique constraint on (student_id, election_id, position_id),
-- which is identity-based and therefore unaffected by email changes.

-- ---- 1. Identity columns on students ----
ALTER TABLE students ADD COLUMN IF NOT EXISTS student_id VARCHAR(64);
ALTER TABLE students ADD COLUMN IF NOT EXISTS official_email VARCHAR(255);
ALTER TABLE students ADD COLUMN IF NOT EXISTS current_login_email VARCHAR(255);
ALTER TABLE students ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill existing accounts
UPDATE students SET official_email = email WHERE official_email IS NULL;
UPDATE students SET current_login_email = email WHERE current_login_email IS NULL;
UPDATE students
   SET student_id = COALESCE(external_id, username, 'SID-' || LPAD(id::TEXT, 6, '0'))
 WHERE student_id IS NULL;
-- Existing accounts were verified via Google OAuth or OTP at signup
UPDATE students SET email_verified = TRUE WHERE email_verified = FALSE;

-- Uniqueness: one student_id per person, one login email per account
CREATE UNIQUE INDEX IF NOT EXISTS students_student_id_key ON students(student_id);
CREATE UNIQUE INDEX IF NOT EXISTS students_current_login_email_lower_key
  ON students(LOWER(current_login_email)) WHERE current_login_email IS NOT NULL;

-- ---- 2. Email change (recovery) requests ----
CREATE TABLE IF NOT EXISTS email_change_requests (
  id                  SERIAL PRIMARY KEY,
  student_id          INTEGER REFERENCES students(id) ON DELETE CASCADE,
  old_email           VARCHAR(255) NOT NULL,
  requested_new_email VARCHAR(255) NOT NULL,
  reason              TEXT,
  status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by         INTEGER REFERENCES students(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  review_note         TEXT,
  request_ip          VARCHAR(64),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_change_requests_status
  ON email_change_requests(status);
CREATE INDEX IF NOT EXISTS idx_email_change_requests_student
  ON email_change_requests(student_id);
