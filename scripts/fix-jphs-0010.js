/**
 * Fix JPHS-0010 invoice matching
 *
 * Problem: JPHS-0010 XLS has "Store OrderID" instead of "OrderID" (shipment ID)
 * Solution: Use Store OrderID → orders table → shipment_id → transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const XLSX = require('xlsx')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DRY_RUN = process.argv.includes('--dry-run')
const HISTORICAL_DIR = path.join(process.cwd(), 'reference/invoices-historical')

async function fix() {
  console.log('=== FIX JPHS-0010 INVOICE MATCHING ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`)

  // Get JPHS-0010 invoice info
  const { data: invoice } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, period_start, period_end')
    .eq('invoice_number', 'JPHS-0010-052625')
    .single()

  if (!invoice) {
    console.log('Invoice JPHS-0010 not found!')
    return
  }

  console.log(`Invoice: ${invoice.invoice_number}`)
  console.log(`ID: ${invoice.id}`)
  console.log(`Period: ${invoice.period_start?.slice(0,10)} to ${invoice.period_end?.slice(0,10)}`)

  // Get Henson client ID
  const { data: client } = await supabase
    .from('clients')
    .select('id')
    .eq('company_name', 'Henson Shaving')
    .single()

  if (!client) {
    console.log('Henson Shaving client not found!')
    return
  }

  console.log(`Client ID: ${client.id}`)

  // Read JPHS-0010 XLS
  const xlsPath = path.join(HISTORICAL_DIR, 'INVOICE-DETAILS-JPHS-0010-052625.xlsx')
  const workbook = XLSX.readFile(xlsPath)

  // Find shipping sheet
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('ship'))
  if (!sheetName) {
    console.log('No shipping sheet found!')
    return
  }

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet)

  console.log(`\nXLS Shipping sheet: ${sheetName}`)
  console.log(`XLS Headers: ${Object.keys(rows[0] || {}).join(', ')}`)
  console.log(`XLS Rows: ${rows.length}`)

  // Check which ID column exists
  const hasOrderID = rows[0]?.['OrderID'] !== undefined
  const hasStoreOrderID = rows[0]?.['Store OrderID'] !== undefined

  console.log(`\nHas OrderID column: ${hasOrderID}`)
  console.log(`Has Store OrderID column: ${hasStoreOrderID}`)

  if (hasOrderID) {
    console.log('\nThis file has OrderID - use normal import process')
    return
  }

  if (!hasStoreOrderID) {
    console.log('\nNo Store OrderID column found!')
    return
  }

  // Extract Store OrderIDs and billed amounts from XLS
  const xlsData = []
  for (const row of rows) {
    const storeOrderId = String(row['Store OrderID'] || '')
    const billedAmount = parseFloat(row['Original Invoice'] || row['Invoice Amount'] || 0)

    if (storeOrderId && storeOrderId !== 'undefined' && storeOrderId !== 'Total') {
      xlsData.push({ storeOrderId, billedAmount })
    }
  }

  console.log(`\nExtracted ${xlsData.length} Store OrderIDs from XLS`)
  console.log('Sample:', xlsData.slice(0, 5))

  // Get unique Store OrderIDs
  const uniqueStoreOrderIds = [...new Set(xlsData.map(d => d.storeOrderId))]
  console.log(`Unique Store OrderIDs: ${uniqueStoreOrderIds.length}`)

  // Lookup shipment_ids via orders table (batch query)
  console.log('\nLooking up shipment IDs via orders table...')

  const BATCH_SIZE = 500
  const storeToShipmentMap = new Map()

  for (let i = 0; i < uniqueStoreOrderIds.length; i += BATCH_SIZE) {
    const batch = uniqueStoreOrderIds.slice(i, i + BATCH_SIZE)

    // Query orders table to get shipbob_order_id for each store_order_id
    const { data: orders, error } = await supabase
      .from('orders')
      .select('store_order_id, shipbob_order_id')
      .eq('client_id', client.id)
      .in('store_order_id', batch)

    if (error) {
      console.log('Error querying orders:', error.message)
      continue
    }

    // For each order, get the shipment using shipbob_order_id
    const shipbobOrderIds = orders.map(o => o.shipbob_order_id).filter(Boolean)
    const { data: shipments } = await supabase
      .from('shipments')
      .select('shipbob_order_id, shipment_id')
      .in('shipbob_order_id', shipbobOrderIds)

    // Build mapping: shipbob_order_id -> shipment_id
    const sbOrderToShipment = new Map()
    shipments?.forEach(s => sbOrderToShipment.set(s.shipbob_order_id, s.shipment_id))

    // Build final mapping: store_order_id -> shipment_id
    orders.forEach(o => {
      const shipmentId = sbOrderToShipment.get(o.shipbob_order_id)
      if (shipmentId) {
        storeToShipmentMap.set(o.store_order_id, String(shipmentId))
      }
    })

    if ((i + BATCH_SIZE) % 2000 === 0) {
      console.log(`  Processed ${i + BATCH_SIZE} Store OrderIDs...`)
    }
  }

  console.log(`\nMapped ${storeToShipmentMap.size} Store OrderIDs to Shipment IDs`)

  // Now match XLS rows to transactions using shipment_id as reference_id
  const xlsWithShipmentId = xlsData.map(d => ({
    ...d,
    shipmentId: storeToShipmentMap.get(d.storeOrderId)
  }))

  const withShipmentId = xlsWithShipmentId.filter(d => d.shipmentId)
  const withoutShipmentId = xlsWithShipmentId.filter(d => !d.shipmentId)

  console.log(`XLS rows with shipment_id: ${withShipmentId.length}`)
  console.log(`XLS rows without shipment_id: ${withoutShipmentId.length}`)

  if (withoutShipmentId.length > 0) {
    console.log('Sample without shipment_id:', withoutShipmentId.slice(0, 5))
  }

  // Get transactions that need updating
  const shipmentIds = [...new Set(withShipmentId.map(d => d.shipmentId))]
  console.log(`\nUnique shipment IDs to match: ${shipmentIds.length}`)

  // Fetch existing transactions
  const txMap = new Map()
  for (let i = 0; i < shipmentIds.length; i += BATCH_SIZE) {
    const batch = shipmentIds.slice(i, i + BATCH_SIZE)

    const { data: txs, error } = await supabase
      .from('transactions')
      .select('id, reference_id, cost, invoice_id_jp')
      .eq('client_id', client.id)
      .eq('transaction_fee', 'Shipping')
      .in('reference_id', batch)

    if (error) {
      console.log('Error querying transactions:', error.message)
      continue
    }

    txs?.forEach(tx => txMap.set(tx.reference_id, tx))
  }

  console.log(`Found ${txMap.size} matching transactions in DB`)

  // Prepare updates
  const updates = []
  let matched = 0
  let notFound = 0
  let alreadyMatched = 0

  for (const xlsRow of withShipmentId) {
    const tx = txMap.get(xlsRow.shipmentId)
    if (tx) {
      if (tx.invoice_id_jp) {
        alreadyMatched++
      } else {
        matched++
        const markupPercentage = tx.cost > 0 ? (xlsRow.billedAmount / tx.cost) - 1 : 0

        updates.push({
          id: tx.id,
          updateData: {
            billed_amount: xlsRow.billedAmount,
            markup_applied: tx.cost * markupPercentage,
            markup_percentage: markupPercentage,
            invoice_id_jp: invoice.id,
            invoiced_status_jp: true
          }
        })
      }
    } else {
      notFound++
    }
  }

  console.log(`\n=== MATCHING RESULTS ===`)
  console.log(`Matched (will update): ${matched}`)
  console.log(`Already had invoice: ${alreadyMatched}`)
  console.log(`Not found in DB: ${notFound}`)
  console.log(`No shipment mapping: ${withoutShipmentId.length}`)

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would update', updates.length, 'transactions')
    console.log('Sample update:', updates[0])
    return
  }

  // Execute updates
  if (updates.length > 0) {
    console.log(`\nExecuting ${updates.length} updates...`)

    let successCount = 0
    const PARALLEL_SIZE = 50

    for (let i = 0; i < updates.length; i += PARALLEL_SIZE) {
      const batch = updates.slice(i, i + PARALLEL_SIZE)

      const results = await Promise.all(batch.map(async ({ id, updateData }) => {
        const { error } = await supabase
          .from('transactions')
          .update(updateData)
          .eq('id', id)

        return !error
      }))

      successCount += results.filter(Boolean).length

      if ((i + PARALLEL_SIZE) % 500 === 0) {
        console.log(`  Updated ${i + PARALLEL_SIZE}...`)
      }
    }

    console.log(`\nSuccessfully updated: ${successCount} transactions`)
  }

  console.log('\n=== COMPLETE ===')
}

fix().catch(console.error)
