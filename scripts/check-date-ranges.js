#!/usr/bin/env node
/**
 * Check date ranges on invoices and transactions
 * Are we getting the full year or just a limited range?
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
  console.log('DATE RANGE ANALYSIS')
  console.log('='.repeat(100))

  // ============================================================
  // CHECK 1: Invoice date range
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('CHECK 1: INVOICE DATE RANGE (365 days)')
  console.log('█'.repeat(100))

  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 365)

  console.log('\nRequested range: ' + startDate.toISOString().split('T')[0] + ' to ' + endDate.toISOString().split('T')[0])

  let allInvoices = []
  let cursor = null
  let page = 0

  do {
    let url = API_BASE + '/invoices?startDate=' + startDate.toISOString().split('T')[0] +
              '&endDate=' + endDate.toISOString().split('T')[0] + '&pageSize=250'
    if (cursor) url += '&Cursor=' + encodeURIComponent(cursor)

    const data = await fetchJson(url)
    const items = data.items || []
    allInvoices.push(...items)
    cursor = data.next
    page++

    console.log('Page ' + page + ': ' + items.length + ' invoices')

    if (page >= 50) break
  } while (cursor)

  console.log('\nTotal invoices: ' + allInvoices.length)

  // Find date range
  if (allInvoices.length > 0) {
    const dates = allInvoices.map(i => i.invoice_date).sort()
    console.log('Earliest invoice date: ' + dates[0])
    console.log('Latest invoice date: ' + dates[dates.length - 1])

    // Group by month
    const byMonth = {}
    for (const inv of allInvoices) {
      const month = inv.invoice_date.substring(0, 7)
      if (!byMonth[month]) byMonth[month] = { count: 0, types: {} }
      byMonth[month].count++
      byMonth[month].types[inv.invoice_type] = (byMonth[month].types[inv.invoice_type] || 0) + 1
    }

    console.log('\nInvoices by month:')
    for (const month of Object.keys(byMonth).sort()) {
      const data = byMonth[month]
      const types = Object.entries(data.types).map(([t, c]) => t + ':' + c).join(', ')
      console.log('  ' + month + ': ' + data.count + ' invoices (' + types + ')')
    }
  }

  // ============================================================
  // CHECK 2: Transaction date range (via query)
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('CHECK 2: TRANSACTION DATE RANGE (POST /transactions:query)')
  console.log('█'.repeat(100))

  // Try a longer date range
  const txStart = new Date()
  txStart.setFullYear(txStart.getFullYear() - 2) // 2 years back

  console.log('\nRequested range: ' + txStart.toISOString().split('T')[0] + ' to ' + endDate.toISOString().split('T')[0])

  const txData = await fetchJson(API_BASE + '/transactions:query', {
    method: 'POST',
    body: JSON.stringify({
      start_date: txStart.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      page_size: 1000
    })
  })

  const txItems = txData.items || []
  console.log('\nFirst page transactions: ' + txItems.length)

  if (txItems.length > 0) {
    const txDates = txItems.map(t => t.charge_date).sort()
    console.log('Earliest charge_date: ' + txDates[0])
    console.log('Latest charge_date: ' + txDates[txDates.length - 1])

    // Check invoiced_status
    const invoiced = txItems.filter(t => t.invoiced_status).length
    const pending = txItems.filter(t => !t.invoiced_status).length
    console.log('\nInvoiced: ' + invoiced + ', Pending: ' + pending)
  }

  // ============================================================
  // CHECK 3: Count ALL transactions with full pagination
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('CHECK 3: FULL TRANSACTION COUNT (ALL PAGES)')
  console.log('█'.repeat(100))

  let allTxs = []
  cursor = null
  page = 0

  do {
    const body = {
      start_date: startDate.toISOString().split('T')[0], // Just 1 year
      end_date: endDate.toISOString().split('T')[0],
      page_size: 1000
    }
    if (cursor) body.cursor = cursor

    const data = await fetchJson(API_BASE + '/transactions:query', {
      method: 'POST',
      body: JSON.stringify(body)
    })

    const items = data.items || []
    allTxs.push(...items)
    cursor = data.next
    page++

    console.log('Page ' + page + ': ' + items.length + ' (total: ' + allTxs.length + ')')

    if (page >= 100) {
      console.log('(Stopped at 100 pages)')
      break
    }
  } while (cursor)

  console.log('\nTotal transactions (1 year): ' + allTxs.length)

  // Date range of transactions
  if (allTxs.length > 0) {
    const txDates = allTxs.map(t => t.charge_date).sort()
    console.log('Earliest charge_date: ' + txDates[0])
    console.log('Latest charge_date: ' + txDates[txDates.length - 1])

    // Group by month
    const byMonth = {}
    for (const tx of allTxs) {
      const month = tx.charge_date.substring(0, 7)
      byMonth[month] = (byMonth[month] || 0) + 1
    }

    console.log('\nTransactions by month:')
    for (const month of Object.keys(byMonth).sort()) {
      console.log('  ' + month + ': ' + byMonth[month])
    }

    // Group by fee type
    const byFee = {}
    for (const tx of allTxs) {
      byFee[tx.transaction_fee] = (byFee[tx.transaction_fee] || 0) + 1
    }

    console.log('\nTop 10 fee types:')
    const topFees = Object.entries(byFee).sort((a, b) => b[1] - a[1]).slice(0, 10)
    for (const [fee, count] of topFees) {
      console.log('  ' + fee + ': ' + count)
    }
  }

  // ============================================================
  // CHECK 4: Does token scope affect results?
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('CHECK 4: TOKEN SCOPE')
  console.log('█'.repeat(100))

  // Get channel info to understand token scope
  const channelsData = await fetchJson(API_BASE + '/channel')
  const channels = channelsData.items || channelsData || []

  console.log('\nChannels visible with this token: ' + channels.length)
  for (const ch of channels.slice(0, 10)) {
    console.log('  - ' + ch.name + ' (ID: ' + ch.id + ')')
  }

  // Try to get user info
  const usersData = await fetchJson(API_BASE + '/users')
  console.log('\nUsers endpoint response:')
  console.log(JSON.stringify(usersData, null, 2).slice(0, 500))
}

main().catch(console.error)
