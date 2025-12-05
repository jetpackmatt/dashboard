#!/usr/bin/env node
/**
 * Verify new fields are properly populated after sync
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function verify() {
  console.log('=== FIELD POPULATION VERIFICATION ===\n')

  // Orders table
  const { data: orders } = await supabase
    .from('orders')
    .select('customer_email, customer_phone, address1, total_price')
    .eq('client_id', HENSON_ID)

  const orderCount = orders.length
  const withEmail = orders.filter(o => o.customer_email).length
  const withPhone = orders.filter(o => o.customer_phone).length
  const withAddress = orders.filter(o => o.address1).length
  const withPrice = orders.filter(o => o.total_price).length

  console.log('ORDERS TABLE:')
  console.log(`  Total: ${orderCount}`)
  console.log(`  customer_email: ${withEmail} (${(100 * withEmail / orderCount).toFixed(1)}%)`)
  console.log(`  customer_phone: ${withPhone} (${(100 * withPhone / orderCount).toFixed(1)}%)`)
  console.log(`  address1: ${withAddress} (${(100 * withAddress / orderCount).toFixed(1)}%)`)
  console.log(`  total_price: ${withPrice} (${(100 * withPrice / orderCount).toFixed(1)}%)`)

  // Shipments table
  const { data: shipments } = await supabase
    .from('shipments')
    .select('recipient_name, recipient_email, recipient_phone, shipped_date, delivered_date, transit_time_days, label_generation_date')
    .eq('client_id', HENSON_ID)

  const shipCount = shipments.length
  const withName = shipments.filter(s => s.recipient_name).length
  const withShipEmail = shipments.filter(s => s.recipient_email).length
  const withShipPhone = shipments.filter(s => s.recipient_phone).length
  const withShipped = shipments.filter(s => s.shipped_date).length
  const withDelivered = shipments.filter(s => s.delivered_date).length
  const withTransit = shipments.filter(s => s.transit_time_days).length
  const withLabel = shipments.filter(s => s.label_generation_date).length

  console.log('\nSHIPMENTS TABLE:')
  console.log(`  Total: ${shipCount}`)
  console.log(`  recipient_name: ${withName} (${(100 * withName / shipCount).toFixed(1)}%)`)
  console.log(`  recipient_email: ${withShipEmail} (${(100 * withShipEmail / shipCount).toFixed(1)}%)`)
  console.log(`  recipient_phone: ${withShipPhone} (${(100 * withShipPhone / shipCount).toFixed(1)}%)`)
  console.log(`  label_generation_date: ${withLabel} (${(100 * withLabel / shipCount).toFixed(1)}%)`)
  console.log(`  shipped_date: ${withShipped} (${(100 * withShipped / shipCount).toFixed(1)}%)`)
  console.log(`  delivered_date: ${withDelivered} (${(100 * withDelivered / shipCount).toFixed(1)}%)`)
  console.log(`  transit_time_days: ${withTransit} (${(100 * withTransit / shipCount).toFixed(1)}%)`)

  // Check date differences
  const sameDates = shipments.filter(s => s.label_generation_date && s.shipped_date && s.label_generation_date === s.shipped_date).length
  const diffDates = shipments.filter(s => s.label_generation_date && s.shipped_date && s.label_generation_date !== s.shipped_date).length

  console.log('\nDATE FIELD CHECK:')
  console.log(`  Shipments where label_date == shipped_date: ${sameDates}`)
  console.log(`  Shipments where label_date != shipped_date: ${diffDates}`)

  // Sample a few records
  console.log('\nSAMPLE SHIPMENT (with dates):')
  const sample = shipments.find(s => s.shipped_date && s.delivered_date && s.label_generation_date)
  if (sample) {
    console.log(`  label_generation_date: ${sample.label_generation_date}`)
    console.log(`  shipped_date: ${sample.shipped_date}`)
    console.log(`  delivered_date: ${sample.delivered_date}`)
    console.log(`  transit_time_days: ${sample.transit_time_days}`)
  }

  console.log('\n=== VERIFICATION COMPLETE ===')
}

verify().catch(console.error)
