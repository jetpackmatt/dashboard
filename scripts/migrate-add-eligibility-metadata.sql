-- Migration: Add eligibility_metadata column to care_tickets
-- Run this in Supabase SQL Editor

ALTER TABLE care_tickets ADD COLUMN IF NOT EXISTS eligibility_metadata JSONB DEFAULT NULL;

COMMENT ON COLUMN care_tickets.eligibility_metadata IS 'Audit trail of claim eligibility data at time of submission';
