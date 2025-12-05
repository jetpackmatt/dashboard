#!/usr/bin/env node
/**
 * Check the status of legacy orders in API
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function checkLegacyOrders() {
  console.log('=== CHECKING LEGACY ORDER STATUS IN API ===\n')

  // Get creds
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_ID)
    .single()

  // Get legacy records
  const { data: legacyRecords } = await supabase
    .from('shipments')
    .select('shipbob_order_id')
    .eq('client_id', HENSON_ID)
    .is('shipment_id', null)

  console.log(`Found ${legacyRecords?.length || 0} legacy records\n`)

  // Fetch each from API
  const statusCounts = {}
  for (const record of legacyRecords || []) {
    const response = await fetch(`https://api.shipbob.com/1.0/order/${record.shipbob_order_id}`, {
      headers: { 'Authorization': `Bearer ${creds.api_token}` }
    })
    const order = await response.json()

    const status = order.status || 'Unknown'
    statusCounts[status] = (statusCounts[status] || 0) + 1

    console.log(`Order ${record.shipbob_order_id}: ${status}`)
    if (order.shipments?.length > 0) {
      const s = order.shipments[0]
      console.log(`  → Shipment ${s.id}: ${s.status}, ship_option: ${s.ship_option}`)
    }
  }

  console.log('\n=== STATUS SUMMARY ===')
  for (const [status, count] of Object.entries(statusCounts)) {
    console.log(`  ${status}: ${count}`)
  }

  console.log('\n=== RECOMMENDATION ===')
  console.log('These legacy records exist because an earlier sync used shipbob_order_id')
  console.log('as the key instead of shipment_id. They should be deleted and re-synced.')
  console.log('')
  console.log('SQL to delete legacy records:')
  console.log(`DELETE FROM shipments WHERE client_id = '${HENSON_ID}' AND shipment_id IS NULL;`)
}

checkLegacyOrders().catch(console.error)
