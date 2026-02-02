-- Migration: Create tracking_checkpoints table for permanent checkpoint storage
-- Purpose: Store ALL TrackingMore checkpoints permanently for survival analysis
--
-- IMPORTANT: TrackingMore data expires after ~4 months, but our stored data persists forever.
-- This table is the foundation for Tier 2 data in the Delivery Intelligence Engine.

-- Create the tracking_checkpoints table
CREATE TABLE IF NOT EXISTS tracking_checkpoints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- SHIPMENT REFERENCE
  shipment_id TEXT NOT NULL,  -- Links to shipments.shipment_id
  tracking_number TEXT NOT NULL,
  carrier TEXT NOT NULL,
  carrier_code TEXT,  -- TrackingMore carrier code (e.g., 'usps', 'fedex')

  -- RAW CHECKPOINT DATA (from TrackingMore)
  checkpoint_date TIMESTAMPTZ NOT NULL,
  raw_description TEXT NOT NULL,
  raw_location TEXT,
  raw_status TEXT,  -- checkpoint_delivery_status from TrackingMore
  raw_substatus TEXT,  -- checkpoint_delivery_substatus from TrackingMore

  -- AI-NORMALIZED FIELDS (populated by Gemini)
  normalized_type TEXT,  -- 12 types: LABEL, PICKUP, INTRANSIT, HUB, LOCAL, OFD, DELIVERED, ATTEMPT, EXCEPTION, RETURN, CUSTOMS, HOLD
  display_title TEXT,  -- Clean, human-readable title
  sentiment TEXT,  -- positive, neutral, concerning, critical

  -- DEDUPLICATION
  content_hash TEXT UNIQUE,  -- SHA256(carrier + date + description + location) for dedup

  -- METADATA
  source TEXT DEFAULT 'trackingmore',  -- trackingmore, aftership, manual
  fetched_at TIMESTAMPTZ DEFAULT NOW(),
  normalized_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for efficient queries
CREATE INDEX IF NOT EXISTS idx_tc_shipment_id ON tracking_checkpoints(shipment_id);
CREATE INDEX IF NOT EXISTS idx_tc_tracking_number ON tracking_checkpoints(tracking_number);
CREATE INDEX IF NOT EXISTS idx_tc_checkpoint_date ON tracking_checkpoints(checkpoint_date);
CREATE INDEX IF NOT EXISTS idx_tc_carrier ON tracking_checkpoints(carrier);
CREATE INDEX IF NOT EXISTS idx_tc_normalized_type ON tracking_checkpoints(normalized_type);
CREATE INDEX IF NOT EXISTS idx_tc_unnormalized ON tracking_checkpoints(shipment_id) WHERE normalized_type IS NULL;

-- Composite index for timeline queries (get all checkpoints for a shipment, ordered by date)
CREATE INDEX IF NOT EXISTS idx_tc_shipment_timeline ON tracking_checkpoints(shipment_id, checkpoint_date DESC);

-- Enable RLS
ALTER TABLE tracking_checkpoints ENABLE ROW LEVEL SECURITY;

-- RLS policy: Allow service role full access (our cron jobs and API routes use service role)
CREATE POLICY "Service role can manage tracking_checkpoints" ON tracking_checkpoints
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Comments for documentation
COMMENT ON TABLE tracking_checkpoints IS 'Permanent storage for TrackingMore carrier checkpoints. Tier 2 data for Delivery Intelligence Engine.';
COMMENT ON COLUMN tracking_checkpoints.content_hash IS 'SHA256(carrier + checkpoint_date + raw_description + raw_location) for deduplication';
COMMENT ON COLUMN tracking_checkpoints.normalized_type IS 'AI-normalized scan type: LABEL, PICKUP, INTRANSIT, HUB, LOCAL, OFD, DELIVERED, ATTEMPT, EXCEPTION, RETURN, CUSTOMS, HOLD';
COMMENT ON COLUMN tracking_checkpoints.sentiment IS 'AI-assigned sentiment: positive, neutral, concerning, critical';
