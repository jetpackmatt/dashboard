#!/usr/bin/env node
/**
 * Analyze all Dec 1 invoices and their transaction availability
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function getAllTransactions(invoiceId, invoiceType) {
  const allItems = []
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    let endpoint = `${BASE_URL}/2025-07/invoices/${invoiceId}/transactions?PageSize=1000`
    if (cursor) endpoint += `&Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${SHIPBOB_TOKEN}` }
    })

    if (!response.ok) break

    const data = await response.json()
    allItems.push(...(data.items || []))
    cursor = data.next || null

    if (pageNum >= 20) break
  } while (cursor)

  return allItems
}

async function main() {
  console.log('Analyzing Dec 1 invoices - Transaction availability\n')

  // Dec 1 invoices
  const dec1Invoices = [
    { id: 8633641, type: 'Credits', amount: -686.12 },
    { id: 8633637, type: 'ReturnsFee', amount: 14.79 },
    { id: 8633634, type: 'AdditionalFee', amount: 896.17 },
    { id: 8633632, type: 'WarehouseInboundFee', amount: 35.00 },
    { id: 8633618, type: 'WarehouseStorage', amount: 2564.28 },
    { id: 8633612, type: 'Shipping', amount: 11127.61 },
  ]

  let totalInvoiceAmount = 0
  let totalTransactionAmount = 0

  console.log('═'.repeat(80))
  console.log('Invoice Analysis')
  console.log('═'.repeat(80))

  for (const inv of dec1Invoices) {
    const txns = await getAllTransactions(inv.id, inv.type)
    const txnTotal = txns.reduce((sum, t) => sum + t.amount, 0)

    const dates = txns.map(t => t.charge_date).filter(Boolean).sort()
    const uniqueDates = [...new Set(dates)]

    totalInvoiceAmount += inv.amount
    totalTransactionAmount += txnTotal

    const pct = inv.amount !== 0 ? ((txnTotal / inv.amount) * 100).toFixed(1) : 'N/A'
    const gap = inv.amount - txnTotal

    console.log(`\n${inv.type} (#${inv.id})`)
    console.log(`  Invoice total:     $${inv.amount.toFixed(2)}`)
    console.log(`  Transactions:      ${txns.length} txns, $${txnTotal.toFixed(2)} (${pct}%)`)
    console.log(`  Gap:               $${gap.toFixed(2)}`)
    console.log(`  Date range:        ${uniqueDates.length > 0 ? `${uniqueDates[0]} to ${uniqueDates[uniqueDates.length-1]}` : 'No dates'}`)

    if (uniqueDates.length > 0) {
      console.log(`  Dates with txns:   ${uniqueDates.join(', ')}`)
    }
  }

  console.log('\n' + '═'.repeat(80))
  console.log('SUMMARY')
  console.log('═'.repeat(80))
  console.log(`\nTotal invoice amounts:      $${totalInvoiceAmount.toFixed(2)}`)
  console.log(`Total transaction amounts:  $${totalTransactionAmount.toFixed(2)}`)
  console.log(`Gap:                        $${(totalInvoiceAmount - totalTransactionAmount).toFixed(2)}`)
  console.log(`Recovery rate:              ${((totalTransactionAmount / totalInvoiceAmount) * 100).toFixed(1)}%`)

  console.log(`\nConclusion:`)
  console.log(`The API only returns transactions from Nov 27+ (within 7-day window).`)
  console.log(`Transactions from Nov 24-26 have expired and are not retrievable via API.`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
