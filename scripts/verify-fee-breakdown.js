#!/usr/bin/env node
/**
 * Verify: API Shipping = fulfillment_cost + surcharge (baked in)
 * And pick fees are separate transactions
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryByReferenceIds(referenceIds) {
  const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      reference_ids: referenceIds,
      page_size: 1000
    })
  })

  if (!response.ok) return []
  const data = await response.json()
  return data.items || []
}

async function main() {
  console.log('═'.repeat(80))
  console.log('VERIFYING FEE BREAKDOWN: API vs Excel')
  console.log('═'.repeat(80))

  // Order IDs from Excel with surcharges AND pick fees
  const testOrders = [
    { orderId: '320860433', fulfillment: 5.97, surcharge: 0.15, pickFees: 0.26, total: 6.12 + 0.26 },
    { orderId: '320856990', fulfillment: 5.75, surcharge: 0.15, pickFees: 0.26, total: 5.90 + 0.26 },
    { orderId: '320895561', fulfillment: 6.38, surcharge: 0.15, pickFees: 0.52, total: 6.53 + 0.52 },
    { orderId: '320883423', fulfillment: 6.43, surcharge: 0.15, pickFees: 1.04, total: 6.58 + 1.04 },
  ]

  const orderIds = testOrders.map(o => o.orderId)
  console.log(`\nQuerying API for order IDs: ${orderIds.join(', ')}`)

  const apiTxs = await queryByReferenceIds(orderIds)
  console.log(`Found ${apiTxs.length} transactions`)

  // Group by reference_id
  const byOrder = {}
  for (const tx of apiTxs) {
    if (!byOrder[tx.reference_id]) byOrder[tx.reference_id] = []
    byOrder[tx.reference_id].push(tx)
  }

  console.log('\n' + '─'.repeat(80))

  for (const excel of testOrders) {
    console.log(`\n${'█'.repeat(60)}`)
    console.log(`ORDER ${excel.orderId}`)
    console.log('─'.repeat(40))
    console.log(`EXCEL:`)
    console.log(`  Fulfillment: $${excel.fulfillment}`)
    console.log(`  Surcharge:   $${excel.surcharge}`)
    console.log(`  Pick Fees:   $${excel.pickFees}`)
    console.log(`  ─────────────────────`)
    console.log(`  Total:       $${excel.total.toFixed(2)}`)

    const apiForOrder = byOrder[excel.orderId] || []
    console.log(`\nAPI (${apiForOrder.length} transactions):`)

    let apiTotal = 0
    let apiShipping = 0
    let apiPick = 0

    for (const tx of apiForOrder) {
      console.log(`  ${tx.transaction_fee.padEnd(20)}: $${tx.amount.toFixed(2)}`)
      apiTotal += tx.amount
      if (tx.transaction_fee === 'Shipping') apiShipping = tx.amount
      if (tx.transaction_fee === 'Per Pick Fee') apiPick = tx.amount
    }

    console.log(`  ─────────────────────`)
    console.log(`  Total:       $${apiTotal.toFixed(2)}`)

    // Analysis
    console.log(`\nANALYSIS:`)
    const expectedShipping = excel.fulfillment + excel.surcharge
    console.log(`  Excel (fulfillment + surcharge): $${expectedShipping.toFixed(2)}`)
    console.log(`  API Shipping:                    $${apiShipping.toFixed(2)}`)
    console.log(`  Match: ${Math.abs(expectedShipping - apiShipping) < 0.01 ? '✅ YES' : '❌ NO'}`)

    console.log(`\n  Excel Pick Fees: $${excel.pickFees}`)
    console.log(`  API Per Pick Fee: $${apiPick.toFixed(2)}`)
    console.log(`  Match: ${Math.abs(excel.pickFees - apiPick) < 0.01 ? '✅ YES' : '❌ NO'}`)

    console.log(`\n  Excel Total: $${excel.total.toFixed(2)}`)
    console.log(`  API Total:   $${apiTotal.toFixed(2)}`)
    console.log(`  Match: ${Math.abs(excel.total - apiTotal) < 0.01 ? '✅ YES' : '❌ NO'}`)
  }

  console.log('\n' + '═'.repeat(80))
  console.log('CONCLUSION')
  console.log('═'.repeat(80))
  console.log(`
The API structure is:
  - "Shipping" transaction = fulfillment_cost + surcharge (COMBINED)
  - "Per Pick Fee" transaction = pick_fees (SEPARATE)

The surcharge is NOT broken out separately in the API.
It is baked into the Shipping transaction amount.

To get surcharge breakdown, you would need:
  1. Excel import (has separate columns)
  2. OR reverse-engineer from carrier rate cards (complex)
  3. OR ask ShipBob if there's another endpoint with breakdown
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
