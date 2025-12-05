/**
 * Migration: Rename invoice columns for ShipBob vs Jetpack clarity
 *
 * Changes:
 * - invoiced_status → invoiced_status_sb
 * - invoice_id → invoice_id_sb
 * - Add invoiced_status_jp (boolean)
 * - Add invoice_id_jp (UUID, references invoices_jetpack)
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function migrate() {
  console.log('Starting migration: Rename invoice columns...')

  // Note: Supabase JS client can't run DDL directly
  // We need to run this via SQL in the dashboard or via psql

  const sql = `
-- Step 1: Rename ShipBob invoice columns
ALTER TABLE transactions
  RENAME COLUMN invoiced_status TO invoiced_status_sb;

ALTER TABLE transactions
  RENAME COLUMN invoice_id TO invoice_id_sb;

-- Step 2: Add Jetpack invoice columns
ALTER TABLE transactions
  ADD COLUMN invoiced_status_jp BOOLEAN DEFAULT false;

ALTER TABLE transactions
  ADD COLUMN invoice_id_jp UUID REFERENCES invoices_jetpack(id);

-- Step 3: Add index for Jetpack invoice lookups
CREATE INDEX idx_transactions_invoice_jp ON transactions(invoice_id_jp)
  WHERE invoice_id_jp IS NOT NULL;

-- Step 4: Add index for unbilled transactions (common query)
CREATE INDEX idx_transactions_unbilled_jp ON transactions(invoiced_status_jp)
  WHERE invoiced_status_jp = false;
`

  console.log('='.repeat(60))
  console.log('Run this SQL in Supabase Dashboard → SQL Editor:')
  console.log('='.repeat(60))
  console.log(sql)
  console.log('='.repeat(60))

  // Verify current state
  const { data, error } = await supabase
    .from('transactions')
    .select('invoiced_status, invoice_id')
    .limit(1)

  if (error) {
    if (error.message.includes('invoiced_status')) {
      console.log('\n✓ Columns may already be renamed (invoiced_status not found)')
    } else {
      console.log('\n⚠ Error checking table:', error.message)
    }
  } else {
    console.log('\n⚠ Current columns still exist: invoiced_status, invoice_id')
    console.log('  Run the SQL above to migrate')
  }
}

migrate().catch(console.error)
