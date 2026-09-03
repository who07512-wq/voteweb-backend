-- Migration: Create support_requests table
-- For students to submit support/issue tickets

CREATE TABLE IF NOT EXISTS support_requests (
  id SERIAL PRIMARY KEY,
  student_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  election_id INTEGER REFERENCES elections(id) ON DELETE SET NULL,
  category VARCHAR(50) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  description TEXT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open',
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  assigned_to INTEGER REFERENCES students(id) ON DELETE SET NULL,
  response TEXT,
  responded_at TIMESTAMP WITH TIME ZONE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for student looking up their requests
CREATE INDEX IF NOT EXISTS idx_support_requests_student ON support_requests(student_id);

-- Index for admin listing by status
CREATE INDEX IF NOT EXISTS idx_support_requests_status ON support_requests(status);

-- Index for election-specific requests
CREATE INDEX IF NOT EXISTS idx_support_requests_election ON support_requests(election_id);

COMMENT ON TABLE support_requests IS 'Student support and issue tickets';
COMMENT ON COLUMN support_requests.category IS 'Category: login, voting, candidate_info, receipt, technical, account, other';
