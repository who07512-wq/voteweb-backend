-- Migration: Create announcements table
-- For election announcements that admins can create and manage

CREATE TABLE IF NOT EXISTS announcements (
  id SERIAL PRIMARY KEY,
  election_id INTEGER REFERENCES elections(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  audience VARCHAR(50) NOT NULL DEFAULT 'all',
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  is_published BOOLEAN NOT NULL DEFAULT false,
  published_at TIMESTAMP WITH TIME ZONE,
  created_by INTEGER REFERENCES students(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fetching published announcements
CREATE INDEX IF NOT EXISTS idx_announcements_published ON announcements(is_published) WHERE is_published = true;

-- Index for fetching by election
CREATE INDEX IF NOT EXISTS idx_announcements_election ON announcements(election_id);

-- Index for fetching recent first
CREATE INDEX IF NOT EXISTS idx_announcements_recent ON announcements(created_at DESC);

COMMENT ON TABLE announcements IS 'Election announcements managed by admins';
COMMENT ON COLUMN announcements.audience IS 'Target audience: all, students, candidates, admins';
COMMENT ON COLUMN announcements.priority IS 'Priority level: low, normal, high, urgent';
