#!/usr/bin/env node
/**
 * Migration: Add shipment_id column to shipments table
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function migrate() {
  console.log('Adding shipment_id column to shipments table...')

  // Supabase JS client can't run raw DDL, so we use the REST API
  const response = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      },
      body: JSON.stringify({
        query: `
          ALTER TABLE shipments ADD COLUMN IF NOT EXISTS shipment_id TEXT;
          CREATE UNIQUE INDEX IF NOT EXISTS shipments_shipment_id_idx ON shipments(shipment_id) WHERE shipment_id IS NOT NULL;
        `
      })
    }
  )

  if (!response.ok) {
    // exec_sql function may not exist, need to create it or use dashboard
    console.log('Note: exec_sql function not available.')
    console.log('Please run this SQL in Supabase Dashboard SQL Editor:')
    console.log('')
    console.log('ALTER TABLE shipments ADD COLUMN IF NOT EXISTS shipment_id TEXT;')
    console.log('CREATE UNIQUE INDEX IF NOT EXISTS shipments_shipment_id_idx ON shipments(shipment_id) WHERE shipment_id IS NOT NULL;')
    return
  }

  console.log('Migration complete!')
}

migrate().catch(console.error)
