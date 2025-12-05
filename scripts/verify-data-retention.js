#!/usr/bin/env node
/**
 * Rigorous verification of the data retention hypothesis
 * Test multiple approaches to get historical transaction data
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function fetchWithAuth(endpoint, options = {}) {
  const url = `${BASE_URL}${endpoint}`
  console.log(`  → ${options.method || 'GET'} ${endpoint.substring(0, 80)}...`)

  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  })

  const status = response.status
  if (!response.ok) {
    const text = await response.text()
    return { error: true, status, message: text.substring(0, 200) }
  }

  return response.json()
}

async function main() {
  console.log('═'.repeat(60))
  console.log('RIGOROUS DATA RETENTION VERIFICATION')
  console.log('═'.repeat(60))

  // TEST 1: Try GET /invoices/{id}/transactions with older invoices
  console.log('\n--- TEST 1: Direct invoice transaction queries ---\n')

  const testInvoices = [
    { id: 8633612, date: 'Dec 1', desc: 'This week' },
    { id: 8595597, date: 'Nov 24', desc: '1 week ago' },
    { id: 8564590, date: 'Nov 17', desc: '2 weeks ago' },
    { id: 8527436, date: 'Nov 10', desc: '3 weeks ago' },
  ]

  for (const inv of testInvoices) {
    const result = await fetchWithAuth(`/2025-07/invoices/${inv.id}/transactions?Limit=10`)
    if (result.error) {
      console.log(`  ${inv.date} (#${inv.id}): ERROR ${result.status}`)
    } else {
      const count = result.items?.length || 0
      const hasMore = result.next ? 'more available' : 'no more'
      console.log(`  ${inv.date} (#${inv.id}): ${count} transactions (${hasMore})`)
    }
  }

  // TEST 2: Try POST /transactions:query with specific date ranges
  console.log('\n--- TEST 2: POST /transactions:query with date filters ---\n')

  const dateRanges = [
    { start: '2025-11-27', end: '2025-12-01', desc: 'Nov 27 - Dec 1' },
    { start: '2025-11-24', end: '2025-11-26', desc: 'Nov 24-26 (missing?)' },
    { start: '2025-11-17', end: '2025-11-23', desc: 'Nov 17-23' },
    { start: '2025-11-01', end: '2025-11-30', desc: 'Full November' },
  ]

  for (const range of dateRanges) {
    const result = await fetchWithAuth('/2025-07/transactions:query', {
      method: 'POST',
      body: JSON.stringify({
        start_date: range.start,
        end_date: range.end,
        page_size: 100
      })
    })

    if (result.error) {
      console.log(`  ${range.desc}: ERROR ${result.status}`)
    } else {
      const count = result.items?.length || 0
      const total = result.items?.reduce((sum, tx) => sum + tx.amount, 0) || 0
      const dates = result.items?.map(tx => tx.charge_date).filter(Boolean) || []
      const uniqueDates = [...new Set(dates)].sort()
      console.log(`  ${range.desc}: ${count} txns, $${total.toFixed(2)}`)
      if (uniqueDates.length > 0) {
        console.log(`    Actual dates returned: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length-1]}`)
      }
    }
  }

  // TEST 3: Try with invoice_ids filter
  console.log('\n--- TEST 3: POST /transactions:query with invoice_ids filter ---\n')

  for (const inv of testInvoices.slice(0, 2)) {
    const result = await fetchWithAuth('/2025-07/transactions:query', {
      method: 'POST',
      body: JSON.stringify({
        invoice_ids: [inv.id],
        page_size: 100
      })
    })

    if (result.error) {
      console.log(`  Invoice ${inv.id} (${inv.date}): ERROR ${result.status}`)
    } else {
      const count = result.items?.length || 0
      console.log(`  Invoice ${inv.id} (${inv.date}): ${count} transactions`)
    }
  }

  // TEST 4: Check if there's invoiced_status filter that helps
  console.log('\n--- TEST 4: Query by invoiced_status ---\n')

  const statusTests = [
    { invoiced_status: true, desc: 'invoiced=true' },
    { invoiced_status: false, desc: 'invoiced=false' },
  ]

  for (const test of statusTests) {
    const result = await fetchWithAuth('/2025-07/transactions:query', {
      method: 'POST',
      body: JSON.stringify({
        invoiced_status: test.invoiced_status,
        page_size: 100
      })
    })

    if (result.error) {
      console.log(`  ${test.desc}: ERROR ${result.status}`)
    } else {
      const count = result.items?.length || 0
      const dates = result.items?.map(tx => tx.charge_date).filter(Boolean).sort() || []
      console.log(`  ${test.desc}: ${count} txns`)
      if (dates.length > 0) {
        console.log(`    Date range: ${dates[0]} to ${dates[dates.length-1]}`)
      }
    }
  }

  // TEST 5: Check 1.0 API (maybe different retention?)
  console.log('\n--- TEST 5: Try 1.0 API endpoints ---\n')

  const oldEndpoints = [
    `/1.0/billing/invoices/${testInvoices[1].id}/transactions`,
    `/1.0/billing/transactions?InvoiceId=${testInvoices[1].id}`,
  ]

  for (const endpoint of oldEndpoints) {
    const result = await fetchWithAuth(endpoint)
    if (result.error) {
      console.log(`  ${endpoint.substring(0, 50)}: ${result.status} - ${result.message?.substring(0, 50)}`)
    } else {
      const count = Array.isArray(result) ? result.length : (result.items?.length || 0)
      console.log(`  ${endpoint.substring(0, 50)}: ${count} transactions`)
    }
  }

  // TEST 6: Check raw API response headers for clues
  console.log('\n--- TEST 6: Check response headers ---\n')

  const url = `${BASE_URL}/2025-07/invoices/${testInvoices[1].id}/transactions?Limit=10`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })

  console.log(`  Status: ${response.status}`)
  console.log(`  Headers:`)
  for (const [key, value] of response.headers.entries()) {
    if (key.toLowerCase().includes('x-') || key.toLowerCase().includes('rate') || key.toLowerCase().includes('page')) {
      console.log(`    ${key}: ${value}`)
    }
  }

  const body = await response.json()
  console.log(`  Body keys: ${Object.keys(body).join(', ')}`)
  console.log(`  Items count: ${body.items?.length || 0}`)

  // Summary
  console.log('\n' + '═'.repeat(60))
  console.log('SUMMARY')
  console.log('═'.repeat(60))
  console.log(`
Key questions answered:
1. Can we get Nov 24 invoice transactions via GET endpoint?
2. Can we get them via POST with date filter?
3. Can we get them via POST with invoice_ids filter?
4. Does 1.0 API have different retention?

If ALL approaches return 0 for older invoices, the 7-day window is confirmed.
If ANY approach returns data, we have a workaround.
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
