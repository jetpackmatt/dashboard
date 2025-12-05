#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

async function test() {
  console.log('=== Testing Different Date Ranges ===\n')

  // Test 1: Older range (should have invoiced transactions)
  console.log('Test 1: Nov 10-17 (should be invoiced)...')
  const response1 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: '2025-11-10',
      end_date: '2025-11-17',
      page_size: 1000
    })
  })
  const data1 = await response1.json()
  console.log(`  Items: ${data1.items?.length || 0}`)
  console.log(`  Has next: ${!!data1.next}`)
  const inv1 = (data1.items || []).filter(tx => tx.invoiced_status).length
  const pend1 = (data1.items || []).filter(tx => !tx.invoiced_status).length
  console.log(`  Invoiced: ${inv1}, Pending: ${pend1}`)
  const total1 = (data1.items || []).reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`  Total: $${total1.toFixed(2)}`)

  // Group by charge_date
  const dates1 = {}
  for (const tx of data1.items || []) {
    const d = tx.charge_date
    if (!dates1[d]) dates1[d] = 0
    dates1[d]++
  }
  console.log(`  By charge_date: ${JSON.stringify(dates1)}`)

  // Test 2: Very old range
  console.log('\nTest 2: Nov 1-10 (should be invoiced)...')
  const response2 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: '2025-11-01',
      end_date: '2025-11-10',
      page_size: 1000
    })
  })
  const data2 = await response2.json()
  console.log(`  Items: ${data2.items?.length || 0}`)
  console.log(`  Has next: ${!!data2.next}`)
  const inv2 = (data2.items || []).filter(tx => tx.invoiced_status).length
  const pend2 = (data2.items || []).filter(tx => !tx.invoiced_status).length
  console.log(`  Invoiced: ${inv2}, Pending: ${pend2}`)
  const total2 = (data2.items || []).reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`  Total: $${total2.toFixed(2)}`)

  // Group by charge_date
  const dates2 = {}
  for (const tx of data2.items || []) {
    const d = tx.charge_date
    if (!dates2[d]) dates2[d] = 0
    dates2[d]++
  }
  console.log(`  By charge_date: ${JSON.stringify(dates2)}`)

  // Test 3: Recent range (uninvoiced)
  console.log('\nTest 3: Nov 24-26 (uninvoiced)...')
  const response3 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      start_date: '2025-11-24',
      end_date: '2025-11-26',
      page_size: 1000
    })
  })
  const data3 = await response3.json()
  console.log(`  Items: ${data3.items?.length || 0}`)
  console.log(`  Has next: ${!!data3.next}`)
  const inv3 = (data3.items || []).filter(tx => tx.invoiced_status).length
  const pend3 = (data3.items || []).filter(tx => !tx.invoiced_status).length
  console.log(`  Invoiced: ${inv3}, Pending: ${pend3}`)
  const total3 = (data3.items || []).reduce((sum, tx) => sum + tx.amount, 0)
  console.log(`  Total: $${total3.toFixed(2)}`)

  // Group by charge_date
  const dates3 = {}
  for (const tx of data3.items || []) {
    const d = tx.charge_date
    if (!dates3[d]) dates3[d] = 0
    dates3[d]++
  }
  console.log(`  By charge_date: ${JSON.stringify(dates3)}`)

  // Show some sample IDs to verify they're different
  console.log('\nSample transaction IDs:')
  console.log(`  Nov 10-17: ${(data1.items || []).slice(0, 3).map(t => t.transaction_id).join(', ')}`)
  console.log(`  Nov 1-10:  ${(data2.items || []).slice(0, 3).map(t => t.transaction_id).join(', ')}`)
  console.log(`  Nov 24-26: ${(data3.items || []).slice(0, 3).map(t => t.transaction_id).join(', ')}`)
}

test().catch(console.error)
