#!/usr/bin/env node
/**
 * Migration: Add denormalized order fields to shipments table
 *
 * Purpose: Eliminate JOIN for type/channel filters (2+ sec → <500ms)
 *
 * Adds columns:
 *   - order_type (DTC, B2B, FBA, Dropship)
 *   - channel_name
 *
 * Usage:
 *   node scripts/migrations/add-denormalized-order-fields.js
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function migrate() {
  console.log('=== Adding denormalized order fields to shipments ===\n')

  // Step 1: Add columns via raw SQL
  console.log('Step 1: Adding columns...')

  const { error: alterError } = await supabase.rpc('exec_sql', {
    sql: `
      ALTER TABLE shipments
      ADD COLUMN IF NOT EXISTS order_type TEXT,
      ADD COLUMN IF NOT EXISTS channel_name TEXT;

      -- Add index for fast filtering
      CREATE INDEX IF NOT EXISTS idx_shipments_order_type ON shipments(order_type);
      CREATE INDEX IF NOT EXISTS idx_shipments_channel_name ON shipments(channel_name);

      -- Composite index for common filter combination
      CREATE INDEX IF NOT EXISTS idx_shipments_client_type ON shipments(client_id, order_type);
    `
  })

  if (alterError) {
    // exec_sql RPC might not exist, try alternative approach
    console.log('  RPC not available, columns may need to be added via Supabase dashboard')
    console.log('  Error:', alterError.message)
    console.log('\n  Run this SQL in Supabase SQL Editor:')
    console.log(`
      ALTER TABLE shipments
      ADD COLUMN IF NOT EXISTS order_type TEXT,
      ADD COLUMN IF NOT EXISTS channel_name TEXT;

      CREATE INDEX IF NOT EXISTS idx_shipments_order_type ON shipments(order_type);
      CREATE INDEX IF NOT EXISTS idx_shipments_channel_name ON shipments(channel_name);
      CREATE INDEX IF NOT EXISTS idx_shipments_client_type ON shipments(client_id, order_type);
    `)
  } else {
    console.log('  ✓ Columns added')
  }

  // Step 2: Backfill from orders table
  console.log('\nStep 2: Backfilling from orders table...')

  // Get count of shipments needing backfill
  const { count: needsBackfill } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('order_type', null)
    .not('order_id', 'is', null)

  console.log(`  Shipments needing backfill: ${needsBackfill}`)

  if (needsBackfill === 0) {
    console.log('  ✓ No backfill needed')
    return
  }

  // Backfill in batches
  const BATCH_SIZE = 1000
  let processed = 0
  let hasMore = true

  while (hasMore) {
    // Get batch of shipments with their order data
    const { data: batch, error: fetchError } = await supabase
      .from('shipments')
      .select('id, order_id, orders(order_type, channel_name)')
      .is('order_type', null)
      .not('order_id', 'is', null)
      .limit(BATCH_SIZE)

    if (fetchError) {
      console.error('  Fetch error:', fetchError.message)
      break
    }

    if (!batch || batch.length === 0) {
      hasMore = false
      break
    }

    // Update each shipment
    for (const shipment of batch) {
      if (shipment.orders) {
        const { error: updateError } = await supabase
          .from('shipments')
          .update({
            order_type: shipment.orders.order_type,
            channel_name: shipment.orders.channel_name
          })
          .eq('id', shipment.id)

        if (updateError) {
          console.error(`  Update error for ${shipment.id}:`, updateError.message)
        }
      }
      processed++
    }

    console.log(`  Processed: ${processed}/${needsBackfill}`)

    if (batch.length < BATCH_SIZE) {
      hasMore = false
    }
  }

  console.log(`\n✓ Backfill complete: ${processed} shipments updated`)

  // Step 3: Verify
  console.log('\nStep 3: Verification...')

  const { count: stillNull } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .is('order_type', null)
    .not('order_id', 'is', null)

  const { count: withType } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('order_type', 'is', null)

  console.log(`  Shipments with order_type: ${withType}`)
  console.log(`  Shipments still NULL (with order_id): ${stillNull}`)

  if (stillNull === 0) {
    console.log('\n✓ Migration successful!')
  } else {
    console.log(`\n⚠ ${stillNull} shipments still need backfill`)
  }
}

migrate().catch(console.error)
