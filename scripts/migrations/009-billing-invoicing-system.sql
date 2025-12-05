-- Migration 009: Billing & Invoicing System
-- Date: December 3, 2025
-- Description: Sets up markup tracking, Jetpack invoices, and client billing fields

-- ============================================
-- 1. Rename existing invoices table for clarity
-- ============================================
ALTER TABLE invoices RENAME TO invoices_shipbob;

-- ============================================
-- 2. Add billing fields to clients table
-- ============================================
ALTER TABLE clients ADD COLUMN IF NOT EXISTS short_code TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_period TEXT DEFAULT 'weekly';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_terms TEXT DEFAULT 'due_on_receipt';
ALTER TABLE clients ADD COLUMN IF NOT EXISTS invoice_email_note TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS next_invoice_number INTEGER DEFAULT 1;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS billing_email TEXT;

-- Add constraint for billing_period values
ALTER TABLE clients ADD CONSTRAINT clients_billing_period_check
  CHECK (billing_period IN ('weekly', 'bi-weekly', 'tri-weekly', 'monthly'));

-- Add constraint for billing_terms values
ALTER TABLE clients ADD CONSTRAINT clients_billing_terms_check
  CHECK (billing_terms IN ('due_on_receipt', '7_days', '14_days', '30_days'));

-- Backfill existing clients
UPDATE clients SET short_code = 'HS', next_invoice_number = 38 WHERE company_name ILIKE '%henson%';
UPDATE clients SET short_code = 'ML', next_invoice_number = 22 WHERE company_name ILIKE '%methyl%';

-- ============================================
-- 3. Add markup columns to all billing tables
-- ============================================

-- billing_shipments
ALTER TABLE billing_shipments ADD COLUMN IF NOT EXISTS billed_amount DECIMAL(10,2);
ALTER TABLE billing_shipments ADD COLUMN IF NOT EXISTS markup_rule_id UUID REFERENCES markup_rules(id);
ALTER TABLE billing_shipments ADD COLUMN IF NOT EXISTS markup_percentage DECIMAL(5,2);

-- billing_shipment_fees
ALTER TABLE billing_shipment_fees ADD COLUMN IF NOT EXISTS billed_amount DECIMAL(10,2);
ALTER TABLE billing_shipment_fees ADD COLUMN IF NOT EXISTS markup_rule_id UUID REFERENCES markup_rules(id);
ALTER TABLE billing_shipment_fees ADD COLUMN IF NOT EXISTS markup_percentage DECIMAL(5,2);

-- billing_storage
ALTER TABLE billing_storage ADD COLUMN IF NOT EXISTS billed_amount DECIMAL(10,2);
ALTER TABLE billing_storage ADD COLUMN IF NOT EXISTS markup_rule_id UUID REFERENCES markup_rules(id);
ALTER TABLE billing_storage ADD COLUMN IF NOT EXISTS markup_percentage DECIMAL(5,2);

-- billing_credits
ALTER TABLE billing_credits ADD COLUMN IF NOT EXISTS billed_amount DECIMAL(10,2);
ALTER TABLE billing_credits ADD COLUMN IF NOT EXISTS markup_rule_id UUID REFERENCES markup_rules(id);
ALTER TABLE billing_credits ADD COLUMN IF NOT EXISTS markup_percentage DECIMAL(5,2);

-- billing_returns
ALTER TABLE billing_returns ADD COLUMN IF NOT EXISTS billed_amount DECIMAL(10,2);
ALTER TABLE billing_returns ADD COLUMN IF NOT EXISTS markup_rule_id UUID REFERENCES markup_rules(id);
ALTER TABLE billing_returns ADD COLUMN IF NOT EXISTS markup_percentage DECIMAL(5,2);

-- billing_receiving
ALTER TABLE billing_receiving ADD COLUMN IF NOT EXISTS billed_amount DECIMAL(10,2);
ALTER TABLE billing_receiving ADD COLUMN IF NOT EXISTS markup_rule_id UUID REFERENCES markup_rules(id);
ALTER TABLE billing_receiving ADD COLUMN IF NOT EXISTS markup_percentage DECIMAL(5,2);

