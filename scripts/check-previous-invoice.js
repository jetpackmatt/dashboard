#!/usr/bin/env node
/**
 * Check if Nov 24-26 transactions are in the previous week's invoice (Nov 24)
 * or if they're genuinely missing from the Dec 1 invoice
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
  console.log('Comparing consecutive shipping invoices\n')

  // Invoice dates:
  // Dec 1 (8633612): $11,127.61
  // Nov 24 (8595597): $13,003.29

  const invoices = [
    { id: 8633612, date: 'Dec 1', amount: 11127.61 },
    { id: 8595597, date: 'Nov 24', amount: 13003.29 },
    { id: 8564590, date: 'Nov 17', amount: 13429.47 },
    { id: 8527436, date: 'Nov 10', amount: 10797.22 },
  ]

  for (const inv of invoices) {
    console.log(`\n${'═'.repeat(50)}`)
    console.log(`Invoice #${inv.id} (${inv.date}) - $${inv.amount}`)
    console.log('═'.repeat(50))

    const transactions = await getAllInvoiceTransactions(inv.id)

    const apiTotal = transactions.reduce((sum, tx) => sum + tx.amount, 0)
    const dates = transactions.map(tx => tx.charge_date).filter(Boolean).sort()

    console.log(`Transactions: ${transactions.length}`)
    console.log(`API total: $${apiTotal.toFixed(2)}`)
    console.log(`Gap: $${(inv.amount - apiTotal).toFixed(2)} (${((inv.amount - apiTotal) / inv.amount * 100).toFixed(1)}%)`)
    console.log(`Date range: ${dates[0]} to ${dates[dates.length - 1]}`)

    // Group by date
    const byDate = {}
    for (const tx of transactions) {
      const date = tx.charge_date || 'NULL'
      if (!byDate[date]) byDate[date] = { count: 0, amount: 0 }
      byDate[date].count++
      byDate[date].amount += tx.amount
    }

    console.log('\nBy date:')
    for (const [date, data] of Object.entries(byDate).sort()) {
      console.log(`  ${date}: ${data.count} txns, $${data.amount.toFixed(2)}`)
    }
  }

  // Summary
  console.log(`\n\n${'═'.repeat(50)}`)
  console.log('SUMMARY')
  console.log('═'.repeat(50))

  console.log(`
If each invoice covers the preceding week (Mon-Sun):
- Dec 1 invoice should cover: Nov 24 - Nov 30
- Nov 24 invoice should cover: Nov 17 - Nov 23
- Nov 17 invoice should cover: Nov 10 - Nov 16
- Nov 10 invoice should cover: Nov 3 - Nov 9

Compare the charge_date ranges to see if this matches.
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
