#!/usr/bin/env node
/**
 * Export all pending transactions from ShipBob API to Excel
 */
require('dotenv').config({ path: '.env.local' })
const XLSX = require('xlsx')

const token = process.env.SHIPBOB_API_TOKEN
const API_BASE = 'https://api.shipbob.com/2025-07'

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  return response.json()
}

async function main() {
  console.log('Fetching all pending transactions...')

  let allTransactions = []
  let cursor = null
  let page = 0

  do {
    const body = { page_size: 1000 }
    if (cursor) body.cursor = cursor

    const data = await fetchJson(`${API_BASE}/transactions:query`, {
      method: 'POST',
      body: JSON.stringify(body)
    })

    const items = data.items || []
    allTransactions.push(...items)
    cursor = data.next
    page++

    console.log(`Page ${page}: ${items.length} transactions (total: ${allTransactions.length})`)

    // Safety limit - remove or increase for full export
    if (page >= 100) {
      console.log('(Stopped at 100 pages)')
      break
    }
  } while (cursor)

  console.log(`\nTotal transactions: ${allTransactions.length}`)

  // Flatten for Excel
  const rows = allTransactions.map(tx => ({
    transaction_id: tx.transaction_id,
    charge_date: tx.charge_date,
    amount: tx.amount,
    currency_code: tx.currency_code,
    transaction_fee: tx.transaction_fee,
    transaction_type: tx.transaction_type,
    reference_id: tx.reference_id,
    reference_type: tx.reference_type,
    fulfillment_center: tx.fulfillment_center,
    invoiced_status: tx.invoiced_status,
    invoice_id: tx.invoice_id,
    invoice_date: tx.invoice_date,
    invoice_type: tx.invoice_type,
    tracking_id: tx.additional_details?.TrackingId || '',
    comment: tx.additional_details?.Comment || '',
    taxes: JSON.stringify(tx.taxes || [])
  }))

  // Create workbook
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Pending Transactions')

  // Write file
  const filename = `scripts/output/pending-transactions-${new Date().toISOString().split('T')[0]}.xlsx`
  XLSX.writeFile(wb, filename)
  console.log(`\nExported to: ${filename}`)

  // Summary stats
  console.log('\n--- SUMMARY ---')
  const byType = {}
  const byFC = {}
  for (const tx of allTransactions) {
    byType[tx.reference_type] = (byType[tx.reference_type] || 0) + 1
    byFC[tx.fulfillment_center] = (byFC[tx.fulfillment_center] || 0) + 1
  }

  console.log('\nBy reference_type:')
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }

  console.log('\nBy fulfillment_center (top 10):')
  const topFCs = Object.entries(byFC).sort((a, b) => b[1] - a[1]).slice(0, 10)
  for (const [fc, count] of topFCs) {
    console.log(`  ${fc}: ${count}`)
  }
}

main().catch(console.error)
