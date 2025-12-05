#!/usr/bin/env node
/**
 * Search for actual surcharge TRANSACTIONS (not just fee types)
 * The fee list shows "Delivery Area Surcharge" and "Residential Surcharge" exist!
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryTransactions(params) {
  const allItems = []
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    let url = `${BASE_URL}/2025-07/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...params, page_size: 1000 })
    })

    if (!response.ok) return []

    const data = await response.json()
    allItems.push(...(data.items || []))
    cursor = data.next || null

    if (pageNum >= 100) break
  } while (cursor)

  return allItems
}

async function main() {
  console.log('═'.repeat(100))
  console.log('SEARCHING FOR ACTUAL SURCHARGE TRANSACTIONS')
  console.log('═'.repeat(100))

  // Fee types that might be surcharges
  const surchargeTypes = [
    'Delivery Area Surcharge',
    'Residential Surcharge',
    'Shipping Charge Correction',
    'Address Correction',
    'Fuel Surcharge',
    'WMS - Fuel Surcharge'
  ]

  // Get ALL historical transactions (we have 146K!)
  console.log('\nFetching ALL historical transactions to find surcharges...')
  console.log('This may take a minute...')

  const allTxs = await queryTransactions({
    from_date: '2025-03-01T00:00:00Z',
    to_date: '2025-12-05T23:59:59Z'
  })

  console.log(`\nTotal transactions fetched: ${allTxs.length}`)

  // Count by transaction_fee
  const byFeeType = {}
  for (const tx of allTxs) {
    byFeeType[tx.transaction_fee] = (byFeeType[tx.transaction_fee] || 0) + 1
  }

  console.log('\n--- ALL TRANSACTION_FEE TYPES FOUND ---')
  for (const [fee, count] of Object.entries(byFeeType).sort((a, b) => b - a)) {
    const isSurcharge = surchargeTypes.includes(fee) || fee.toLowerCase().includes('surcharge')
    console.log(`${isSurcharge ? '>>> ' : '    '}${fee}: ${count}`)
  }

  // Look for surcharge transactions specifically
  console.log('\n' + '█'.repeat(80))
  console.log('SURCHARGE-RELATED TRANSACTIONS')
  console.log('█'.repeat(80))

  for (const surchargeFee of surchargeTypes) {
    const matches = allTxs.filter(t => t.transaction_fee === surchargeFee)
    console.log(`\n${surchargeFee}: ${matches.length} transactions`)

    if (matches.length > 0) {
      console.log('Sample:')
      console.log(JSON.stringify(matches[0], null, 2))

      // Check if these link to shipments
      const refs = matches.map(m => m.reference_id)
      console.log(`\nReference IDs: ${refs.slice(0, 5).join(', ')}...`)

      // See if the same reference_id has a Shipping transaction
      const refId = refs[0]
      const sameRef = allTxs.filter(t => t.reference_id === refId)
      console.log(`\nAll transactions for reference_id ${refId}:`)
      for (const t of sameRef) {
        console.log(`  ${t.transaction_fee}: $${t.amount}`)
      }
    }
  }

  // Also search for any fee type containing "surcharge"
  console.log('\n' + '█'.repeat(80))
  console.log('ANY FEE TYPE CONTAINING "SURCHARGE"')
  console.log('█'.repeat(80))

  const surchargeMatches = allTxs.filter(t =>
    t.transaction_fee?.toLowerCase().includes('surcharge')
  )
  console.log(`\nFound ${surchargeMatches.length} transactions with "surcharge" in fee type`)

  if (surchargeMatches.length > 0) {
    const byType = {}
    for (const t of surchargeMatches) {
      byType[t.transaction_fee] = (byType[t.transaction_fee] || 0) + 1
    }
    console.log('\nBreakdown:')
    for (const [fee, count] of Object.entries(byType)) {
      console.log(`  ${fee}: ${count}`)
    }

    console.log('\nSample transactions:')
    for (const t of surchargeMatches.slice(0, 3)) {
      console.log(JSON.stringify(t, null, 2))
      console.log('---')
    }
  }

  // Check shipments that have BOTH Shipping + some surcharge fee
  console.log('\n' + '█'.repeat(80))
  console.log('SHIPMENTS WITH MULTIPLE FEE TYPES')
  console.log('█'.repeat(80))

  // Group by reference_id
  const byRef = {}
  for (const tx of allTxs) {
    if (tx.reference_type === 'Shipment') {
      if (!byRef[tx.reference_id]) byRef[tx.reference_id] = []
      byRef[tx.reference_id].push(tx)
    }
  }

  // Find shipments with 3+ transactions (might include surcharge)
  const multiTx = Object.entries(byRef).filter(([_, txs]) => txs.length >= 3)
  console.log(`\nShipments with 3+ transactions: ${multiTx.length}`)

  if (multiTx.length > 0) {
    console.log('\nSample:')
    for (const [refId, txs] of multiTx.slice(0, 5)) {
      console.log(`\nReference ID ${refId}:`)
      let total = 0
      for (const t of txs) {
        console.log(`  ${t.transaction_fee.padEnd(30)}: $${t.amount.toFixed(2)}`)
        total += t.amount
      }
      console.log(`  ${'TOTAL'.padEnd(30)}: $${total.toFixed(2)}`)
    }
  }

  console.log('\n' + '═'.repeat(100))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
