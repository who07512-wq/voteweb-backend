-- Migration: 008_audit_logs.sql
-- Creates audit_logs table for tracking administrative and system actions

CREATE TABLE IF NOT EXISTS audit_logs (
    id SERIAL PRIMARY KEY,
    -- Who performed the action
    -- NULL for system-initiated actions
    actor_id INTEGER REFERENCES students(id) ON DELETE SET NULL,
    actor_type VARCHAR(50) NOT NULL DEFAULT 'USER',
    -- What action was performed
    action VARCHAR(100) NOT NULL,
    -- What entity type was affected
    entity_type VARCHAR(100),
    -- What entity ID was affected
    entity_id INTEGER,
    -- Additional context as JSONB
    metadata JSONB,
    -- IP address of the requestor (for audit trail)
    ip_address INET,
    -- When the action occurred
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

    -- Index for querying by action type
    CONSTRAINT audit_logs_actor_type_check CHECK (
        actor_type IN ('USER', 'ADMIN', 'SYSTEM')
    )
);

-- Index for actor queries (who did what)
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_id ON audit_logs(actor_id);

-- Index for action type queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action);

-- Index for entity queries (what was affected)
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity ON audit_logs(entity_type, entity_id);

-- Index for time-based queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Composite index for common query patterns
CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_time ON audit_logs(actor_id, created_at DESC);

COMMENT ON TABLE audit_logs IS 'Audit trail for administrative and system actions';
COMMENT ON COLUMN audit_logs.actor_type IS 'USER: regular user action, ADMIN: admin action, SYSTEM: automated system action';
COMMENT ON COLUMN audit_logs.metadata IS 'JSONB field for flexible additional context';
