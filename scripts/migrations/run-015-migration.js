/**
 * Migration: Add base_charge column to transactions table
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function runMigration() {
  console.log('Running migration: Add base_charge column...')

  // Check if column already exists
  const { data: columns } = await supabase.rpc('to_regclass', {
    relation: 'transactions'
  }).select()

  // Use raw SQL via RPC if available, otherwise use REST API workaround
  // Since we can't run DDL directly, we'll check if we need to via Supabase Dashboard
  const { data: testRow } = await supabase
    .from('transactions')
    .select('base_charge')
    .limit(1)

  if (testRow !== null) {
    console.log('✅ base_charge column already exists!')
    return
  }

  console.log('❌ base_charge column does not exist.')
  console.log('')
  console.log('Please run this SQL in the Supabase Dashboard SQL Editor:')
  console.log('')
  console.log('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_charge NUMERIC(12,2);')
  console.log('')
  console.log('Then re-run this script to verify.')
}

runMigration().catch(err => {
  // If we get a column not found error, we know we need to add it
  if (err.message?.includes('column') || err.code === '42703') {
    console.log('❌ base_charge column does not exist.')
    console.log('')
    console.log('Please run this SQL in the Supabase Dashboard SQL Editor:')
    console.log('')
    console.log('ALTER TABLE transactions ADD COLUMN IF NOT EXISTS base_charge NUMERIC(12,2);')
  } else {
    console.error('Error:', err)
  }
})
