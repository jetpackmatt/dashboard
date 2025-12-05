#!/usr/bin/env node
/**
 * Compare 1.0 vs 2025-07 Order API response structures
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', '6b94c274-0446-4167-9d02-b998f8be59ad')
    .single()

  const token = creds.api_token

  console.log('=== Comparing 1.0 vs 2025-07 Order API ===\n')

  // 1.0 API
  const res1 = await fetch('https://api.shipbob.com/1.0/order?Limit=1&SortOrder=Descending', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  const data1 = await res1.json()

  console.log('--- 1.0 API Order Structure ---')
  console.log('Top-level keys:', Object.keys(data1[0] || {}))
  if (data1[0]?.shipments?.[0]) {
    console.log('Shipment keys:', Object.keys(data1[0].shipments[0]))
    console.log('Has measurements?', 'measurements' in data1[0].shipments[0])
    console.log('Has tracking?', 'tracking' in data1[0].shipments[0])
    console.log('Has zone?', 'zone' in data1[0].shipments[0])
    if (data1[0].shipments[0].measurements) {
      console.log('Measurements:', JSON.stringify(data1[0].shipments[0].measurements))
    }
    if (data1[0].shipments[0].tracking) {
      console.log('Tracking:', JSON.stringify(data1[0].shipments[0].tracking))
    }
    if (data1[0].shipments[0].zone) {
      console.log('Zone:', data1[0].shipments[0].zone)
    }
  }

  // 2025-07 API
  console.log('\n--- 2025-07 API Order Structure ---')
  const res2 = await fetch('https://api.shipbob.com/2025-07/order?Limit=1', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  const data2 = await res2.json()

  console.log('Top-level keys:', Object.keys(data2[0] || {}))
  if (data2[0]?.shipments?.[0]) {
    console.log('Shipment keys:', Object.keys(data2[0].shipments[0]))
    console.log('Has measurements?', 'measurements' in data2[0].shipments[0])
    console.log('Has tracking?', 'tracking' in data2[0].shipments[0])
    console.log('Has zone?', 'zone' in data2[0].shipments[0])
  }

  // Check pagination structure
  console.log('\n--- Pagination Check ---')
  const res3 = await fetch('https://api.shipbob.com/2025-07/order?Limit=50', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  const data3 = await res3.json()
  console.log('2025-07 response type:', Array.isArray(data3) ? 'raw array' : 'object wrapper')
  if (!Array.isArray(data3)) {
    console.log('Response keys:', Object.keys(data3))
    console.log('Has items?', 'items' in data3)
    console.log('Has next?', 'next' in data3)
  }
  console.log('Items returned:', Array.isArray(data3) ? data3.length : (data3.items?.length || 'N/A'))

  // Check shippingmethod endpoint
  console.log('\n--- Shipping Method API Check ---')
  const res4 = await fetch('https://api.shipbob.com/2025-07/shippingmethod', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  console.log('2025-07 /shippingmethod status:', res4.status)
  if (res4.status === 404) {
    // Try singular
    const res5 = await fetch('https://api.shipbob.com/2025-07/shipping-method', {
      headers: { 'Authorization': 'Bearer ' + token }
    })
    console.log('2025-07 /shipping-method status:', res5.status)
  }

  // Try 1.0 for comparison
  const res6 = await fetch('https://api.shipbob.com/1.0/shippingmethod', {
    headers: { 'Authorization': 'Bearer ' + token }
  })
  console.log('1.0 /shippingmethod status:', res6.status)
}

main().catch(console.error)
