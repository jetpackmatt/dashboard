#!/usr/bin/env node
/**
 * Query all transactions for a specific order ID
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

const ORDER_ID = process.argv[2] || '314479977'

async function main() {
  const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      order_ids: [parseInt(ORDER_ID)],
      page_size: 1000
    })
  })

  const data = await response.json()
  const items = data.items || []

  console.log(`Order ID: ${ORDER_ID}`)
  console.log(`Total transactions: ${items.length}`)
  console.log('')

  // Group by fee type
  const byFee = {}
  for (const tx of items) {
    if (!byFee[tx.transaction_fee]) {
      byFee[tx.transaction_fee] = { count: 0, total: 0, items: [] }
    }
    byFee[tx.transaction_fee].count++
    byFee[tx.transaction_fee].total += tx.amount
    byFee[tx.transaction_fee].items.push(tx)
  }

  console.log('Fee Type Breakdown:')
  console.log('─'.repeat(60))

  let grandTotal = 0
  for (const [fee, data] of Object.entries(byFee).sort((a, b) => b[1].total - a[1].total)) {
    console.log(`${fee.padEnd(35)} ${data.count.toString().padStart(4)} txns   $${data.total.toFixed(2)}`)
    grandTotal += data.total
  }

  console.log('─'.repeat(60))
  console.log(`TOTAL                               ${items.length.toString().padStart(4)} txns   $${grandTotal.toFixed(2)}`)

  // Show sample of each fee type
  console.log('\n' + '═'.repeat(60))
  console.log('SAMPLE TRANSACTIONS BY FEE TYPE')
  console.log('═'.repeat(60))

  for (const [fee, data] of Object.entries(byFee)) {
    console.log(`\n${fee} (${data.count} transactions):`)
    const sample = data.items.slice(0, 2)
    for (const tx of sample) {
      console.log(`  Shipment: ${tx.reference_id}, Amount: $${tx.amount}, Date: ${tx.charge_date}`)
    }
  }
}

main().catch(console.error)
