/**
 * Migration: Fix Sync Fields
 *
 * ORDERS:
 * - Add `tags` column (text[] array)
 *
 * SHIPMENTS:
 * - Add `sb_last_update_at` (rename existing last_update_at thinking)
 * - Remove `invoice_amount`, `invoice_currency_code` (API doesn't return these)
 * - Remove `gift_message` (use from orders table)
 *
 * TRANSACTIONS:
 * - Rename `invoice_date` to `invoice_date_sb`
 * - Add `invoice_date_jp`
 * - Remove `tracking_id` (in additional_details)
 * - Remove `raw_data` (legacy)
 * - Ensure `transaction_type` is being synced
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(70))
  console.log('SYNC FIELDS MIGRATION')
  console.log('='.repeat(70))

  // Check current state
  console.log('\nChecking current schema...')

  // Test if tags column exists
  const { error: tagsErr } = await supabase.from('orders').select('tags').limit(1)
  const tagsExists = !tagsErr || !tagsErr.message.includes('does not exist')
  console.log('orders.tags exists:', tagsExists)

  // Test if sb_last_update_at exists
  const { error: sbLastErr } = await supabase.from('shipments').select('sb_last_update_at').limit(1)
  const sbLastExists = !sbLastErr || !sbLastErr.message.includes('does not exist')
  console.log('shipments.sb_last_update_at exists:', sbLastExists)

  // Test if invoice_date_sb exists
  const { error: invDateErr } = await supabase.from('transactions').select('invoice_date_sb').limit(1)
  const invDateSbExists = !invDateErr || !invDateErr.message.includes('does not exist')
  console.log('transactions.invoice_date_sb exists:', invDateSbExists)

  console.log('\n' + '='.repeat(70))
  console.log('SQL MIGRATIONS TO RUN')
  console.log('='.repeat(70))

  console.log(`
-- ORDERS TABLE
${!tagsExists ? "ALTER TABLE orders ADD COLUMN IF NOT EXISTS tags text[];" : "-- tags column already exists"}

-- SHIPMENTS TABLE
${!sbLastExists ? "ALTER TABLE shipments ADD COLUMN IF NOT EXISTS sb_last_update_at timestamptz;" : "-- sb_last_update_at already exists"}
-- Note: Keep invoice_amount/currency_code for now (may be useful later)
-- Note: Keep gift_message in shipments (different value than order-level)

-- TRANSACTIONS TABLE
${!invDateSbExists ? `
ALTER TABLE transactions RENAME COLUMN invoice_date TO invoice_date_sb;
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS invoice_date_jp timestamptz;
` : "-- invoice_date_sb already exists"}
-- Note: Keep tracking_id and raw_data for backward compatibility
-- They're not used but removing columns is risky

-- Verify changes
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'orders' AND column_name = 'tags';

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'shipments' AND column_name = 'sb_last_update_at';

SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'transactions' AND column_name IN ('invoice_date_sb', 'invoice_date_jp');
`)

  console.log('\n' + '='.repeat(70))
  console.log('APPLYING MIGRATIONS VIA SUPABASE...')
  console.log('='.repeat(70))

  // We can't run ALTER TABLE directly via supabase-js
  // These need to be run via Supabase Dashboard SQL Editor
  console.log('\nPlease run the above SQL in Supabase Dashboard SQL Editor.')
  console.log('After that, we can update the sync module.')
}

main().catch(console.error)
