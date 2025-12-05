#!/usr/bin/env node
/**
 * Deep Dive: WRO/Receiving, Returns, and Storage
 *
 * 1. Find WRO Receiving Fee transactions (they exist in pending!)
 * 2. Explore Returns and their linkage to orders/shipments
 * 3. Verify Storage inventory linkage
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
  console.log('='.repeat(100))
  console.log('DEEP DIVE: WRO/RECEIVING, RETURNS, AND STORAGE')
  console.log('='.repeat(100))

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 180) // 6 months back

  // ============================================================
  // PART 1: FIND ALL WRO RECEIVING FEE TRANSACTIONS
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 1: WRO RECEIVING FEE TRANSACTIONS')
  console.log('█'.repeat(100))

  // Query ALL transactions and filter for WRO
  console.log('\nQuerying all transactions for last 180 days...')

  let allTxs = []
  let cursor = null
  let page = 0

  do {
    const body = {
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      page_size: 1000
    }
    if (cursor) body.cursor = cursor

    const data = await fetchJson(`${API_BASE}/transactions:query`, {
      method: 'POST',
      body: JSON.stringify(body)
    })

    const items = data.items || []
    allTxs.push(...items)
    cursor = data.next
    page++

    console.log(`  Page ${page}: ${items.length} items (total: ${allTxs.length})`)

    if (page >= 20) break // Safety limit
  } while (cursor)

  console.log(`\nTotal transactions fetched: ${allTxs.length}`)

  // Filter for WRO
  const wroTxs = allTxs.filter(t => t.transaction_fee === 'WRO Receiving Fee')
  console.log(`\nWRO Receiving Fee transactions: ${wroTxs.length}`)

  if (wroTxs.length > 0) {
    console.log('\n--- ALL WRO RECEIVING FEE TRANSACTIONS ---')
    for (const tx of wroTxs) {
      console.log(`\n${JSON.stringify(tx, null, 2)}`)
    }

    // Analyze reference patterns
    console.log('\n--- WRO Reference Analysis ---')
    for (const tx of wroTxs) {
      console.log(`  reference_id: ${tx.reference_id}`)
      console.log(`  reference_type: ${tx.reference_type}`)
      console.log(`  invoice_id: ${tx.invoice_id}`)
      console.log(`  invoiced_status: ${tx.invoiced_status}`)
      console.log(`  additional_details: ${JSON.stringify(tx.additional_details)}`)
      console.log()
    }
  }

  // Also check what fee types contain "Receiving" or "WRO" or "Inbound"
  const receivingRelated = allTxs.filter(t =>
    t.transaction_fee.toLowerCase().includes('receiving') ||
    t.transaction_fee.toLowerCase().includes('wro') ||
    t.transaction_fee.toLowerCase().includes('inbound')
  )
  console.log(`\nAll receiving-related transactions: ${receivingRelated.length}`)

  const receivingFeeTypes = {}
  for (const tx of receivingRelated) {
    receivingFeeTypes[tx.transaction_fee] = (receivingFeeTypes[tx.transaction_fee] || 0) + 1
  }
  console.log('Fee types:')
  for (const [fee, count] of Object.entries(receivingFeeTypes)) {
    console.log(`  ${fee}: ${count}`)
  }

  // ============================================================
  // PART 2: RETURNS DEEP DIVE
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 2: RETURNS DEEP DIVE')
  console.log('█'.repeat(100))

  // Get all return-related transactions
  const returnTxs = allTxs.filter(t =>
    t.transaction_fee.toLowerCase().includes('return') ||
    t.reference_type === 'Return'
  )

  console.log(`\nReturn-related transactions: ${returnTxs.length}`)

  const returnFeeTypes = {}
  const returnRefTypes = {}
  for (const tx of returnTxs) {
    returnFeeTypes[tx.transaction_fee] = (returnFeeTypes[tx.transaction_fee] || 0) + 1
    returnRefTypes[tx.reference_type] = (returnRefTypes[tx.reference_type] || 0) + 1
  }

  console.log('\nFee types:')
  for (const [fee, count] of Object.entries(returnFeeTypes)) {
    console.log(`  ${fee}: ${count}`)
  }

  console.log('\nReference types:')
  for (const [type, count] of Object.entries(returnRefTypes)) {
    console.log(`  ${type}: ${count}`)
  }

  console.log('\n--- SAMPLE RETURN TRANSACTIONS ---')
  for (let i = 0; i < Math.min(5, returnTxs.length); i++) {
    console.log(`\nReturn ${i + 1}:`)
    console.log(JSON.stringify(returnTxs[i], null, 2))
  }

  // Check if return reference_ids match our shipments
  if (returnTxs.length > 0) {
    const returnRefIds = returnTxs.map(t => t.reference_id)
    console.log(`\n--- Checking if Return reference_ids are in our shipments ---`)
    console.log(`Return reference_ids: ${returnRefIds.join(', ')}`)

    const { data: shipMatches } = await supabase
      .from('shipments')
      .select('shipment_id, shipbob_order_id, client_id')
      .in('shipment_id', returnRefIds)

    console.log(`Matches in shipments table: ${shipMatches?.length || 0}`)

    // Also check if they match order IDs
    const { data: orderMatches } = await supabase
      .from('orders')
      .select('shipbob_order_id, client_id')
      .in('shipbob_order_id', returnRefIds)

    console.log(`Matches in orders table: ${orderMatches?.length || 0}`)

    // Parse order ID from Comment field
    console.log('\n--- Parsing Order IDs from Return Comments ---')
    for (const tx of returnTxs) {
      const comment = tx.additional_details?.Comment || ''
      const orderMatch = comment.match(/Order\s+(\d+)/i)
      if (orderMatch) {
        console.log(`  Return ${tx.reference_id}: Order ${orderMatch[1]} (from comment)`)

        // Check if this order exists in our database
        const { data: order } = await supabase
          .from('orders')
          .select('shipbob_order_id, client_id, customer_name')
          .eq('shipbob_order_id', orderMatch[1])
          .single()

        if (order) {
          console.log(`    ✅ Found in orders: client_id = ${order.client_id}`)
        } else {
          console.log(`    ❌ Not found in orders`)
        }
      }
    }
  }

  // ============================================================
  // PART 3: STORAGE INVENTORY LINKAGE
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 3: STORAGE INVENTORY LINKAGE')
  console.log('█'.repeat(100))

  // Get storage transactions
  const storageTxs = allTxs.filter(t => t.transaction_fee === 'Warehousing Fee')
  console.log(`\nStorage transactions: ${storageTxs.length}`)

  // Parse reference_id format: FC_ID-InventoryID-LocationType
  const inventoryIds = new Set()
  for (const tx of storageTxs.slice(0, 100)) {
    const parts = tx.reference_id.split('-')
    if (parts.length >= 2) {
      inventoryIds.add(parts[1])
    }
  }

  console.log(`\nUnique Inventory IDs from first 100 storage txs: ${inventoryIds.size}`)
  console.log(`Sample IDs: ${[...inventoryIds].slice(0, 10).join(', ')}`)

  // Try to look up inventory via Products API
  console.log('\n--- Checking Inventory API ---')
  const sampleInvId = [...inventoryIds][0]

  try {
    const invData = await fetchJson(`${API_BASE}/inventory/${sampleInvId}`)
    console.log(`\nInventory ${sampleInvId}:`)
    console.log(JSON.stringify(invData, null, 2))
  } catch (e) {
    console.log(`Error fetching inventory: ${e.message}`)
  }

  // Try Products API
  console.log('\n--- Checking Products API ---')
  try {
    const prodData = await fetchJson(`${API_BASE}/product?Limit=5`)
    console.log('Sample products:')
    const products = prodData.items || prodData || []
    for (const p of products.slice(0, 2)) {
      console.log(JSON.stringify(p, null, 2))
    }
  } catch (e) {
    console.log(`Error fetching products: ${e.message}`)
  }

  // ============================================================
  // PART 4: CHECK ALL REFERENCE TYPES
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 4: ALL REFERENCE TYPES IN TRANSACTIONS')
  console.log('█'.repeat(100))

  const refTypeAnalysis = {}
  for (const tx of allTxs) {
    const refType = tx.reference_type
    if (!refTypeAnalysis[refType]) {
      refTypeAnalysis[refType] = {
        count: 0,
        feeTypes: {},
        sampleRefIds: [],
        invoiceTypes: {}
      }
    }
    refTypeAnalysis[refType].count++
    refTypeAnalysis[refType].feeTypes[tx.transaction_fee] = (refTypeAnalysis[refType].feeTypes[tx.transaction_fee] || 0) + 1
    refTypeAnalysis[refType].invoiceTypes[tx.invoice_type || 'Pending'] = (refTypeAnalysis[refType].invoiceTypes[tx.invoice_type || 'Pending'] || 0) + 1
    if (refTypeAnalysis[refType].sampleRefIds.length < 3) {
      refTypeAnalysis[refType].sampleRefIds.push(tx.reference_id)
    }
  }

  console.log('\n--- Reference Types Summary ---')
  for (const [refType, data] of Object.entries(refTypeAnalysis)) {
    console.log(`\n${refType} (${data.count} transactions):`)
    console.log(`  Sample reference_ids: ${data.sampleRefIds.join(', ')}`)
    console.log(`  Fee types:`)
    for (const [fee, count] of Object.entries(data.feeTypes)) {
      console.log(`    ${fee}: ${count}`)
    }
    console.log(`  Invoice types:`)
    for (const [invType, count] of Object.entries(data.invoiceTypes)) {
      console.log(`    ${invType}: ${count}`)
    }
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('COMPLETE REFERENCE LINKAGE SUMMARY')
  console.log('█'.repeat(100))

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════════════════╗
║ REFERENCE TYPE LINKAGE                                                                    ║
╠══════════════════════════════════════════════════════════════════════════════════════════╣
║ reference_type    │ reference_id contains     │ How to get client_id                      ║
╠═══════════════════╪═══════════════════════════╪═══════════════════════════════════════════╣
║ Shipment          │ Shipment ID               │ shipments.client_id (direct join)         ║
║ Default           │ Shipment ID (for credits) │ shipments.client_id (join on shipment_id) ║
║ Return            │ Return ID                 │ Parse Order ID from Comment → orders      ║
║ FC                │ {FC_ID}-{InvID}-{LocType} │ Inventory API → Product → Channel?        ║
║ TicketNumber      │ Ticket ID                 │ Parse from Comment                        ║
║ WRO               │ WRO ID?                   │ WRO API → client?                         ║
╚══════════════════════════════════════════════════════════════════════════════════════════╝
`)
}

main().catch(console.error)
