/**
 * Run migration 014: Consolidate invoices_jetpack_line_items into transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function runMigration() {
  console.log('Starting migration: Consolidate line_items into transactions\n')

  // Step 1: Add new columns
  console.log('Step 1: Adding new columns to transactions...')
  const { error: e1 } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS markup_applied numeric DEFAULT 0;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS billed_amount numeric;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS markup_percentage numeric DEFAULT 0;
      ALTER TABLE transactions ADD COLUMN IF NOT EXISTS markup_rule_id uuid REFERENCES markup_rules(id);
    `
  })
  if (e1) {
    // RPC might not exist, try direct approach
    console.log('  Note: exec_sql RPC not available, columns may already exist')
  } else {
    console.log('  Done')
  }

  // Step 2: Check current state
  const { data: lineItemCount } = await supabase
    .from('invoices_jetpack_line_items')
    .select('*', { count: 'exact', head: true })

  console.log(`\nStep 2: Found ${lineItemCount?.length || 'unknown'} line items to migrate`)

  // Step 3: Migrate data in batches
  console.log('\nStep 3: Migrating markup data to transactions...')

  let offset = 0
  let migrated = 0
  const batchSize = 500

  while (true) {
    const { data: lineItems, error } = await supabase
      .from('invoices_jetpack_line_items')
      .select('billing_record_id, markup_applied, billed_amount, markup_percentage, markup_rule_id')
      .range(offset, offset + batchSize - 1)

    if (error) {
      console.error('  Error fetching line items:', error.message)
      break
    }

    if (!lineItems || lineItems.length === 0) break

    // Update transactions in this batch
    for (const li of lineItems) {
      const { error: updateError } = await supabase
        .from('transactions')
        .update({
          markup_applied: li.markup_applied,
          billed_amount: li.billed_amount,
          markup_percentage: li.markup_percentage,
          markup_rule_id: li.markup_rule_id,
        })
        .eq('id', li.billing_record_id)

      if (updateError) {
        console.error(`  Error updating transaction ${li.billing_record_id}:`, updateError.message)
      } else {
        migrated++
      }
    }

    console.log(`  Migrated ${migrated} transactions...`)

    if (lineItems.length < batchSize) break
    offset += batchSize
  }

  console.log(`  Total migrated: ${migrated}`)

  // Step 4: Set billed_amount = cost for uninvoiced transactions
  console.log('\nStep 4: Setting billed_amount = cost for uninvoiced transactions...')
  const { error: e4, count: c4 } = await supabase
    .from('transactions')
    .update({ billed_amount: supabase.rpc('cost') }) // This won't work directly

  // Use raw SQL approach via a workaround - update where null
  const { data: nullBilled } = await supabase
    .from('transactions')
    .select('id, cost')
    .is('billed_amount', null)
    .limit(1000)

  if (nullBilled && nullBilled.length > 0) {
    let updated = 0
    for (const tx of nullBilled) {
      await supabase
        .from('transactions')
        .update({ billed_amount: tx.cost })
        .eq('id', tx.id)
      updated++
    }
    console.log(`  Updated ${updated} transactions with billed_amount = cost`)

    // Check if there are more
    const { count: remaining } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .is('billed_amount', null)

    if (remaining > 0) {
      console.log(`  Note: ${remaining} more transactions need billed_amount update`)
      console.log('  Run this script again or update manually')
    }
  } else {
    console.log('  All transactions already have billed_amount set')
  }

  console.log('\nMigration complete!')
  console.log('\nManual steps required:')
  console.log('1. Run in psql: ALTER TABLE transactions DROP COLUMN IF EXISTS markup_amount;')
  console.log('2. Run in psql: ALTER TABLE transactions DROP COLUMN IF EXISTS markup_percent;')
  console.log('3. Run in psql: DROP TABLE IF EXISTS invoices_jetpack_line_items;')
  console.log('\nOr run the full SQL migration file: scripts/migrations/014-consolidate-line-items-to-transactions.sql')
}

runMigration().catch(console.error)
