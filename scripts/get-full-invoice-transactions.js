#!/usr/bin/env node
/**
 * Get ALL transactions from ALL invoices
 * This is the correct way to get historical data
 */
require('dotenv').config({ path: '.env.local' })

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
  console.log('='.repeat(100))
  console.log('GET ALL TRANSACTIONS FROM ALL INVOICES')
  console.log('='.repeat(100))

  // Get all invoices
  const invData = await fetchJson(API_BASE + '/invoices?startDate=2020-01-01&endDate=2025-12-31&pageSize=500')
  const invoices = (invData.items || []).filter(i => i.invoice_type !== 'Payment')

  console.log('\nInvoices to process: ' + invoices.length + ' (excluding Payment)')

  const allTransactions = []
  const byType = {}

  for (const inv of invoices) {
    console.log('\nProcessing ' + inv.invoice_type + ' invoice ' + inv.invoice_id + ' (' + inv.invoice_date + ')...')

    let cursor = null
    let invTxs = []

    do {
      let url = API_BASE + '/invoices/' + inv.invoice_id + '/transactions?pageSize=500'
      if (cursor) url += '&cursor=' + encodeURIComponent(cursor)

      const txData = await fetchJson(url)
      const items = txData.items || []
      invTxs.push(...items)
      cursor = txData.next

      if (invTxs.length > 5000) break // Safety limit per invoice
    } while (cursor)

    console.log('  → ' + invTxs.length + ' transactions')
    allTransactions.push(...invTxs)

    // Track by invoice type
    if (!byType[inv.invoice_type]) byType[inv.invoice_type] = { count: 0, amount: 0 }
    byType[inv.invoice_type].count += invTxs.length
    byType[inv.invoice_type].amount += invTxs.reduce((s, t) => s + t.amount, 0)
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('COMPLETE TRANSACTION SUMMARY')
  console.log('█'.repeat(100))

  console.log('\nTotal transactions: ' + allTransactions.length)

  console.log('\nBy invoice type:')
  for (const [type, data] of Object.entries(byType).sort((a, b) => b[1].count - a[1].count)) {
    console.log('  ' + type.padEnd(20) + ': ' + data.count.toString().padStart(6) + ' transactions, $' + data.amount.toFixed(2))
  }

  // Group by fee type
  const byFee = {}
  for (const tx of allTransactions) {
    if (!byFee[tx.transaction_fee]) byFee[tx.transaction_fee] = { count: 0, amount: 0 }
    byFee[tx.transaction_fee].count++
    byFee[tx.transaction_fee].amount += tx.amount
  }

  console.log('\nBy fee type (top 15):')
  const topFees = Object.entries(byFee).sort((a, b) => b[1].count - a[1].count).slice(0, 15)
  for (const [fee, data] of topFees) {
    console.log('  ' + fee.padEnd(35) + ': ' + data.count.toString().padStart(6) + ' transactions, $' + data.amount.toFixed(2))
  }

  // Group by reference_type
  const byRef = {}
  for (const tx of allTransactions) {
    if (!byRef[tx.reference_type]) byRef[tx.reference_type] = { count: 0, fees: {} }
    byRef[tx.reference_type].count++
    byRef[tx.reference_type].fees[tx.transaction_fee] = (byRef[tx.reference_type].fees[tx.transaction_fee] || 0) + 1
  }

  console.log('\nBy reference_type:')
  for (const [refType, data] of Object.entries(byRef).sort((a, b) => b[1].count - a[1].count)) {
    console.log('  ' + refType.padEnd(15) + ': ' + data.count + ' transactions')
    const topFees = Object.entries(data.fees).sort((a, b) => b[1] - a[1]).slice(0, 3)
    for (const [fee, count] of topFees) {
      console.log('    └─ ' + fee + ': ' + count)
    }
  }

  // Date range
  if (allTransactions.length > 0) {
    const dates = allTransactions.map(t => t.charge_date).sort()
    console.log('\nDate range: ' + dates[0] + ' to ' + dates[dates.length - 1])

    // By month
    const byMonth = {}
    for (const tx of allTransactions) {
      const month = tx.charge_date.substring(0, 7)
      byMonth[month] = (byMonth[month] || 0) + 1
    }
    console.log('\nBy month:')
    for (const month of Object.keys(byMonth).sort()) {
      console.log('  ' + month + ': ' + byMonth[month])
    }
  }

  // Sample of each reference_type
  console.log('\n' + '█'.repeat(100))
  console.log('SAMPLE TRANSACTIONS BY REFERENCE_TYPE')
  console.log('█'.repeat(100))

  for (const refType of Object.keys(byRef)) {
    const sample = allTransactions.find(t => t.reference_type === refType)
    if (sample) {
      console.log('\n' + refType + ':')
      console.log(JSON.stringify(sample, null, 2))
    }
  }
}

main().catch(console.error)
