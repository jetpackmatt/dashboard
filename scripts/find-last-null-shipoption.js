#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function find() {
  const { data: record } = await supabase
    .from('shipments')
    .select('*')
    .eq('client_id', HENSON_ID)
    .is('ship_option_id', null)
    .single()

  if (!record) {
    console.log('No records with NULL ship_option_id found!')
    return
  }

  console.log('=== RECORD WITH NULL SHIP_OPTION_ID ===\n')
  console.log(`shipment_id: ${record.shipment_id}`)
  console.log(`shipbob_order_id: ${record.shipbob_order_id}`)
  console.log(`store_order_id: ${record.store_order_id}`)
  console.log(`carrier_service: "${record.carrier_service}"`)
  console.log(`carrier: ${record.carrier}`)
  console.log(`ship_option_id: ${record.ship_option_id}`)
  console.log(`order_date: ${record.order_date}`)
  console.log(`updated_at: ${record.updated_at}`)

  // Quick fix - update this record directly
  console.log('\n=== FIXING RECORD ===')
  const { error } = await supabase
    .from('shipments')
    .update({ ship_option_id: 146 })
    .eq('shipment_id', record.shipment_id)
    .eq('client_id', HENSON_ID)

  if (error) {
    console.log(`Error: ${error.message}`)
  } else {
    console.log('Fixed! Set ship_option_id = 146 for ShipBob Economy')
  }

  // Verify
  const { count } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .is('ship_option_id', null)

  console.log(`\nRemaining NULL ship_option_id records: ${count}`)
}

find().catch(console.error)
