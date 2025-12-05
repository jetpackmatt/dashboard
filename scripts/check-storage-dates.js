#!/usr/bin/env node
/**
 * Check storage transaction dates - they were 100% match, why?
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function fetchWithAuth(endpoint) {
  const url = `${BASE_URL}${endpoint}`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  if (!response.ok) throw new Error(`${response.status}`)
  return response.json()
}

async function getAllInvoiceTransactions(invoiceId) {
  const all = []
  let cursor = null
  do {
    let endpoint = `/2025-07/invoices/${invoiceId}/transactions?Limit=250`
    if (cursor) endpoint += `&Cursor=${encodeURIComponent(cursor)}`
    const data = await fetchWithAuth(endpoint)
    all.push(...(data.items || []))
    cursor = data.next || null
  } while (cursor)
  return all
}

async function main() {
  console.log('Checking storage transaction dates\n')

  // Storage invoice from Dec 1: 8633618 - $2,564.28 (was 100% match)
  const STORAGE_ID = 8633618

  const transactions = await getAllInvoiceTransactions(STORAGE_ID)
  const apiTotal = transactions.reduce((sum, tx) => sum + tx.amount, 0)

  console.log(`Storage Invoice #${STORAGE_ID}`)
  console.log(`Known amount: $2,564.28`)
  console.log(`API total: $${apiTotal.toFixed(2)}`)
  console.log(`Transactions: ${transactions.length}`)

  // Check charge dates
  const dates = transactions.map(tx => tx.charge_date).filter(Boolean)
  const uniqueDates = [...new Set(dates)].sort()

  console.log(`\nCharge dates found: ${uniqueDates.length}`)
  for (const date of uniqueDates) {
    const count = dates.filter(d => d === date).length
    console.log(`  ${date}: ${count} transactions`)
  }

  // Storage transactions are often dated on invoice date, not daily
  console.log(`\n--- Why Storage is Different ---`)
  console.log(`Storage charges are typically calculated monthly/weekly and`)
  console.log(`all transactions get the invoice date as charge_date.`)
  console.log(`This means all storage transactions have dates within the 7-day window.`)

  // Check sample transaction
  if (transactions[0]) {
    console.log(`\nSample storage transaction:`)
    console.log(JSON.stringify(transactions[0], null, 2))
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
