#!/usr/bin/env node
/**
 * Find: Do we have duplicate shipment records (old + new) for same order?
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function findDuplicates() {
  console.log('=== CHECKING FOR DUPLICATE RECORDS ===\n')

  // Get a specific order that has NULL shipment_id
  const testOrderId = '312927198'

  const { data: records } = await supabase
    .from('shipments')
    .select('*')
    .eq('client_id', HENSON_ID)
    .eq('shipbob_order_id', testOrderId)

  console.log(`Records for order ${testOrderId}:`)
  for (const r of records || []) {
    console.log(`  shipment_id: ${r.shipment_id || 'NULL'}`)
    console.log(`  carrier_service: ${r.carrier_service || 'NULL'}`)
    console.log(`  fc_name: ${r.fc_name || 'NULL'}`)
    console.log(`  tracking: ${r.tracking_id || 'NULL'}`)
    console.log(`  ---`)
  }

  // Count total records vs unique shipment_ids
  console.log('\n=== OVERALL STATS ===\n')

  const { count: totalRecords } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)

  const { count: recordsWithShipmentId } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .not('shipment_id', 'is', null)

  const { count: recordsWithoutShipmentId } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', HENSON_ID)
    .is('shipment_id', null)

  console.log(`Total shipment records: ${totalRecords}`)
  console.log(`  With shipment_id:    ${recordsWithShipmentId}`)
  console.log(`  Without shipment_id: ${recordsWithoutShipmentId} (legacy records)`)

  // Check if any order has BOTH a record with shipment_id AND one without
  console.log('\n=== CHECKING FOR ORDERS WITH BOTH OLD AND NEW RECORDS ===\n')

  // Get all orders that have NULL shipment_id records
  const { data: nullShipmentOrders } = await supabase
    .from('shipments')
    .select('shipbob_order_id')
    .eq('client_id', HENSON_ID)
    .is('shipment_id', null)

  const orderIds = [...new Set(nullShipmentOrders?.map(r => r.shipbob_order_id).filter(Boolean))]
  console.log(`Orders with NULL shipment_id: ${orderIds.length}`)

  // For each, check if there's also a record with shipment_id
  let duplicates = 0
  for (const orderId of orderIds.slice(0, 10)) {
    const { data: allForOrder } = await supabase
      .from('shipments')
      .select('shipment_id')
      .eq('client_id', HENSON_ID)
      .eq('shipbob_order_id', orderId)

    const withId = allForOrder?.filter(r => r.shipment_id)?.length || 0
    const withoutId = allForOrder?.filter(r => !r.shipment_id)?.length || 0

    if (withId > 0 && withoutId > 0) {
      duplicates++
      console.log(`  Order ${orderId}: ${withId} with shipment_id, ${withoutId} without (DUPLICATE!)`)
    }
  }

  if (duplicates === 0) {
    console.log('  No duplicates found in sample - old records are for different orders')
  }

  // Conclusion
  console.log('\n=== CONCLUSION ===\n')
  console.log(`There are ${recordsWithoutShipmentId} legacy records without shipment_id.`)
  console.log('These appear to be from an older sync that used shipbob_order_id as key.')
  console.log('')
  console.log('Options:')
  console.log('1. Delete these legacy records and rely on new shipment_id-based sync')
  console.log('2. Update the sync to also upsert on shipbob_order_id for backward compat')
}

findDuplicates().catch(console.error)
