#!/usr/bin/env node
/**
 * Comprehensive transaction sync using filter combination strategy
 * Gets ALL transactions by querying multiple filter combinations and deduplicating
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

// All known filter values
const TRANSACTION_TYPES = ['Charge', 'Credit', 'Refund', 'Payment', 'Adjustment']
const REFERENCE_TYPES = ['Shipment', 'Default', 'WRO', 'Return']
const INVOICE_TYPES = ['Shipping', 'AdditionalFee', 'WarehouseStorage', 'ReturnsFee', 'Credits', 'WarehouseInboundFee']

async function queryTransactions(params) {
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

    if (!response.ok) return []

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

    cursor = data.next || null
    // Stop if pagination loops (all duplicates)
    if (pageNum >= 20 || (items.length > 0 && newCount === 0)) break
  } while (cursor)

  return allItems
}

async function comprehensiveSync() {
  console.log('Starting comprehensive transaction sync...\n')
  const startTime = Date.now()

  const masterMap = new Map()
  let queryCount = 0

  // Strategy 1: Query by transaction_type + invoiced_status
  console.log('Phase 1: By transaction_type + invoiced_status')
  for (const txType of TRANSACTION_TYPES) {
    for (const invoiced of [true, false]) {
      const items = await queryTransactions({
        transaction_types: [txType],
        invoiced_status: invoiced
      })
      queryCount++
      for (const t of items) masterMap.set(t.transaction_id, t)
      if (items.length > 0) {
        process.stdout.write(`  ${txType}/${invoiced ? 'inv' : 'pend'}: ${items.length}  `)
      }
    }
  }
  console.log(`\n  Unique so far: ${masterMap.size}`)

  // Strategy 2: Query by reference_type + invoiced_status
  console.log('\nPhase 2: By reference_type + invoiced_status')
  for (const refType of REFERENCE_TYPES) {
    for (const invoiced of [true, false]) {
      const items = await queryTransactions({
        reference_types: [refType],
        invoiced_status: invoiced
      })
      queryCount++
      for (const t of items) masterMap.set(t.transaction_id, t)
      if (items.length > 0) {
        process.stdout.write(`  ${refType}/${invoiced ? 'inv' : 'pend'}: ${items.length}  `)
      }
    }
  }
  console.log(`\n  Unique so far: ${masterMap.size}`)

  // Strategy 3: Query by transaction_type + reference_type (for each invoiced_status)
  console.log('\nPhase 3: By transaction_type + reference_type + invoiced_status')
  for (const txType of TRANSACTION_TYPES) {
    for (const refType of REFERENCE_TYPES) {
      for (const invoiced of [true, false]) {
        const items = await queryTransactions({
          transaction_types: [txType],
          reference_types: [refType],
          invoiced_status: invoiced
        })
        queryCount++
        for (const t of items) masterMap.set(t.transaction_id, t)
      }
    }
  }
  console.log(`  Unique so far: ${masterMap.size}`)

  // Strategy 4: Query by invoice_type + invoiced_status
  console.log('\nPhase 4: By invoice_type + invoiced_status')
  for (const invType of INVOICE_TYPES) {
    for (const invoiced of [true, false]) {
      const items = await queryTransactions({
        invoice_types: [invType],
        invoiced_status: invoiced
      })
      queryCount++
      for (const t of items) masterMap.set(t.transaction_id, t)
      if (items.length > 0) {
        process.stdout.write(`  ${invType}/${invoiced ? 'inv' : 'pend'}: ${items.length}  `)
      }
    }
  }
  console.log(`\n  Unique so far: ${masterMap.size}`)

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
  const transactions = [...masterMap.values()]

  // Summary
  console.log('\n' + '═'.repeat(70))
  console.log('COMPREHENSIVE SYNC RESULTS')
  console.log('═'.repeat(70))

  console.log(`\nTotal unique transactions: ${transactions.length}`)
  console.log(`Total queries made: ${queryCount}`)
  console.log(`Time elapsed: ${elapsed}s`)

  const total = transactions.reduce((sum, t) => sum + t.amount, 0)
  console.log(`Total amount: $${total.toFixed(2)}`)

  // Breakdowns
  const byTxType = {}
  const byRefType = {}
  const byInvoiced = { pending: 0, invoiced: 0 }

  for (const t of transactions) {
    byTxType[t.transaction_type || 'unknown'] = (byTxType[t.transaction_type || 'unknown'] || 0) + 1
    byRefType[t.reference_type || 'unknown'] = (byRefType[t.reference_type || 'unknown'] || 0) + 1
    if (t.invoiced_status) byInvoiced.invoiced++
    else byInvoiced.pending++
  }

  console.log('\nBy transaction_type:')
  for (const [k, v] of Object.entries(byTxType).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  console.log('\nBy reference_type:')
  for (const [k, v] of Object.entries(byRefType).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  console.log('\nBy invoiced_status:')
  console.log(`  pending: ${byInvoiced.pending}`)
  console.log(`  invoiced: ${byInvoiced.invoiced}`)

  // Date range
  const dates = transactions.map(t => t.charge_date).filter(Boolean).sort()
  if (dates.length > 0) {
    console.log(`\nDate range: ${dates[0]} to ${dates[dates.length - 1]}`)
  }

  // Effectiveness
  console.log('\n' + '═'.repeat(70))
  console.log('EFFECTIVENESS')
  console.log('═'.repeat(70))
  console.log(`Single query would return: ~250 (capped)`)
  console.log(`Comprehensive sync returned: ${transactions.length}`)
  console.log(`Improvement: ${((transactions.length / 250 - 1) * 100).toFixed(0)}% more transactions`)

  return transactions
}

comprehensiveSync().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
