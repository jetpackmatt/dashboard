#!/usr/bin/env node
/**
 * Migration: Add soft delete columns to orders and shipments
 *
 * Adds:
 * - deleted_at: timestamp when record was marked as deleted (null = active)
 * - last_verified_at: timestamp when record was last verified to exist in ShipBob
 *
 * Run: node scripts/migrations/add-soft-delete-columns.js
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function runMigration() {
  console.log('=== MIGRATION: Add Soft Delete Columns ===\n')

  try {
    // Add deleted_at column to orders table
    console.log('Adding deleted_at column to orders table...')
    const { error: ordersDeletedAtError } = await supabase.rpc('exec_sql', {
      sql: `
        ALTER TABLE orders
        ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;

        COMMENT ON COLUMN orders.deleted_at IS 'Timestamp when order was marked as deleted from ShipBob. NULL means active.';
      `
    })

    if (ordersDeletedAtError) {
      // Try alternative approach using raw SQL via function
      console.log('  Using alternative approach for orders.deleted_at...')
      const { error } = await supabase.from('orders').select('deleted_at').limit(1)
      if (error?.message?.includes('does not exist')) {
        console.log('  Column does not exist, creating via direct query...')
        // Column doesn't exist - we'll need to use Supabase dashboard or psql
        console.log('  NOTE: Please run this SQL in Supabase SQL Editor:')
        console.log(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
    COMMENT ON COLUMN orders.deleted_at IS 'Timestamp when order was marked as deleted from ShipBob. NULL means active.';
        `)
      } else {
        console.log('  ✓ orders.deleted_at column already exists')
      }
    } else {
      console.log('  ✓ orders.deleted_at column added')
    }

    // Add deleted_at column to shipments table
    console.log('Adding deleted_at column to shipments table...')
    const { error: shipmentsCheck } = await supabase.from('shipments').select('deleted_at').limit(1)
    if (shipmentsCheck?.message?.includes('does not exist')) {
      console.log('  NOTE: Please run this SQL in Supabase SQL Editor:')
      console.log(`
    ALTER TABLE shipments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
    COMMENT ON COLUMN shipments.deleted_at IS 'Timestamp when shipment was marked as deleted from ShipBob. NULL means active.';
      `)
    } else {
      console.log('  ✓ shipments.deleted_at column already exists')
    }

    // Add last_verified_at columns
    console.log('\nAdding last_verified_at columns...')
    const { error: ordersVerifiedCheck } = await supabase.from('orders').select('last_verified_at').limit(1)
    if (ordersVerifiedCheck?.message?.includes('does not exist')) {
      console.log('  NOTE: Please run this SQL in Supabase SQL Editor:')
      console.log(`
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NULL;
    COMMENT ON COLUMN orders.last_verified_at IS 'Timestamp when order was last confirmed to exist in ShipBob API.';

    ALTER TABLE shipments ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NULL;
    COMMENT ON COLUMN shipments.last_verified_at IS 'Timestamp when shipment was last confirmed to exist in ShipBob API.';
      `)
    } else {
      console.log('  ✓ last_verified_at columns already exist')
    }

    // Create indexes for efficient filtering
    console.log('\nCreating indexes...')
    console.log('  NOTE: Please run this SQL in Supabase SQL Editor:')
    console.log(`
    CREATE INDEX IF NOT EXISTS idx_orders_deleted_at ON orders(deleted_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_shipments_deleted_at ON shipments(deleted_at) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_orders_last_verified_at ON orders(last_verified_at);
    CREATE INDEX IF NOT EXISTS idx_shipments_last_verified_at ON shipments(last_verified_at);
    `)

    console.log('\n=== MIGRATION INSTRUCTIONS ===')
    console.log('Run the following SQL in Supabase SQL Editor:\n')
    console.log(`
-- Add soft delete columns
ALTER TABLE orders ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NULL;
ALTER TABLE shipments ADD COLUMN IF NOT EXISTS last_verified_at TIMESTAMPTZ DEFAULT NULL;

-- Add comments
COMMENT ON COLUMN orders.deleted_at IS 'Timestamp when order was marked as deleted from ShipBob. NULL means active.';
COMMENT ON COLUMN shipments.deleted_at IS 'Timestamp when shipment was marked as deleted from ShipBob. NULL means active.';
COMMENT ON COLUMN orders.last_verified_at IS 'Timestamp when order was last confirmed to exist in ShipBob API.';
COMMENT ON COLUMN shipments.last_verified_at IS 'Timestamp when shipment was last confirmed to exist in ShipBob API.';

-- Create partial indexes for efficient filtering (only index active records)
CREATE INDEX IF NOT EXISTS idx_orders_deleted_at ON orders(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_shipments_deleted_at ON shipments(deleted_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_last_verified_at ON orders(last_verified_at);
CREATE INDEX IF NOT EXISTS idx_shipments_last_verified_at ON shipments(last_verified_at);
    `)

    console.log('\n=== DONE ===')

  } catch (err) {
    console.error('Migration error:', err)
  }
}

runMigration()
