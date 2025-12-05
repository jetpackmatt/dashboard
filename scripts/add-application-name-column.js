#!/usr/bin/env node
/**
 * Migration: Add application_name column to orders table
 * This column stores the actual platform type (Shopify, Amazon, etc.) from ShipBob's Channels API
 * Note: Only stored on orders - shipments get it via JOIN (no data replication per CLAUDE.data.md)
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function migrate() {
  console.log('Checking application_name column on orders table...')

  // Check if column exists by trying to select it
  const { data: ordersCheck, error: ordersError } = await supabase
    .from('orders')
    .select('application_name')
    .limit(1)

  if (ordersError && ordersError.message.includes('application_name')) {
    console.log('Column application_name does not exist on orders table.')
    console.log('\nPlease run this SQL in the Supabase Dashboard SQL Editor:')
    console.log('----------------------------------------')
    console.log(`
ALTER TABLE orders ADD COLUMN IF NOT EXISTS application_name TEXT;

-- Add index for filtering
CREATE INDEX IF NOT EXISTS idx_orders_application_name ON orders(application_name);

-- Comment for documentation
COMMENT ON COLUMN orders.application_name IS 'Platform type from ShipBob Channels API (Shopify, Amazon, Walmartv2, etc.)';
`)
    console.log('----------------------------------------')
    process.exit(1)
  } else if (ordersError) {
    console.error('Error checking orders table:', ordersError.message)
    process.exit(1)
  } else {
    console.log('✓ Column application_name already exists on orders table')
  }

  console.log('\n✓ Migration check complete!')
}

migrate().catch(console.error)
