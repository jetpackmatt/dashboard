#!/usr/bin/env node
/**
 * Verify fee breakdown - query by date, filter locally
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

    if (pageNum >= 20) break
  } while (cursor)

  return allItems
}

async function main() {
  console.log('═'.repeat(80))
  console.log('VERIFYING FEE BREAKDOWN: API vs Excel (v2)')
  console.log('═'.repeat(80))

  // Get all transactions for Nov 27
  console.log('\nFetching all Nov 27 transactions...')
  const allTxs = await queryTransactions({
    from_date: '2025-11-27T00:00:00Z',
    to_date: '2025-11-27T23:59:59Z'
  })
  console.log(`Total: ${allTxs.length}`)

  // Orders with surcharges AND pick fees from Excel
  const testOrders = [
    { orderId: '320860433', fulfillment: 5.97, surcharge: 0.15, pickFees: 0.26 },
    { orderId: '320856990', fulfillment: 5.75, surcharge: 0.15, pickFees: 0.26 },
    { orderId: '320895561', fulfillment: 6.38, surcharge: 0.15, pickFees: 0.52 },
    { orderId: '320883423', fulfillment: 6.43, surcharge: 0.15, pickFees: 1.04 },
  ]

  // Group API transactions by reference_id
  const byRef = {}
  for (const tx of allTxs) {
    if (!byRef[tx.reference_id]) byRef[tx.reference_id] = []
    byRef[tx.reference_id].push(tx)
  }

  console.log(`Unique reference_ids: ${Object.keys(byRef).length}`)

  // Check each test order
  console.log('\n' + '─'.repeat(80))

  for (const excel of testOrders) {
    console.log(`\n${'█'.repeat(60)}`)
    console.log(`ORDER ${excel.orderId}`)
    console.log('─'.repeat(40))

    console.log(`EXCEL:`)
    console.log(`  Fulfillment:  $${excel.fulfillment.toFixed(2)}`)
    console.log(`  Surcharge:    $${excel.surcharge.toFixed(2)}`)
    console.log(`  Pick Fees:    $${excel.pickFees.toFixed(2)}`)
    const excelTotal = excel.fulfillment + excel.surcharge + excel.pickFees
    console.log(`  ─────────────────────`)
    console.log(`  Total:        $${excelTotal.toFixed(2)}`)

    const apiTxs = byRef[excel.orderId] || []

    if (apiTxs.length === 0) {
      console.log(`\nAPI: NOT FOUND`)
      continue
    }

    console.log(`\nAPI (${apiTxs.length} transaction${apiTxs.length > 1 ? 's' : ''}):`)

    let apiTotal = 0
    let apiShipping = 0
    let apiPickFee = 0

    for (const tx of apiTxs) {
      console.log(`  ${tx.transaction_fee.padEnd(20)}: $${tx.amount.toFixed(2)}`)
      apiTotal += tx.amount
      if (tx.transaction_fee === 'Shipping') apiShipping = tx.amount
      if (tx.transaction_fee === 'Per Pick Fee') apiPickFee = tx.amount
    }

    console.log(`  ─────────────────────`)
    console.log(`  Total:        $${apiTotal.toFixed(2)}`)

    // Analysis
    console.log(`\n  ANALYSIS:`)
    const excelShippingPlusSurcharge = excel.fulfillment + excel.surcharge
    console.log(`    Excel (fulfillment+surcharge): $${excelShippingPlusSurcharge.toFixed(2)}`)
    console.log(`    API Shipping:                  $${apiShipping.toFixed(2)}`)
    const shippingMatch = Math.abs(excelShippingPlusSurcharge - apiShipping) < 0.02
    console.log(`    → ${shippingMatch ? '✅ SURCHARGE IS BAKED IN' : '❌ MISMATCH'}`)

    console.log(`\n    Excel Pick Fees:               $${excel.pickFees.toFixed(2)}`)
    console.log(`    API Per Pick Fee:              $${apiPickFee.toFixed(2)}`)
    const pickMatch = Math.abs(excel.pickFees - apiPickFee) < 0.02
    console.log(`    → ${pickMatch ? '✅ PICK FEES SEPARATE' : '❌ MISMATCH'}`)

    console.log(`\n    Excel Total:                   $${excelTotal.toFixed(2)}`)
    console.log(`    API Total:                     $${apiTotal.toFixed(2)}`)
    const totalMatch = Math.abs(excelTotal - apiTotal) < 0.02
    console.log(`    → ${totalMatch ? '✅ TOTALS MATCH' : '❌ MISMATCH'}`)
  }

  console.log('\n' + '═'.repeat(80))
  console.log('CONCLUSION')
  console.log('═'.repeat(80))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
