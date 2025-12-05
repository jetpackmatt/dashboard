#!/usr/bin/env node
/**
 * Investigate: The 3 shipments with carrier_service but NULL ship_option_id
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function investigate() {
  console.log('=== INVESTIGATING UNMAPPED CARRIER SERVICES ===\n')

  // Get records with carrier_service but NULL ship_option_id
  const { data: records } = await supabase
    .from('shipments')
    .select('shipment_id, carrier_service, carrier, shipbob_order_id')
    .eq('client_id', HENSON_ID)
    .is('ship_option_id', null)
    .not('carrier_service', 'is', null)

  console.log(`Found ${records?.length || 0} shipments with carrier_service but NULL ship_option_id\n`)

  for (const r of records || []) {
    console.log(`Shipment ${r.shipment_id}:`)
    console.log(`  carrier_service: "${r.carrier_service}"`)
    console.log(`  carrier: ${r.carrier}`)
    console.log('')
  }

  // Get all unique carrier_services in DB
  console.log('=== ALL UNIQUE CARRIER SERVICES IN DB ===\n')
  const { data: allServices } = await supabase
    .from('shipments')
    .select('carrier_service')
    .eq('client_id', HENSON_ID)
    .not('carrier_service', 'is', null)

  const uniqueServices = [...new Set(allServices?.map(r => r.carrier_service))]
  console.log('Unique carrier_service values:')
  for (const s of uniqueServices.sort()) {
    console.log(`  "${s}"`)
  }

  // Get shipping methods from API
  console.log('\n=== SHIPPING METHODS FROM API ===\n')
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_ID)
    .single()

  const methodsRes = await fetch('https://api.shipbob.com/1.0/shippingmethod', {
    headers: { 'Authorization': `Bearer ${creds.api_token}` }
  })
  const methods = await methodsRes.json()

  console.log('Available service_level.name values:')
  for (const method of methods) {
    const slName = method.service_level?.name?.trim()
    const slId = method.service_level?.id
    console.log(`  "${slName}" → ID ${slId}`)
  }

  // Missing mappings
  console.log('\n=== MISSING MAPPINGS ===')
  const apiNames = methods.map(m => m.service_level?.name?.trim())
  const unmapped = uniqueServices.filter(s => !apiNames.includes(s))
  console.log('Carrier services NOT in API shipping methods:')
  for (const s of unmapped) {
    console.log(`  "${s}" - needs manual mapping`)
  }
}

investigate().catch(console.error)
