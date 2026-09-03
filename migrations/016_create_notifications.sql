-- Migration: Create notifications table
-- For user notifications (read receipts, election updates, etc.)

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES students(id) ON DELETE CASCADE,
  type VARCHAR(20) NOT NULL DEFAULT 'info',
  category VARCHAR(30) NOT NULL DEFAULT 'system',
  priority VARCHAR(20) NOT NULL DEFAULT 'normal',
  title VARCHAR(255) NOT NULL,
  message TEXT,
  action_url VARCHAR(255),
  action_label VARCHAR(100),
  is_read BOOLEAN NOT NULL DEFAULT false,
  read_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Index for fetching user's unread notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id, is_read) WHERE is_read = false;

-- Index for listing user's notifications
CREATE INDEX IF NOT EXISTS idx_notifications_user_recent ON notifications(user_id, created_at DESC);

COMMENT ON TABLE notifications IS 'User notifications for votes, elections, etc.';
COMMENT ON COLUMN notifications.type IS 'UI type: success, info, warning, error';
COMMENT ON COLUMN notifications.category IS 'Category: voting, election, candidate, support, account, system, results';