-- ============================================
-- 4. Create markup rule history table
-- ============================================
CREATE TABLE IF NOT EXISTS markup_rule_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  markup_rule_id UUID NOT NULL REFERENCES markup_rules(id) ON DELETE CASCADE,
  changed_by UUID,  -- References auth.users but no FK to avoid cross-schema issues
  change_type TEXT NOT NULL CHECK (change_type IN ('created', 'updated', 'deactivated')),
  previous_values JSONB,
  new_values JSONB,
  change_reason TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE markup_rule_history ENABLE ROW LEVEL SECURITY;

-- Index for efficient lookups
CREATE INDEX IF NOT EXISTS idx_markup_rule_history_rule_id ON markup_rule_history(markup_rule_id);
CREATE INDEX IF NOT EXISTS idx_markup_rule_history_changed_at ON markup_rule_history(changed_at DESC);

-- ============================================
-- 5. Create Jetpack invoices table
-- ============================================
CREATE TABLE IF NOT EXISTS invoices_jetpack (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,

  -- Invoice identification
  invoice_number TEXT NOT NULL UNIQUE,  -- JPHS-0038-120825
  invoice_date DATE NOT NULL,

  -- Billing period (week ending Sunday)
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,

  -- Amounts
  subtotal DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_markup DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,

  -- File storage paths (Supabase Storage)
  pdf_path TEXT,
  xlsx_path TEXT,

  -- Workflow status
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'regenerated', 'sent')),
  generated_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by UUID,  -- References auth.users
  approved_at TIMESTAMPTZ,
  approval_notes TEXT,

  -- Regeneration tracking
  version INTEGER DEFAULT 1,
  replaced_by UUID REFERENCES invoices_jetpack(id),
  regeneration_locked_at TIMESTAMPTZ,  -- Set to generated_at + 24 hours

  -- Email tracking
  email_sent_at TIMESTAMPTZ,
  email_error TEXT,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Unique constraint: one invoice per client per week (by period_start)
  CONSTRAINT invoices_jetpack_client_period_unique UNIQUE (client_id, period_start, version)
);

