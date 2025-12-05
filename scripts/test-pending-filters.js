#!/usr/bin/env node
/**
 * Test if we can bypass the 1000 cap by using filters
 * Options to try:
 * 1. transaction_types - Charge vs Refund separately
 * 2. reference_types - Shipment, WRO, FC Transfer separately (if supported)
 * 3. Date ranges - Smaller windows
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryTransactions(params, description) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Testing: ${description}`)
  console.log(`Params: ${JSON.stringify(params)}`)

  const allItems = []
  const seenIds = new Set()
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    const body = { ...params, page_size: 250 }
    if (cursor) body.cursor = cursor

    const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      console.log(`  ERROR: ${response.status}`)
      const text = await response.text()
      console.log(`  ${text.substring(0, 200)}`)
      return { items: [], error: response.status }
    }

    const data = await response.json()
    const items = data.items || []

    let newCount = 0
    for (const t of items) {
      if (!seenIds.has(t.transaction_id)) {
        seenIds.add(t.transaction_id)
        allItems.push(t)
        newCount++
      }
    }

    console.log(`  Page ${pageNum}: ${items.length} items (${newCount} new)`)

    cursor = data.next || null

    // Stop if we've seen 30 pages or all duplicates
    if (pageNum >= 30 || (items.length > 0 && newCount === 0)) break
  } while (cursor)

  const total = allItems.reduce((sum, t) => sum + t.amount, 0)
  console.log(`  TOTAL: ${allItems.length} unique transactions, $${total.toFixed(2)}`)

  return { items: allItems, total }
}

async function main() {
  console.log('Testing filters to bypass 1000 pending transaction cap\n')
  console.log('═'.repeat(60))

  // 1. Baseline - no filters (pending only)
  const baseline = await queryTransactions({}, 'Baseline - all pending')

  // 2. Filter by transaction_type
  const charges = await queryTransactions(
    { transaction_types: ['Charge'] },
    'Charges only'
  )

  const refunds = await queryTransactions(
    { transaction_types: ['Refund'] },
    'Refunds only'
  )

  // 3. Try date ranges (even if pending)
  const today = new Date()
  const yesterday = new Date(today)
  yesterday.setDate(yesterday.getDate() - 1)
  const twoDaysAgo = new Date(today)
  twoDaysAgo.setDate(twoDaysAgo.getDate() - 2)

  const recentOnly = await queryTransactions(
    {
      start_date: yesterday.toISOString().split('T')[0],
      end_date: today.toISOString().split('T')[0]
    },
    'Last 2 days only (start_date/end_date)'
  )

  const fromDateFilter = await queryTransactions(
    {
      from_date: yesterday.toISOString().split('T')[0],
      to_date: today.toISOString().split('T')[0]
    },
    'Last 2 days only (from_date/to_date)'
  )

  // 4. Try reference_types (not sure if supported)
  const shipmentRef = await queryTransactions(
    { reference_types: ['Shipment'] },
    'Reference type: Shipment'
  )

  // Summary
  console.log('\n' + '═'.repeat(60))
  console.log('SUMMARY')
  console.log('═'.repeat(60))

  console.log(`\nBaseline (all pending): ${baseline.items.length} transactions`)
  console.log(`Charges only: ${charges.items.length}`)
  console.log(`Refunds only: ${refunds.items.length}`)
  console.log(`Charges + Refunds: ${charges.items.length + refunds.items.length}`)

  if (charges.items.length + refunds.items.length > baseline.items.length) {
    console.log(`\n✅ FILTER BYPASS WORKS! Can get more by splitting Charge/Refund`)
  }

  console.log(`\nDate filtered (start/end): ${recentOnly.items.length}`)
  console.log(`Date filtered (from/to): ${fromDateFilter.items.length}`)
  console.log(`Reference type filter: ${shipmentRef.items.length}`)

  // Check if we can identify reference_types in the data
  if (baseline.items.length > 0) {
    const refTypes = {}
    for (const t of baseline.items) {
      const type = t.reference_type || 'unknown'
      if (!refTypes[type]) refTypes[type] = 0
      refTypes[type]++
    }
    console.log(`\nReference types in data:`)
    for (const [type, count] of Object.entries(refTypes).sort((a,b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`)
    }
  }

  // Check transaction types
  if (baseline.items.length > 0) {
    const txTypes = {}
    for (const t of baseline.items) {
      const type = t.transaction_type || 'unknown'
      if (!txTypes[type]) txTypes[type] = 0
      txTypes[type]++
    }
    console.log(`\nTransaction types in data:`)
    for (const [type, count] of Object.entries(txTypes).sort((a,b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`)
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
