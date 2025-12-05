#!/usr/bin/env node
/**
 * Test the sync module directly (TypeScript via npx tsx)
 */

require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

async function testDirectQuery() {
  console.log('=== Testing Direct API with page_size: 1000 ===\n')

  const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: '2025-10-27',  // 30 days back from Nov 26
      end_date: '2025-11-26',
      page_size: 1000
    })
  })

  const data = await response.json()
  console.log(`Transactions returned: ${data.items?.length || 0}`)
  console.log(`Has more (next cursor): ${!!data.next}`)

  const total = (data.items || []).reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`Total amount: $${total.toFixed(2)}`)

  // By invoiced status
  const invoiced = (data.items || []).filter(tx => tx.invoiced_status)
  const pending = (data.items || []).filter(tx => !tx.invoiced_status)
  console.log(`\nInvoiced: ${invoiced.length} tx ($${invoiced.reduce((s, t) => s + t.amount, 0).toFixed(2)})`)
  console.log(`Pending: ${pending.length} tx ($${pending.reduce((s, t) => s + t.amount, 0).toFixed(2)})`)

  // By fee type
  console.log('\nBy fee type:')
  const byFee = {}
  for (const tx of data.items || []) {
    const fee = tx.transaction_fee
    if (!byFee[fee]) byFee[fee] = { count: 0, total: 0 }
    byFee[fee].count++
    byFee[fee].total += tx.amount
  }
  Object.entries(byFee)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([fee, stats]) => {
      console.log(`  ${fee.padEnd(30)}: ${stats.count.toString().padStart(4)} tx = $${stats.total.toFixed(2).padStart(10)}`)
    })

  // By charge date
  console.log('\nBy charge_date:')
  const byDate = {}
  for (const tx of data.items || []) {
    const d = tx.charge_date
    if (!byDate[d]) byDate[d] = { count: 0, total: 0 }
    byDate[d].count++
    byDate[d].total += tx.amount
  }
  Object.entries(byDate)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .forEach(([date, stats]) => {
      console.log(`  ${date}: ${stats.count.toString().padStart(4)} tx = $${stats.total.toFixed(2).padStart(10)}`)
    })
}

testDirectQuery().catch(console.error)
