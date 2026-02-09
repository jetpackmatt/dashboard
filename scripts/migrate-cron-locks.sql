-- Create cron_locks table for distributed locking
-- Prevents overlapping cron executions that exhaust database connections

CREATE TABLE IF NOT EXISTS cron_locks (
  job_name TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  locked_by TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

-- Index for cleanup queries
CREATE INDEX IF NOT EXISTS idx_cron_locks_expires_at ON cron_locks(expires_at);

-- Enable RLS (even though only service_role will access)
ALTER TABLE cron_locks ENABLE ROW LEVEL SECURITY;

-- Add comment
COMMENT ON TABLE cron_locks IS 'Distributed locks for cron jobs to prevent overlapping executions';
COMMENT ON COLUMN cron_locks.job_name IS 'Unique identifier for the cron job (e.g., sync-timelines)';
COMMENT ON COLUMN cron_locks.locked_by IS 'Instance ID that acquired the lock';
COMMENT ON COLUMN cron_locks.expires_at IS 'When the lock expires (safety mechanism for crashed jobs)';
