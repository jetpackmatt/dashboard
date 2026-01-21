#!/usr/bin/env node
/**
 * Migration: Add markup_is_preview column to transactions table
 *
 * Purpose: Track whether markup values are preview (pre-invoice) or final (invoice-approved)
 *
 * Values:
 *   NULL  = no markup calculated yet (show "-" in UI)
 *   TRUE  = preview markup (calculated before invoicing)
 *   FALSE = final (invoice-approved, authoritative)
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function migrate() {
  console.log('Adding markup_is_preview column to transactions table...')

  // Use RPC to run raw SQL for the ALTER TABLE
  const { error } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE transactions
      ADD COLUMN IF NOT EXISTS markup_is_preview BOOLEAN DEFAULT NULL;

      COMMENT ON COLUMN transactions.markup_is_preview IS
        'NULL = no markup calculated, TRUE = preview (pre-invoice), FALSE = final (invoice approved)';
    `
  })

  if (error) {
    // If exec_sql doesn't exist, try a different approach
    if (error.message.includes('function') && error.message.includes('does not exist')) {
      console.log('exec_sql RPC not available, checking if column already exists...')

      // Check if column exists by trying to select it
      const { data, error: selectError } = await supabase
        .from('transactions')
        .select('markup_is_preview')
        .limit(1)

      if (!selectError) {
        console.log('Column markup_is_preview already exists!')
        return
      }

      if (selectError.message.includes('does not exist')) {
        console.log('\n⚠️  Column does not exist. Please run this SQL in Supabase Dashboard:')
        console.log(`
ALTER TABLE transactions
ADD COLUMN IF NOT EXISTS markup_is_preview BOOLEAN DEFAULT NULL;

COMMENT ON COLUMN transactions.markup_is_preview IS
  'NULL = no markup calculated, TRUE = preview (pre-invoice), FALSE = final (invoice approved)';
        `)
        process.exit(1)
      }

      throw selectError
    }
    throw error
  }

  console.log('✅ Migration complete!')
}

migrate().catch(err => {
  console.error('Migration failed:', err)
  process.exit(1)
})
