/**
 * Migration: Refactor Billing to Transactions
 *
 * This migration:
 * 1. Renames `amount` column to `cost` in transactions table
 * 2. Adds `markup_percent`, `markup_amount`, `charge` columns to transactions
 * 3. Drops all billing_* tables (they're deprecated and superseded by transactions)
 *
 * Run with: node scripts/migrations/001-refactor-billing-to-transactions.js
 *
 * IMPORTANT: This is a destructive migration. Back up your database first!
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function runMigration() {
  console.log('='.repeat(70))
  console.log('MIGRATION: Refactor Billing to Transactions')
  console.log('='.repeat(70))
  console.log('')

  // Step 1: Check current state
  console.log('Step 1: Checking current state...')

  const { data: txSample } = await supabase
    .from('transactions')
    .select('*')
    .limit(1)

  const hasAmountColumn = txSample && txSample[0] && 'amount' in txSample[0]
  const hasCostColumn = txSample && txSample[0] && 'cost' in txSample[0]
  const hasMarkupColumns = txSample && txSample[0] && 'markup_percent' in txSample[0]

  console.log('  - Has amount column:', hasAmountColumn)
  console.log('  - Has cost column:', hasCostColumn)
  console.log('  - Has markup columns:', hasMarkupColumns)

  if (hasCostColumn && hasMarkupColumns) {
    console.log('\n✓ Migration appears to already be applied.')
    console.log('  Skipping column changes.')
  } else {
    // Step 2: Rename amount to cost and add new columns
    // Note: Supabase doesn't support ALTER TABLE via JS client
    // We'll need to use the SQL editor or direct connection
    console.log('\nStep 2: Column changes required!')
    console.log('')
    console.log('Please run the following SQL in the Supabase SQL Editor:')
    console.log('')
    console.log('-'.repeat(70))
    console.log(`
-- Step 1: Rename amount to cost
ALTER TABLE transactions RENAME COLUMN amount TO cost;

-- Step 2: Add markup and charge columns
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS markup_percent NUMERIC(5,4);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS markup_amount NUMERIC(12,2);
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS charge NUMERIC(12,2);

-- Step 3: Add comments for documentation
COMMENT ON COLUMN transactions.cost IS 'Our cost for this transaction (from ShipBob)';
COMMENT ON COLUMN transactions.markup_percent IS 'Percentage markup applied (e.g., 0.15 = 15%)';
COMMENT ON COLUMN transactions.markup_amount IS 'Flat markup amount applied (used instead of percent for some fee types)';
COMMENT ON COLUMN transactions.charge IS 'Total amount we charge the client (cost + markup)';

-- Step 4: Create index for charge column (used in invoice queries)
CREATE INDEX IF NOT EXISTS idx_transactions_charge ON transactions(charge) WHERE charge IS NOT NULL;
`)
    console.log('-'.repeat(70))
    console.log('')
  }

  // Step 3: Show billing_* table counts before deletion
  console.log('\nStep 3: Checking billing_* tables to be deleted...')

  const billingTables = [
    'billing_shipments',
    'billing_storage',
    'billing_returns',
    'billing_receiving',
    'billing_credits',
    'billing_shipment_fees'
  ]

  const tableCounts = {}
  for (const table of billingTables) {
    const { count, error } = await supabase
      .from(table)
      .select('*', { count: 'exact', head: true })

    if (error) {
      tableCounts[table] = `ERROR: ${error.message}`
    } else {
      tableCounts[table] = count
    }
  }

  console.log('\nTable row counts:')
  for (const [table, count] of Object.entries(tableCounts)) {
    console.log(`  ${table}: ${count}`)
  }

  console.log('')
  console.log('To delete these tables, run the following SQL:')
  console.log('')
  console.log('-'.repeat(70))
  console.log(`
-- WARNING: This is destructive! Make sure you have backups!

-- Drop billing_* tables (they are superseded by transactions table)
DROP TABLE IF EXISTS billing_shipment_fees CASCADE;
DROP TABLE IF EXISTS billing_shipments CASCADE;
DROP TABLE IF EXISTS billing_storage CASCADE;
DROP TABLE IF EXISTS billing_returns CASCADE;
DROP TABLE IF EXISTS billing_receiving CASCADE;
DROP TABLE IF EXISTS billing_credits CASCADE;
`)
  console.log('-'.repeat(70))
  console.log('')

  // Step 4: Verify transactions table has the data we need
  console.log('\nStep 4: Verifying transactions table coverage...')

  const { count: totalTx } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })

  const { count: attributedTx } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .not('client_id', 'is', null)

  console.log(`  Total transactions: ${totalTx}`)
  console.log(`  Attributed to clients: ${attributedTx}`)
  console.log(`  Unattributed: ${totalTx - attributedTx}`)

  // Check transaction types coverage
  const { data: feeTypes } = await supabase
    .from('transactions')
    .select('transaction_fee')
    .not('client_id', 'is', null)

  const feeTypeCounts = {}
  for (const row of feeTypes || []) {
    const fee = row.transaction_fee || 'NULL'
    feeTypeCounts[fee] = (feeTypeCounts[fee] || 0) + 1
  }

  console.log('\n  Transaction fee types (attributed):')
  const sortedFees = Object.entries(feeTypeCounts).sort((a, b) => b[1] - a[1])
  for (const [fee, count] of sortedFees.slice(0, 15)) {
    console.log(`    ${fee}: ${count}`)
  }
  if (sortedFees.length > 15) {
    console.log(`    ... and ${sortedFees.length - 15} more fee types`)
  }

  console.log('')
  console.log('='.repeat(70))
  console.log('MIGRATION INSTRUCTIONS COMPLETE')
  console.log('='.repeat(70))
  console.log('')
  console.log('After running the SQL above:')
  console.log('1. Update all code references from "amount" to "cost"')
  console.log('2. Update invoice-generator.ts to use transactions table')
  console.log('3. Update CLAUDE.billing.md documentation')
  console.log('')
}

runMigration().catch(console.error)
