-- Migration: Add lost_in_transit_checks table
-- Purpose: Track AfterShip verification attempts to prevent redundant API calls
-- Run this in Supabase SQL Editor

-- Create the table to track Lost in Transit verification attempts
CREATE TABLE IF NOT EXISTS lost_in_transit_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shipment_id TEXT NOT NULL,
  tracking_number TEXT NOT NULL,
  carrier TEXT,

  -- When the check was performed
  checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The calculated date when they CAN file (last_scan_date + 15/20 days)
  eligible_after DATE NOT NULL,

  -- AfterShip response data
  last_scan_date TIMESTAMPTZ,
  last_scan_description TEXT,
  last_scan_location TEXT,

  -- Shipment context
  is_international BOOLEAN NOT NULL DEFAULT FALSE,

  -- Who requested the check
  created_by UUID REFERENCES auth.users(id),
  client_id UUID REFERENCES clients(id),

  -- Only keep most recent check per shipment (upsert pattern)
  UNIQUE(shipment_id)
);

-- Index for quick lookups
CREATE INDEX IF NOT EXISTS idx_lost_in_transit_checks_shipment
  ON lost_in_transit_checks(shipment_id);

CREATE INDEX IF NOT EXISTS idx_lost_in_transit_checks_client
  ON lost_in_transit_checks(client_id);

CREATE INDEX IF NOT EXISTS idx_lost_in_transit_checks_eligible_after
  ON lost_in_transit_checks(eligible_after);

-- Enable RLS
ALTER TABLE lost_in_transit_checks ENABLE ROW LEVEL SECURITY;

-- RLS policies: Users can only see checks for their clients
CREATE POLICY "Users can view their client's checks"
  ON lost_in_transit_checks
  FOR SELECT
  USING (
    client_id IN (
      SELECT client_id FROM user_clients WHERE user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
      AND raw_user_meta_data->>'role' = 'admin'
    )
  );

-- Allow inserts for authenticated users (API will validate access)
CREATE POLICY "Authenticated users can insert checks"
  ON lost_in_transit_checks
  FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow updates for authenticated users (API will validate access)
CREATE POLICY "Authenticated users can update checks"
  ON lost_in_transit_checks
  FOR UPDATE
  USING (auth.uid() IS NOT NULL);

-- Add comment
COMMENT ON TABLE lost_in_transit_checks IS
  'Tracks AfterShip verification attempts for Lost in Transit claims to prevent redundant API calls';
