#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

async function queryDay(date) {
  const response = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: date,
      end_date: date,
      page_size: 1000
    })
  })
  const data = await response.json()
  return {
    items: data.items || [],
    hasMore: !!data.next
  }
}

async function testDailyQuery() {
  console.log('=== Query Day by Day (Nov 20-26) ===\n')

  const dates = ['2025-11-20', '2025-11-21', '2025-11-22', '2025-11-23', '2025-11-24', '2025-11-25', '2025-11-26']
  const allItems = []
  const seenIds = new Set()

  for (const date of dates) {
    const result = await queryDay(date)
    let newCount = 0
    let dupeCount = 0

    for (const item of result.items) {
      if (seenIds.has(item.transaction_id)) {
        dupeCount++
      } else {
        seenIds.add(item.transaction_id)
        allItems.push(item)
        newCount++
      }
    }

    const dayTotal = result.items.reduce((sum, tx) => sum + tx.amount, 0)
    const warning = result.hasMore ? ' ⚠️ MORE AVAILABLE' : ''
    console.log(`  ${date}: ${result.items.length.toString().padStart(4)} tx (${newCount} new) = $${dayTotal.toFixed(2).padStart(10)}${warning}`)
  }

  console.log(`\n=== TOTAL ===`)
  console.log(`Unique transactions: ${allItems.length}`)
  const grandTotal = allItems.reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`Total amount: $${grandTotal.toFixed(2)}`)

  // By fee type
  console.log('\nBy fee type:')
  const byFee = {}
  for (const tx of allItems) {
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

  // Check invoiced vs uninvoiced
  console.log('\nBy invoiced status:')
  const byInvoiced = { invoiced: { count: 0, total: 0 }, pending: { count: 0, total: 0 } }
  for (const tx of allItems) {
    const key = tx.invoiced_status ? 'invoiced' : 'pending'
    byInvoiced[key].count++
    byInvoiced[key].total += tx.amount
  }
  console.log(`  Invoiced:  ${byInvoiced.invoiced.count.toString().padStart(4)} tx = $${byInvoiced.invoiced.total.toFixed(2).padStart(10)}`)
  console.log(`  Pending:   ${byInvoiced.pending.count.toString().padStart(4)} tx = $${byInvoiced.pending.total.toFixed(2).padStart(10)}`)
}

testDailyQuery().catch(console.error)
