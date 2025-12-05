#!/usr/bin/env node
/**
 * Test different pagination approaches for the per-invoice transactions endpoint
 */
require('dotenv').config({ path: '.env.local' })
const token = process.env.SHIPBOB_API_TOKEN

const SHIPPING_INVOICE = 8595597 // Nov 24 Shipping - $13,003.29

async function test() {
  console.log(`=== Testing Pagination for Invoice ${SHIPPING_INVOICE} ===\n`)
  console.log('Invoice has $13,003.29 but we only get ~$6,565 (1000 tx limit)\n')

  // Test 1: Default (pageSize=1000)
  console.log('Test 1: Default pageSize=1000...')
  const response1 = await fetch(`https://api.shipbob.com/2025-07/invoices/${SHIPPING_INVOICE}/transactions?pageSize=1000`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  })
  const data1 = await response1.json()
  const items1 = data1.items || data1 || []
  console.log(`  Items: ${items1.length}`)
  console.log(`  Total: $${items1.reduce((s, t) => s + t.amount, 0).toFixed(2)}`)
  console.log(`  Has 'next' cursor: ${!!data1.next}`)
  if (data1.next) console.log(`  Next cursor: ${data1.next.substring(0, 50)}...`)

  // Test 2: Try page parameter
  console.log('\nTest 2: Try page=2...')
  const response2 = await fetch(`https://api.shipbob.com/2025-07/invoices/${SHIPPING_INVOICE}/transactions?pageSize=1000&page=2`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  })
  const data2 = await response2.json()
  const items2 = data2.items || data2 || []
  console.log(`  Items: ${Array.isArray(items2) ? items2.length : 'error'}`)
  if (Array.isArray(items2) && items2.length > 0) {
    console.log(`  Total: $${items2.reduce((s, t) => s + t.amount, 0).toFixed(2)}`)
    // Check if different from page 1
    const firstIds1 = items1.slice(0, 3).map(t => t.transaction_id)
    const firstIds2 = items2.slice(0, 3).map(t => t.transaction_id)
    console.log(`  Page 1 first IDs: ${firstIds1.join(', ')}`)
    console.log(`  Page 2 first IDs: ${firstIds2.join(', ')}`)
    console.log(`  Different data: ${firstIds1[0] !== firstIds2[0]}`)
  }

  // Test 3: Try cursor from response
  if (data1.next) {
    console.log('\nTest 3: Using cursor from response...')
    const response3 = await fetch(`https://api.shipbob.com/2025-07/invoices/${SHIPPING_INVOICE}/transactions?pageSize=1000&cursor=${encodeURIComponent(data1.next)}`, {
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    })
    const data3 = await response3.json()
    const items3 = data3.items || data3 || []
    console.log(`  Items: ${Array.isArray(items3) ? items3.length : 'error'}`)
    if (Array.isArray(items3) && items3.length > 0) {
      console.log(`  Total: $${items3.reduce((s, t) => s + t.amount, 0).toFixed(2)}`)
      const firstIds3 = items3.slice(0, 3).map(t => t.transaction_id)
      console.log(`  Page 1 first IDs: ${items1.slice(0, 3).map(t => t.transaction_id).join(', ')}`)
      console.log(`  Cursor first IDs: ${firstIds3.join(', ')}`)
      console.log(`  Different data: ${items1[0].transaction_id !== items3[0].transaction_id}`)
    }
  }

  // Test 4: Try offset parameter
  console.log('\nTest 4: Try offset=1000...')
  const response4 = await fetch(`https://api.shipbob.com/2025-07/invoices/${SHIPPING_INVOICE}/transactions?pageSize=1000&offset=1000`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  })
  const data4 = await response4.json()
  const items4 = data4.items || data4 || []
  console.log(`  Items: ${Array.isArray(items4) ? items4.length : 'error'}`)
  if (Array.isArray(items4) && items4.length > 0) {
    console.log(`  Total: $${items4.reduce((s, t) => s + t.amount, 0).toFixed(2)}`)
  }

  // Test 5: Try skip parameter
  console.log('\nTest 5: Try skip=1000...')
  const response5 = await fetch(`https://api.shipbob.com/2025-07/invoices/${SHIPPING_INVOICE}/transactions?pageSize=1000&skip=1000`, {
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
  })
  const data5 = await response5.json()
  const items5 = data5.items || data5 || []
  console.log(`  Items: ${Array.isArray(items5) ? items5.length : 'error'}`)
  if (Array.isArray(items5) && items5.length > 0) {
    console.log(`  Total: $${items5.reduce((s, t) => s + t.amount, 0).toFixed(2)}`)
  }

  // Summary
  console.log('\n\n=== SUMMARY ===')
  console.log('Invoice total: $13,003.29')
  console.log(`API returned: $${items1.reduce((s, t) => s + t.amount, 0).toFixed(2)} (${items1.length} tx)`)
  console.log(`Missing: $${(13003.29 - items1.reduce((s, t) => s + t.amount, 0)).toFixed(2)}`)
  console.log('\nConclusion: ShipBob API limits per-invoice transactions to 1000 items')
  console.log('and pagination appears to be broken (returns same data).')
}

test().catch(console.error)
