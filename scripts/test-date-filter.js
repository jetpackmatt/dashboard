#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

async function test() {
  console.log('=== Testing Date Filter Behavior ===\n')

  // Test 1: Without page_size (default 100)
  console.log('Test 1: Nov 10-17 WITHOUT page_size...')
  const response1 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date: '2025-11-10', end_date: '2025-11-17' })
  })
  const data1 = await response1.json()
  console.log(`  Items: ${data1.items?.length}`)
  const dates1 = {}
  for (const tx of data1.items || []) {
    const d = tx.charge_date
    if (!dates1[d]) dates1[d] = 0
    dates1[d]++
  }
  console.log(`  By charge_date: ${JSON.stringify(dates1)}`)
  const inv1 = (data1.items || []).filter(tx => tx.invoiced_status).length
  console.log(`  Invoiced: ${inv1}, Pending: ${data1.items?.length - inv1}`)

  // Test 2: Nov 24-26 without page_size
  console.log('\nTest 2: Nov 24-26 WITHOUT page_size...')
  const response2 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ start_date: '2025-11-24', end_date: '2025-11-26' })
  })
  const data2 = await response2.json()
  console.log(`  Items: ${data2.items?.length}`)
  const dates2 = {}
  for (const tx of data2.items || []) {
    const d = tx.charge_date
    if (!dates2[d]) dates2[d] = 0
    dates2[d]++
  }
  console.log(`  By charge_date: ${JSON.stringify(dates2)}`)

  // Test 3: Try filtering by invoice_id instead
  console.log('\nTest 3: Filter by specific invoice_id...')
  const response3 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ invoice_ids: [8595597], page_size: 1000 })
  })
  const data3 = await response3.json()
  console.log(`  Items: ${data3.items?.length}`)
  console.log(`  Has next: ${!!data3.next}`)
  const total3 = (data3.items || []).reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`  Total: $${total3.toFixed(2)}`)
  // Show dates
  const dates3 = {}
  for (const tx of data3.items || []) {
    const d = tx.charge_date
    if (!dates3[d]) dates3[d] = 0
    dates3[d]++
  }
  console.log(`  By charge_date: ${JSON.stringify(dates3)}`)
  console.log(`  All invoiced: ${(data3.items || []).every(tx => tx.invoiced_status)}`)

  // Test 4: Check what invoices exist
  console.log('\nTest 4: List recent invoices...')
  const response4 = await fetch('https://api.shipbob.com/2025-07/invoices?startDate=2025-11-01&endDate=2025-11-26&pageSize=10', {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  })
  const data4 = await response4.json()
  console.log('  Invoices:')
  for (const inv of (data4.items || []).slice(0, 5)) {
    console.log(`    ${inv.invoice_id} | ${inv.invoice_date} | ${inv.invoice_type} | $${inv.amount}`)
  }
}

test().catch(console.error)
