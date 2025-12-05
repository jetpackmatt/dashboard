#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function buildShipOptionLookup() {
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_ID)
    .single()

  // Get shipping methods
  const methodsRes = await fetch('https://api.shipbob.com/1.0/shippingmethod', {
    headers: { 'Authorization': `Bearer ${creds.api_token}` }
  })
  const methods = await methodsRes.json()

  // Build lookup by ship_option name (service_level.name)
  const lookup = {}
  console.log('=== SHIPPING METHODS -> SERVICE LEVEL IDS ===\n')
  for (const method of methods) {
    const serviceLevelName = method.service_level?.name?.trim()
    const serviceLevelId = method.service_level?.id
    const methodName = method.name

    console.log(`Method: "${methodName}"`)
    console.log(`  -> service_level.id: ${serviceLevelId}`)
    console.log(`  -> service_level.name: "${serviceLevelName}"`)
    console.log('')

    if (serviceLevelName && serviceLevelId) {
      lookup[serviceLevelName] = serviceLevelId
    }
  }

  console.log('\n=== LOOKUP TABLE (ship_option name -> ID) ===')
  console.log(JSON.stringify(lookup, null, 2))

  // Now test with an order
  console.log('\n=== TESTING WITH ORDER ===')
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 7)

  const params = new URLSearchParams({
    StartDate: startDate.toISOString(),
    EndDate: endDate.toISOString(),
    Limit: '5',
    Page: '1'
  })

  const response = await fetch(`https://api.shipbob.com/1.0/order?${params}`, {
    headers: { 'Authorization': `Bearer ${creds.api_token}` }
  })
  const orders = await response.json()

  for (const order of orders) {
    if (order.shipments && order.shipments.length > 0) {
      const shipment = order.shipments[0]
      const shipOption = shipment.ship_option
      const shipOptionId = lookup[shipOption]

      console.log(`Order ${order.id}:`)
      console.log(`  ship_option: "${shipOption}"`)
      console.log(`  ship_option_id (via lookup): ${shipOptionId}`)
    }
  }
}

buildShipOptionLookup().catch(console.error)
