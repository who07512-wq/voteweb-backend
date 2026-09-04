-- 025: Student Access Request system
--
-- Spec: invite-only voting + public "Request Voting Access" pipeline.
-- Identity rules: one student_id = one account = one voting right.
-- voting_eligible is admin-controlled; pending/rejected requesters have no
-- usable login; approved students get is_active + voting_eligible = TRUE.

-- ---- 1. Students: extra identity + eligibility columns ----
ALTER TABLE students ADD COLUMN IF NOT EXISTS roll_number VARCHAR(64);
ALTER TABLE students ADD COLUMN IF NOT EXISTS department VARCHAR(120);
ALTER TABLE students ADD COLUMN IF NOT EXISTS year_or_semester VARCHAR(40);
ALTER TABLE students ADD COLUMN IF NOT EXISTS voting_eligible BOOLEAN;

-- Backfill: existing real accounts (Google-verified, invite-only) are voters
UPDATE students SET voting_eligible = TRUE WHERE voting_eligible IS NULL AND is_active = TRUE;
ALTER TABLE students ALTER COLUMN voting_eligible SET DEFAULT FALSE;
ALTER TABLE students ALTER COLUMN voting_eligible SET NOT NULL;

-- ---- 2. Access requests ----
CREATE TABLE IF NOT EXISTS student_access_requests (
  id               SERIAL PRIMARY KEY,
  full_name        VARCHAR(255) NOT NULL,
  student_id       VARCHAR(64)  NOT NULL,
  roll_number      VARCHAR(64),
  department       VARCHAR(120),
  year_or_semester VARCHAR(40),
  college_email    VARCHAR(255) NOT NULL,
  accessible_email VARCHAR(255) NOT NULL,
  request_reason   VARCHAR(40)  NOT NULL DEFAULT 'other'
                   CHECK (request_reason IN ('not_in_list','cannot_access_email','incorrect_email','other')),
  reason_detail    TEXT,
  status           VARCHAR(20)  NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','approved','rejected')),
  rejection_reason TEXT,
  reviewed_by      INTEGER REFERENCES students(id) ON DELETE SET NULL,
  reviewed_at      TIMESTAMPTZ,
  created_student  INTEGER REFERENCES students(id) ON DELETE SET NULL,
  request_ip       VARCHAR(64),
  created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sar_status ON student_access_requests(status);
CREATE INDEX IF NOT EXISTS idx_sar_student_id ON student_access_requests(student_id);
CREATE INDEX IF NOT EXISTS idx_sar_accessible_email ON student_access_requests(LOWER(accessible_email));
CREATE INDEX IF NOT EXISTS idx_sar_college_email ON student_access_requests(LOWER(college_email));
