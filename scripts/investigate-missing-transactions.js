#!/usr/bin/env node
/**
 * Deep investigation: Why are we missing ~52% of transactions?
 *
 * Hypotheses to test:
 * 1. Date range - shipments from invoice period not synced to our DB
 * 2. API pagination not working correctly
 * 3. Some transactions have reference types we're not capturing
 * 4. Shipments exist in ShipBob but not in our database
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const HENSON_TOKEN = process.env.HENSON_SHIPBOB_TOKEN || process.env.SHIPBOB_HENSON_TOKEN
const BASE_URL = 'https://api.shipbob.com'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fetchWithAuth(endpoint, token = SHIPBOB_TOKEN) {
  const url = `${BASE_URL}${endpoint}`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  })
  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status}: ${text}`)
  }
  return response.json()
}

async function getAllInvoiceTransactions(invoiceId) {
  const all = []
  let cursor = null
  let pageNum = 0

  console.log(`\nFetching all transactions for invoice #${invoiceId}...`)

  do {
    pageNum++
    let endpoint = `/2025-07/invoices/${invoiceId}/transactions?Limit=250`
    if (cursor) endpoint += `&Cursor=${encodeURIComponent(cursor)}`

    const data = await fetchWithAuth(endpoint)
    const items = data.items || []
    all.push(...items)

    console.log(`  Page ${pageNum}: ${items.length} items, total so far: ${all.length}`)

    cursor = data.next || null

    if (pageNum > 100) {
      console.log('  ⚠️ Safety limit reached')
      break
    }
  } while (cursor)

  return all
}

async function main() {
  console.log('═'.repeat(60))
  console.log('INVESTIGATING MISSING TRANSACTIONS')
  console.log('═'.repeat(60))

  const INVOICE_ID = 8633612  // Shipping invoice from Dec 1
  const KNOWN_AMOUNT = 11127.61

  // TEST 1: Verify we're getting all pages
  console.log('\n--- TEST 1: Pagination Verification ---')
  const transactions = await getAllInvoiceTransactions(INVOICE_ID)
  const apiTotal = transactions.reduce((sum, tx) => sum + tx.amount, 0)

  console.log(`\nTotal transactions from API: ${transactions.length}`)
  console.log(`API total: $${apiTotal.toFixed(2)}`)
  console.log(`Known invoice total: $${KNOWN_AMOUNT}`)
  console.log(`Missing: $${(KNOWN_AMOUNT - apiTotal).toFixed(2)} (${((KNOWN_AMOUNT - apiTotal) / KNOWN_AMOUNT * 100).toFixed(1)}%)`)

  // TEST 2: Check the date range of transactions we received
  console.log('\n--- TEST 2: Date Range Analysis ---')
  const chargeDates = transactions.map(tx => tx.charge_date).filter(Boolean).sort()
  console.log(`Earliest charge_date: ${chargeDates[0]}`)
  console.log(`Latest charge_date: ${chargeDates[chargeDates.length - 1]}`)

  // TEST 3: Check reference types
  console.log('\n--- TEST 3: Reference Type Breakdown ---')
  const byRefType = {}
  for (const tx of transactions) {
    const refType = tx.reference_type || 'NULL'
    if (!byRefType[refType]) byRefType[refType] = { count: 0, amount: 0 }
    byRefType[refType].count++
    byRefType[refType].amount += tx.amount
  }
  for (const [type, data] of Object.entries(byRefType)) {
    console.log(`  ${type}: ${data.count} txns, $${data.amount.toFixed(2)}`)
  }

  // TEST 4: Check shipment IDs against our database
  console.log('\n--- TEST 4: Database Match Analysis ---')
  const shipmentIds = transactions
    .filter(tx => tx.reference_type === 'Shipment')
    .map(tx => tx.reference_id)

  const uniqueIds = [...new Set(shipmentIds)]
  console.log(`Unique shipment IDs from API: ${uniqueIds.length}`)

  // Query our database
  const { data: dbShipments, error } = await supabase
    .from('shipments')
    .select('shipment_id, client_id, shipped_date')
    .in('shipment_id', uniqueIds.map(id => parseInt(id)))

  if (error) {
    console.error('DB error:', error)
    return
  }

  const dbSet = new Set(dbShipments.map(s => String(s.shipment_id)))
  const notInDb = uniqueIds.filter(id => !dbSet.has(id))
  const inDb = uniqueIds.filter(id => dbSet.has(id))

  console.log(`Found in our DB: ${inDb.length}`)
  console.log(`NOT in our DB: ${notInDb.length}`)

  if (notInDb.length > 0) {
    console.log(`\n⚠️ ${notInDb.length} shipments from invoice are NOT in our database!`)
    console.log(`First 10 missing IDs: ${notInDb.slice(0, 10).join(', ')}`)
  }

  // TEST 5: Check what date range we have in our DB
  console.log('\n--- TEST 5: Our Database Coverage ---')

  // Get our most recent synced shipments
  const { data: recentShipments } = await supabase
    .from('shipments')
    .select('shipment_id, shipped_date, created_at')
    .order('shipped_date', { ascending: false })
    .limit(10)

  console.log('Most recent shipments in our DB:')
  for (const s of recentShipments || []) {
    console.log(`  ${s.shipment_id}: shipped ${s.shipped_date}`)
  }

  // Count shipments by week
  const { data: weekCounts } = await supabase
    .from('shipments')
    .select('shipped_date')
    .gte('shipped_date', '2025-11-24')
    .lte('shipped_date', '2025-12-01')

  console.log(`\nShipments in our DB for Nov 24 - Dec 1: ${weekCounts?.length || 0}`)

  // TEST 6: Try to look up a missing shipment via Orders API
  if (notInDb.length > 0) {
    console.log('\n--- TEST 6: Lookup Missing Shipments via Orders API ---')

    // Get child tokens from database
    const { data: tokens } = await supabase
      .from('client_api_credentials')
      .select('client_id, api_token, clients(company_name)')

    if (tokens && tokens.length > 0) {
      for (const tokenData of tokens) {
        console.log(`\nTrying ${tokenData.clients?.company_name} token...`)
        const childToken = tokenData.api_token

        // Try to look up a missing shipment
        const testId = notInDb[0]
        try {
          // The shipment ID is the reference_id, try to find the order
          const ordersData = await fetchWithAuth(`/2025-07/order?ShipmentId=${testId}`, childToken)
          console.log(`  Found order for shipment ${testId}:`, ordersData.items?.length || 0, 'orders')

          if (ordersData.items && ordersData.items.length > 0) {
            const order = ordersData.items[0]
            console.log(`  Order ID: ${order.id}, Status: ${order.status}, Created: ${order.created_date}`)
          }
        } catch (e) {
          console.log(`  Error looking up shipment: ${e.message}`)
        }
      }
    }
  }

  // TEST 7: Compare shipment count to transaction count
  console.log('\n--- TEST 7: Expected vs Actual Transaction Count ---')

  // How many shipments did we have in that period?
  const { data: periodShipments, error: periodError } = await supabase
    .from('shipments')
    .select('shipment_id, shipped_date, client_id')
    .gte('shipped_date', '2025-11-24')
    .lte('shipped_date', '2025-12-01')

  if (!periodError) {
    console.log(`Shipments in our DB (Nov 24 - Dec 1): ${periodShipments.length}`)
    console.log(`Transactions from API: ${transactions.length}`)

    // If we have more shipments than transactions, we're missing transactions
    // If we have fewer shipments, we're missing synced data
    if (periodShipments.length > transactions.length) {
      console.log(`\n⚠️ We have MORE shipments than transactions returned!`)
      console.log(`   Missing ${periodShipments.length - transactions.length} transactions`)
    } else if (periodShipments.length < transactions.length) {
      console.log(`\nAPI has more transactions than we have shipments`)
    }
  }

  // SUMMARY
  console.log('\n' + '═'.repeat(60))
  console.log('SUMMARY')
  console.log('═'.repeat(60))

  console.log(`
Invoice #${INVOICE_ID} Analysis:
- Known amount: $${KNOWN_AMOUNT}
- API returned: $${apiTotal.toFixed(2)} (${transactions.length} transactions)
- Missing: $${(KNOWN_AMOUNT - apiTotal).toFixed(2)} (${((KNOWN_AMOUNT - apiTotal) / KNOWN_AMOUNT * 100).toFixed(1)}%)

Shipment Analysis:
- Unique shipments in API response: ${uniqueIds.length}
- Found in our DB: ${inDb.length} (${(inDb.length / uniqueIds.length * 100).toFixed(1)}%)
- NOT in our DB: ${notInDb.length}

Date Range:
- API transactions span: ${chargeDates[0]} to ${chargeDates[chargeDates.length - 1]}
- Our DB has ${weekCounts?.length || 0} shipments in Nov 24 - Dec 1 range
`)

  if (notInDb.length > 0) {
    console.log('LIKELY CAUSE: Missing shipments in our database')
    console.log('SOLUTION: Run sync for recent period to capture missing shipments')
  } else if (apiTotal < KNOWN_AMOUNT * 0.95) {
    console.log('LIKELY CAUSE: API is not returning all transactions')
    console.log('Need to investigate: pagination, token permissions, or API bug')
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
