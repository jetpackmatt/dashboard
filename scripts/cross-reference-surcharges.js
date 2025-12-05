#!/usr/bin/env node
/**
 * Cross-reference Excel shipments with surcharges against API data
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

    if (pageNum >= 10) break
  } while (cursor)

  return allItems
}

async function main() {
  console.log('═'.repeat(80))
  console.log('CROSS-REFERENCE: Excel Surcharges vs API')
  console.log('═'.repeat(80))

  // Excel examples with surcharges:
  // shipment_id (tracking), order_id, fulfillment_cost, surcharge, total_amount
  const excelExamples = [
    { tracking: 'D10016911378877', orderId: 320890439, fulfillment: 6.17, surcharge: 0.15, total: 6.32 },
    { tracking: 'D10016911276576', orderId: 320887886, fulfillment: 6.91, surcharge: 0.15, total: 7.06 },
    { tracking: 'D10016911277219', orderId: 320865905, fulfillment: 7.58, surcharge: 0.35, total: 7.93 },
    { tracking: '9200190244541403041531', orderId: 320860433, fulfillment: 5.97, surcharge: 0.15, total: 6.12, pickFees: 0.26 },
    { tracking: '9200190244541403036544', orderId: 320856990, fulfillment: 5.75, surcharge: 0.15, total: 5.90, pickFees: 0.26 },
  ]

  // Get transactions for Nov 27 (when these occurred)
  console.log('\nFetching API transactions for Nov 27...')
  const novTxs = await queryTransactions({
    from_date: '2025-11-26T00:00:00Z',
    to_date: '2025-11-28T23:59:59Z'
  })
  console.log(`Total transactions: ${novTxs.length}`)

  // Build lookup by tracking ID
  const byTracking = {}
  for (const tx of novTxs) {
    const tracking = tx.additional_details?.TrackingId
    if (tracking) {
      if (!byTracking[tracking]) byTracking[tracking] = []
      byTracking[tracking].push(tx)
    }
  }

  console.log(`\nUnique tracking IDs in API: ${Object.keys(byTracking).length}`)

  // Cross-reference
  console.log('\n' + '─'.repeat(80))
  console.log('CROSS-REFERENCE RESULTS')
  console.log('─'.repeat(80))

  for (const excel of excelExamples) {
    console.log(`\n${'█'.repeat(60)}`)
    console.log(`EXCEL: Order ${excel.orderId}`)
    console.log(`  Tracking: ${excel.tracking}`)
    console.log(`  Fulfillment: $${excel.fulfillment}`)
    console.log(`  Surcharge: $${excel.surcharge}`)
    console.log(`  Pick Fees: $${excel.pickFees || 0}`)
    console.log(`  Total: $${excel.total}`)

    const apiTxs = byTracking[excel.tracking] || []

    if (apiTxs.length === 0) {
      console.log(`\n  API: NOT FOUND by tracking ID`)

      // Try to find by partial match or different search
      const partialMatches = Object.keys(byTracking).filter(t =>
        t.includes(excel.tracking.slice(-8)) || excel.tracking.includes(t.slice(-8))
      )
      if (partialMatches.length > 0) {
        console.log(`  Possible partial matches: ${partialMatches.slice(0, 3).join(', ')}`)
      }
    } else {
      console.log(`\n  API: Found ${apiTxs.length} transaction(s)`)

      let apiTotal = 0
      for (const tx of apiTxs) {
        console.log(`    - ${tx.transaction_fee}: $${tx.amount} (ref: ${tx.reference_id})`)
        apiTotal += tx.amount
      }
      console.log(`  API Total: $${apiTotal.toFixed(2)}`)

      // Compare
      const excelTotal = excel.fulfillment + excel.surcharge + (excel.pickFees || 0)
      const diff = Math.abs(apiTotal - excelTotal)
      console.log(`  Excel Total: $${excelTotal.toFixed(2)}`)
      console.log(`  Difference: $${diff.toFixed(2)} ${diff < 0.01 ? '✅ MATCH' : '⚠️ MISMATCH'}`)

      // Show full API data
      console.log(`\n  Full API response:`)
      for (const tx of apiTxs) {
        console.log(JSON.stringify(tx, null, 4))
      }
    }
  }

  // Also: check if there are ANY separate surcharge transactions
  console.log('\n' + '═'.repeat(80))
  console.log('ALL UNIQUE transaction_fee VALUES')
  console.log('═'.repeat(80))

  const allFees = {}
  for (const tx of novTxs) {
    allFees[tx.transaction_fee] = (allFees[tx.transaction_fee] || 0) + 1
  }

  for (const [fee, count] of Object.entries(allFees).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${fee}: ${count}`)
  }

  // Check if surcharge might be in a different fee type
  console.log('\n' + '═'.repeat(80))
  console.log('SHIPPING CHARGE CORRECTION - Could this be surcharges?')
  console.log('═'.repeat(80))

  const corrections = novTxs.filter(t => t.transaction_fee === 'Shipping Charge Correction')
  console.log(`Found ${corrections.length} Shipping Charge Corrections`)
  for (const tx of corrections.slice(0, 5)) {
    console.log(JSON.stringify(tx, null, 2))
  }

  // Check Address Correction
  const addrCorrections = novTxs.filter(t => t.transaction_fee === 'Address Correction')
  console.log(`\nFound ${addrCorrections.length} Address Corrections`)
  for (const tx of addrCorrections.slice(0, 3)) {
    console.log(JSON.stringify(tx, null, 2))
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