-- Enable RLS
ALTER TABLE invoices_jetpack ENABLE ROW LEVEL SECURITY;

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_invoices_jetpack_client_id ON invoices_jetpack(client_id);
CREATE INDEX IF NOT EXISTS idx_invoices_jetpack_status ON invoices_jetpack(status);
CREATE INDEX IF NOT EXISTS idx_invoices_jetpack_invoice_date ON invoices_jetpack(invoice_date DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_jetpack_period ON invoices_jetpack(period_start, period_end);

-- ============================================
-- 6. Create Jetpack invoice line items table
-- ============================================
CREATE TABLE IF NOT EXISTS invoices_jetpack_line_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id UUID NOT NULL REFERENCES invoices_jetpack(id) ON DELETE CASCADE,

  -- Source transaction reference
  billing_table TEXT NOT NULL CHECK (billing_table IN (
    'billing_shipments',
    'billing_shipment_fees',
    'billing_storage',
    'billing_credits',
    'billing_returns',
    'billing_receiving'
  )),
  billing_record_id UUID NOT NULL,

  -- Frozen amounts at time of invoicing
  base_amount DECIMAL(10,2) NOT NULL,
  markup_applied DECIMAL(10,2) NOT NULL DEFAULT 0,
  billed_amount DECIMAL(10,2) NOT NULL,
  markup_rule_id UUID REFERENCES markup_rules(id),
  markup_percentage DECIMAL(5,2),

  -- Display categorization
  line_category TEXT NOT NULL CHECK (line_category IN (
    'Fulfillment',
    'Shipping',
    'Pick Fees',
    'B2B Fees',
    'Storage',
    'Returns',
    'Receiving',
    'Credits',
    'Additional Services'
  )),
  description TEXT,

  -- For storage: period tracking
  period_label TEXT,  -- e.g., "Nov 1 - Nov 30, 2025"

  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE invoices_jetpack_line_items ENABLE ROW LEVEL SECURITY;

-- Indexes
CREATE INDEX IF NOT EXISTS idx_invoices_jetpack_line_items_invoice_id ON invoices_jetpack_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoices_jetpack_line_items_billing ON invoices_jetpack_line_items(billing_table, billing_record_id);
CREATE INDEX IF NOT EXISTS idx_invoices_jetpack_line_items_category ON invoices_jetpack_line_items(line_category);

-- ============================================
-- 7. Add billing_category column to markup_rules for cleaner matching
-- ============================================
ALTER TABLE markup_rules ADD COLUMN IF NOT EXISTS billing_category TEXT;
ALTER TABLE markup_rules ADD COLUMN IF NOT EXISTS order_category TEXT;  -- For FBA, VAS matching
ALTER TABLE markup_rules ADD COLUMN IF NOT EXISTS description TEXT;

-- Add constraint for billing_category
ALTER TABLE markup_rules ADD CONSTRAINT markup_rules_billing_category_check
  CHECK (billing_category IS NULL OR billing_category IN (
    'shipments',
    'shipment_fees',
    'storage',
    'credits',
    'returns',
    'receiving'
  ));

-- ============================================
-- 8. Create updated_at trigger function
-- ============================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$;

-- Apply to invoices_jetpack
DROP TRIGGER IF EXISTS invoices_jetpack_updated_at ON invoices_jetpack;
CREATE TRIGGER invoices_jetpack_updated_at
  BEFORE UPDATE ON invoices_jetpack
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 9. Create helper function for next invoice number
-- ============================================
CREATE OR REPLACE FUNCTION get_next_invoice_number(p_client_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_next_number INTEGER;
BEGIN
  -- Atomically get and increment the next invoice number
  UPDATE clients
  SET next_invoice_number = next_invoice_number + 1
  WHERE id = p_client_id
  RETURNING next_invoice_number - 1 INTO v_next_number;

  RETURN v_next_number;
END;
$function$;

-- ============================================
-- 10. Create helper function for invoice number generation
-- ============================================
CREATE OR REPLACE FUNCTION generate_invoice_number(
  p_client_id UUID,
  p_invoice_date DATE,
  p_version INTEGER DEFAULT 1
)
RETURNS TEXT
LANGUAGE plpgsql
SET search_path = public
AS $function$
DECLARE
  v_short_code TEXT;
  v_invoice_num INTEGER;
  v_date_str TEXT;
  v_result TEXT;
BEGIN
  -- Get client short code
  SELECT short_code INTO v_short_code
  FROM clients WHERE id = p_client_id;

  IF v_short_code IS NULL THEN
    RAISE EXCEPTION 'Client % does not have a short_code set', p_client_id;
  END IF;

  -- Get next invoice number
  v_invoice_num := get_next_invoice_number(p_client_id);

  -- Format date as MMDDYY
  v_date_str := TO_CHAR(p_invoice_date, 'MMDDYY');

  -- Build invoice number: JP{SHORT_CODE}-{NNNN}-{MMDDYY}
  v_result := 'JP' || v_short_code || '-' || LPAD(v_invoice_num::TEXT, 4, '0') || '-' || v_date_str;

  -- Add version suffix if > 1
  IF p_version > 1 THEN
    v_result := v_result || '-v' || p_version;
  END IF;

  RETURN v_result;
END;
$function$;

-- ============================================
-- Done!
-- ============================================
COMMENT ON TABLE invoices_jetpack IS 'Jetpack invoices sent to clients (our invoices, not ShipBob)';
COMMENT ON TABLE invoices_jetpack_line_items IS 'Line items linking billing transactions to Jetpack invoices';
COMMENT ON TABLE invoices_shipbob IS 'ShipBob invoices received (their invoices to us)';
COMMENT ON TABLE markup_rule_history IS 'Audit trail for markup rule changes';
