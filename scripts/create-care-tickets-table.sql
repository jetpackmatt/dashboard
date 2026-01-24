-- Run this in the Supabase SQL Editor: https://supabase.com/dashboard/project/xhehiuanvcowiktcsmjr/sql/new
-- This creates the care_tickets table for the Jetpack Care support system

-- Create care_tickets table for Jetpack Care support system
CREATE TABLE IF NOT EXISTS care_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Core fields
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  ticket_number SERIAL UNIQUE,  -- Human-readable ticket ID (auto-increment)

  -- Ticket classification
  ticket_type TEXT NOT NULL CHECK (ticket_type IN ('Claim', 'Work Order', 'Technical', 'Inquiry')),
  issue_type TEXT CHECK (issue_type IN ('Loss', 'Damage', 'Pick Error', 'Short Ship', 'Other')),
  status TEXT NOT NULL DEFAULT 'Input Required' CHECK (status IN ('Input Required', 'Under Review', 'Credit Requested', 'Credit Approved', 'Resolved')),

  -- Assignment
  manager TEXT,  -- Name of Care team member managing this ticket
  created_by UUID REFERENCES auth.users(id),  -- User who created the ticket

  -- Order/shipment details
  order_id TEXT,
  shipment_id TEXT,
  ship_date DATE,
  carrier TEXT,
  tracking_number TEXT,

  -- Claim-specific fields
  reshipment_status TEXT CHECK (reshipment_status IN ('Please reship for me', 'I''ve already reshipped', 'Don''t reship')),
  what_to_reship TEXT,
  reshipment_id TEXT,
  compensation_request TEXT CHECK (compensation_request IN ('Credit to account', 'Free replacement', 'Refund to payment method')),

  -- Credit/financial
  credit_amount DECIMAL(10,2) DEFAULT 0,
  currency TEXT DEFAULT 'USD' CHECK (currency IN ('USD', 'CAD')),

  -- Work order / technical fields
  work_order_id TEXT,
  inventory_id TEXT,

  -- Description and notes
  description TEXT,
  internal_notes TEXT,  -- Care team only notes (not visible to clients)

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_care_tickets_client_id ON care_tickets(client_id);
CREATE INDEX IF NOT EXISTS idx_care_tickets_status ON care_tickets(status);
CREATE INDEX IF NOT EXISTS idx_care_tickets_created_at ON care_tickets(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_care_tickets_ticket_number ON care_tickets(ticket_number);

-- Enable RLS
ALTER TABLE care_tickets ENABLE ROW LEVEL SECURITY;

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_care_tickets_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- Create trigger
DROP TRIGGER IF EXISTS care_tickets_updated_at ON care_tickets;
CREATE TRIGGER care_tickets_updated_at
  BEFORE UPDATE ON care_tickets
  FOR EACH ROW
  EXECUTE FUNCTION update_care_tickets_updated_at();
