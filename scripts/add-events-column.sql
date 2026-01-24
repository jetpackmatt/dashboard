-- Add events JSON column to care_tickets table
-- Events structure: [{ status, note, createdAt, createdBy }]

ALTER TABLE care_tickets
ADD COLUMN IF NOT EXISTS events JSONB DEFAULT '[]'::jsonb;

-- Add comment describing the structure
COMMENT ON COLUMN care_tickets.events IS 'Array of event objects: [{ status: string, note: string, createdAt: ISO timestamp, createdBy: string (user name or email) }]';
