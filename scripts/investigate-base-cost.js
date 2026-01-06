#!/usr/bin/env node
const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const invoiceIds = [8693044, 8693047, 8693051, 8693054, 8693056]
  const hensonClientId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  console.log('Investigating base_cost discrepancy for Henson Dec 8-14 invoices...\n')

  // Get all shipping transactions for Henson in this week's invoices
  let allTx = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('reference_id, base_cost, invoice_id_sb')
      .eq('client_id', hensonClientId)
      .eq('reference_type', 'Shipment')
      .eq('fee_type', 'Shipping')
      .in('invoice_id_sb', invoiceIds)
      .range(offset, offset + 999)

    if (error) { console.error(error); break }
    if (!data || data.length === 0) break
    allTx.push(...data)
    offset += 1000
  }

  // Get unique shipments from transactions
  const uniqueShipments = [...new Set(allTx.map(t => t.reference_id))]
  console.log('Total unique shipments in TRANSACTIONS:', uniqueShipments.length)

  // Count how many are missing base_cost
  const missingBaseCost = allTx.filter(t => t.base_cost === null)
  const uniqueMissingBaseCost = [...new Set(missingBaseCost.map(t => t.reference_id))]
  console.log('Shipments missing base_cost:', uniqueMissingBaseCost.length)

  // Show which ones are missing
  if (uniqueMissingBaseCost.length > 0) {
    console.log('\nMissing base_cost shipment IDs:', uniqueMissingBaseCost.join(', '))

    // Check if these shipments exist in the shipments table
    for (const shipmentId of uniqueMissingBaseCost) {
      const { data: shipment } = await supabase
        .from('shipments')
        .select('shipment_id, status, ship_date, tracking_number')
        .eq('shipment_id', shipmentId)
        .single()

      if (shipment) {
        console.log(`  - ${shipmentId}: status=${shipment.status}, ship_date=${shipment.ship_date}, tracking=${shipment.tracking_number || 'none'}`)
      } else {
        console.log(`  - ${shipmentId}: NOT IN SHIPMENTS TABLE <-- CANNOT BE MATCHED BY SFTP`)
      }
    }
  }

  // Now check: how many shipments does SHIPMENTS TABLE have for Henson in this period?
  // Use the same date range as the invoices (Dec 8-14)
  console.log('\n--- Checking SHIPMENTS table ---')

  // Get shipment IDs that exist in transactions AND shipments table
  const txShipmentSet = new Set(uniqueShipments)

  let shipmentsInTable = 0
  let shipmentsMissingFromTable = []

  for (let i = 0; i < uniqueShipments.length; i += 100) {
    const batch = uniqueShipments.slice(i, i + 100)
    const { data, count } = await supabase
      .from('shipments')
      .select('shipment_id', { count: 'exact' })
      .eq('client_id', hensonClientId)
      .in('shipment_id', batch)

    shipmentsInTable += (data?.length || 0)

    // Find which ones are missing
    if (data) {
      const foundIds = new Set(data.map(s => String(s.shipment_id)))
      for (const id of batch) {
        if (!foundIds.has(String(id))) {
          shipmentsMissingFromTable.push(id)
        }
      }
    }
  }

  console.log(`Shipments in TRANSACTIONS that exist in SHIPMENTS table: ${shipmentsInTable}`)
  console.log(`Shipments in TRANSACTIONS but NOT in SHIPMENTS table: ${shipmentsMissingFromTable.length}`)

  if (shipmentsMissingFromTable.length > 0) {
    console.log('  Missing IDs:', shipmentsMissingFromTable.join(', '))
  }

  console.log('\n=== SUMMARY ===')
  console.log(`Transactions: ${uniqueShipments.length} unique shipments`)
  console.log(`In shipments table: ${shipmentsInTable}`)
  console.log(`Missing from shipments table: ${shipmentsMissingFromTable.length} (cannot match SFTP)`)
  console.log(`Missing base_cost (SFTP): ${uniqueMissingBaseCost.length}`)

  // The preflight shows 4893 - check if that matches shipments in table + those not in table
  const preflight = shipmentsInTable + shipmentsMissingFromTable.length
  console.log(`\nPreflight should see: ${preflight} shipments`)
  console.log(`Preflight actually shows: 4893`)
  console.log(`Difference: ${4893 - preflight}`)
}

main().catch(console.error)
