#!/usr/bin/env node
/**
 * Migrate billing_shipments unique constraint
 *
 * Problem: The old constraint (client_id, order_id) was wrong because:
 *   - Multiple shipments can have the same order_id (multi-package orders)
 *   - Both Charge and Refund rows can exist for the same order_id
 *   - Result: Refunds were overwriting Charges during import
 *
 * Solution: New constraint (client_id, shipment_id, transaction_type, invoice_number)
 *   - shipment_id (TrackingId) is unique per physical shipment
 *   - A shipment can have one Charge and one Refund
 *   - invoice_number distinguishes adjustments/corrections
 *
 * This script:
 *   1. Drops the old unique constraint
 *   2. Creates the new unique constraint
 *   3. Truncates the table
 *   4. The import script must then be re-run
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function migrate() {
  console.log('='.repeat(60))
  console.log('BILLING_SHIPMENTS UNIQUE KEY MIGRATION')
  console.log('='.repeat(60))

  const dryRun = process.argv.includes('--dry-run')
  if (dryRun) {
    console.log('\n[DRY RUN MODE - No changes will be made]\n')
  }

  // Step 1: Check current state
  console.log('\n1. Checking current table state...')
  const { count, error: countError } = await supabase
    .from('billing_shipments')
    .select('*', { count: 'exact', head: true })

  if (countError) {
    console.error('Error checking table:', countError)
    return
  }
  console.log(`   Current row count: ${count}`)

  // Step 2: Drop old constraint
  console.log('\n2. Dropping old unique constraint (client_id, order_id)...')
  if (!dryRun) {
    const { error: dropError } = await supabase.rpc('exec_sql', {
      sql: 'ALTER TABLE billing_shipments DROP CONSTRAINT IF EXISTS billing_shipments_client_id_order_id_key'
    })
    if (dropError) {
      // Try direct SQL if RPC doesn't exist
      console.log('   Note: exec_sql RPC not available, constraint will be dropped manually')
      console.log('   Run this SQL in Supabase dashboard:')
      console.log('   ALTER TABLE billing_shipments DROP CONSTRAINT IF EXISTS billing_shipments_client_id_order_id_key;')
    } else {
      console.log('   Done')
    }
  } else {
    console.log('   [DRY RUN] Would drop constraint')
  }

  // Step 3: Create new constraint
  console.log('\n3. Creating new unique constraint (client_id, shipment_id, transaction_type, invoice_number)...')
  if (!dryRun) {
    const { error: createError } = await supabase.rpc('exec_sql', {
      sql: `ALTER TABLE billing_shipments
            ADD CONSTRAINT billing_shipments_unique_key
            UNIQUE (client_id, shipment_id, transaction_type, invoice_number)`
    })
    if (createError) {
      console.log('   Note: exec_sql RPC not available, constraint will be created manually')
      console.log('   Run this SQL in Supabase dashboard:')
      console.log('   ALTER TABLE billing_shipments ADD CONSTRAINT billing_shipments_unique_key UNIQUE (client_id, shipment_id, transaction_type, invoice_number);')
    } else {
      console.log('   Done')
    }
  } else {
    console.log('   [DRY RUN] Would create constraint')
  }

  // Step 4: Truncate table
  console.log('\n4. Truncating billing_shipments table...')
  if (!dryRun) {
    const { error: truncateError } = await supabase
      .from('billing_shipments')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000') // Delete all rows

    if (truncateError) {
      console.error('   Error truncating:', truncateError)
    } else {
      console.log('   Done')
    }
  } else {
    console.log('   [DRY RUN] Would truncate table')
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('MIGRATION COMPLETE')
  console.log('='.repeat(60))
  console.log('\nNext steps:')
  console.log('  1. If constraints were not modified via RPC, run the SQL manually in Supabase dashboard')
  console.log('  2. Run the import script: node scripts/import-billing-xlsx.js')
  console.log('  3. Verify row count matches Excel (73,666 rows)')

  if (dryRun) {
    console.log('\n[DRY RUN] No changes were made. Run without --dry-run to execute.')
  }
}

migrate().catch(console.error)
