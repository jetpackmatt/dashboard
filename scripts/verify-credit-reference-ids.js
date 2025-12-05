#!/usr/bin/env node
/**
 * Verify if Credit reference_ids are Order IDs
 *
 * Check if the credit reference_ids match records in our orders table
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const token = process.env.SHIPBOB_API_TOKEN
const API_BASE = 'https://api.shipbob.com/2025-07'

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  return response.json()
}

async function main() {
  console.log('=== Verifying Credit reference_ids ===\n')

  // Get credit transactions
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 90)

  const invoicesData = await fetchJson(
    `${API_BASE}/invoices?startDate=${startDate.toISOString().split('T')[0]}&endDate=${new Date().toISOString().split('T')[0]}&pageSize=100`
  )

  const creditInvoices = (invoicesData.items || []).filter(i => i.invoice_type === 'Credits')
  console.log(`Found ${creditInvoices.length} credit invoices`)

  // Get all credit transactions
  const allCredits = []
  for (const inv of creditInvoices) {
    const txData = await fetchJson(`${API_BASE}/invoices/${inv.invoice_id}/transactions?pageSize=250`)
    allCredits.push(...(txData.items || []))
  }

  console.log(`Total credit transactions: ${allCredits.length}`)

  // Get unique reference_ids
  const refIds = [...new Set(allCredits.map(c => c.reference_id))]
  console.log(`Unique reference_ids: ${refIds.length}`)
  console.log(`\nReference IDs: ${refIds.join(', ')}\n`)

  // Check if they're in our orders table
  console.log('--- Checking Orders Table ---')
  const { data: orderMatches, error: orderError } = await supabase
    .from('orders')
    .select('id, shipbob_order_id, store_order_id, client_id, customer_name')
    .in('shipbob_order_id', refIds)

  if (orderError) {
    console.log('Order query error:', orderError)
  } else {
    console.log(`Found ${orderMatches?.length || 0} matches in orders table`)
    if (orderMatches?.length > 0) {
      console.log('\nMatches:')
      for (const order of orderMatches) {
        console.log(`  ${order.shipbob_order_id}: ${order.customer_name} (client: ${order.client_id})`)
      }
    }
  }

  // Check if they're in our shipments table
  console.log('\n--- Checking Shipments Table ---')
  const { data: shipmentMatches, error: shipmentError } = await supabase
    .from('shipments')
    .select('id, shipment_id, shipbob_order_id, client_id, recipient_name')
    .in('shipment_id', refIds)

  if (shipmentError) {
    console.log('Shipment query error:', shipmentError)
  } else {
    console.log(`Found ${shipmentMatches?.length || 0} matches in shipments table`)
    if (shipmentMatches?.length > 0) {
      console.log('\nMatches:')
      for (const ship of shipmentMatches) {
        console.log(`  ${ship.shipment_id}: order ${ship.shipbob_order_id} (client: ${ship.client_id})`)
      }
    }
  }

  // Also check shipbob_order_id in shipments
  console.log('\n--- Checking Shipments by shipbob_order_id ---')
  const { data: orderShipMatches, error: orderShipError } = await supabase
    .from('shipments')
    .select('id, shipment_id, shipbob_order_id, client_id, recipient_name')
    .in('shipbob_order_id', refIds)

  if (orderShipError) {
    console.log('Order-shipment query error:', orderShipError)
  } else {
    console.log(`Found ${orderShipMatches?.length || 0} matches`)
    if (orderShipMatches?.length > 0) {
      console.log('\nMatches (credit ref_id = order ID, found in shipments):')
      for (const ship of orderShipMatches) {
        console.log(`  Order ${ship.shipbob_order_id}: shipment ${ship.shipment_id} (client: ${ship.client_id})`)
      }
    }
  }

  // Summary
  console.log('\n=== SUMMARY ===')
  console.log(`Credit reference_ids tested: ${refIds.length}`)
  console.log(`Match orders.shipbob_order_id: ${orderMatches?.length || 0}`)
  console.log(`Match shipments.shipment_id: ${shipmentMatches?.length || 0}`)
  console.log(`Match shipments.shipbob_order_id: ${orderShipMatches?.length || 0}`)

  if (orderMatches?.length > 0 || orderShipMatches?.length > 0) {
    console.log('\n✅ Credit reference_ids ARE order IDs!')
    console.log('Strategy: JOIN credits to orders via reference_id = shipbob_order_id')
  } else if (shipmentMatches?.length > 0) {
    console.log('\n✅ Credit reference_ids ARE shipment IDs!')
    console.log('Strategy: JOIN credits to shipments via reference_id = shipment_id')
  } else {
    console.log('\n❌ Credit reference_ids do NOT match our orders or shipments')
    console.log('May need to look up via ShipBob Orders API')
  }
}

main().catch(console.error)
