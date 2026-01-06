#!/usr/bin/env node
/**
 * Check if FC transactions have invoice_id when fetched via transactions:query
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_API_TOKEN = process.env.SHIPBOB_API_TOKEN

async function main() {
  console.log('Fetching ALL transactions from Dec 1-22 to find FC transactions')
  console.log('='.repeat(60))

  const allTx = []
  let cursor = null

  do {
    let url = 'https://api.shipbob.com/2025-07/transactions:query'
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_date: '2025-12-01T00:00:00Z',
        to_date: '2025-12-23T00:00:00Z',
        page_size: 1000,
      }),
    })

    if (!response.ok) {
      console.log(`Error ${response.status}: ${await response.text()}`)
      return
    }

    const data = await response.json()
    allTx.push(...(data.items || []))
    cursor = data.next
    console.log(`Fetched page, total: ${allTx.length} transactions`)
  } while (cursor && allTx.length < 20000)

  // Find FC transactions
  const fcTx = allTx.filter(tx => tx.reference_type === 'FC')
  console.log(`\nFC (storage) transactions: ${fcTx.length}`)

  if (fcTx.length > 0) {
    console.log('\nSample FC transactions:')
    for (const tx of fcTx.slice(0, 5)) {
      console.log({
        transaction_id: tx.transaction_id,
        charge_date: tx.charge_date,
        invoice_id: tx.invoice_id,
        invoiced_status: tx.invoiced_status,
        amount: tx.amount,
      })
    }

    // Check which invoice_ids the FC transactions have
    const invoiceCounts = {}
    for (const tx of fcTx) {
      const inv = tx.invoice_id || 'NULL'
      invoiceCounts[inv] = (invoiceCounts[inv] || 0) + 1
    }
    console.log('\nFC transactions by invoice_id:')
    for (const [inv, count] of Object.entries(invoiceCounts)) {
      console.log(`  ${inv}: ${count}`)
    }
  } else {
    console.log('No FC transactions found in API response!')
  }

  // Reference type breakdown
  const refTypeCounts = {}
  for (const tx of allTx) {
    refTypeCounts[tx.reference_type] = (refTypeCounts[tx.reference_type] || 0) + 1
  }
  console.log('\nAll reference types:')
  for (const [type, count] of Object.entries(refTypeCounts)) {
    console.log(`  ${type}: ${count}`)
  }
}

main().catch(console.error)
