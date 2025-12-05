#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function checkOrderTypes() {
  console.log('=== CHECKING ORDER TYPE FIELDS IN API ===\n')

  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_ID)
    .single()

  // Fetch the B2B order we found
  const b2bOrderId = '312096693'
  const b2bResponse = await fetch(`https://api.shipbob.com/1.0/order/${b2bOrderId}`, {
    headers: { 'Authorization': `Bearer ${creds.api_token}` }
  })
  const b2bOrder = await b2bResponse.json()

  console.log('=== B2B ORDER (bulk 280 items) ===')
  console.log('Order ID:', b2bOrder.id)
  console.log('Order Number:', b2bOrder.order_number)
  console.log('')
  console.log('Potential type fields:')
  console.log('  type:', b2bOrder.type)
  console.log('  order_type:', b2bOrder.order_type)
  console.log('  channel:', b2bOrder.channel)
  console.log('  channel_name:', b2bOrder.channel?.name)
  console.log('  source:', b2bOrder.source)
  console.log('  tags:', b2bOrder.tags)
  console.log('  reference_id:', b2bOrder.reference_id)
  console.log('  purchase_date:', b2bOrder.purchase_date)
  console.log('  shipping_method:', b2bOrder.shipping_method)
  console.log('')

  // Fetch a regular D2C order for comparison
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

  // Find a small order (likely D2C)
  const d2cOrder = orders.find(o => o.products?.length === 1)

  if (d2cOrder) {
    console.log('=== D2C ORDER (single item) ===')
    console.log('Order ID:', d2cOrder.id)
    console.log('Order Number:', d2cOrder.order_number)
    console.log('')
    console.log('Potential type fields:')
    console.log('  type:', d2cOrder.type)
    console.log('  order_type:', d2cOrder.order_type)
    console.log('  channel:', d2cOrder.channel)
    console.log('  channel_name:', d2cOrder.channel?.name)
    console.log('  source:', d2cOrder.source)
    console.log('  tags:', d2cOrder.tags)
    console.log('  reference_id:', d2cOrder.reference_id)
    console.log('  shipping_method:', d2cOrder.shipping_method)
  }

  // Dump all fields from B2B order to see what's available
  console.log('\n=== ALL TOP-LEVEL FIELDS IN B2B ORDER ===')
  const keys = Object.keys(b2bOrder).sort()
  for (const key of keys) {
    const val = b2bOrder[key]
    if (val !== null && val !== undefined && typeof val !== 'object') {
      console.log(`  ${key}: ${val}`)
    } else if (val !== null && val !== undefined) {
      console.log(`  ${key}: [${typeof val}]`)
    }
  }
}

checkOrderTypes().catch(console.error)
