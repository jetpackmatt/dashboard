#!/usr/bin/env node
/**
 * Analyze all 6 invoice types from a weekly billing cycle
 * Compare API transaction totals against known invoice amounts
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Known invoice totals from last week (Dec 1 / Nov 30)
const KNOWN_INVOICES = {
  8633641: { type: 'Credits', amount: -686.12 },
  8633637: { type: 'ReturnsFee', amount: 14.79 },
  8633634: { type: 'AdditionalFee', amount: 896.17 },
  8633632: { type: 'WarehouseInboundFee', amount: 35.00 },
  8633618: { type: 'WarehouseStorage', amount: 2564.28 },
  8633612: { type: 'Shipping', amount: 11127.61 },
}

async function fetchWithAuth(endpoint) {
  const url = `${BASE_URL}${endpoint}`
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`${response.status}: ${text}`)
  }

  return response.json()
}

async function getAllInvoiceTransactions(invoiceId) {
  const allTransactions = []
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    let endpoint = `/2025-07/invoices/${invoiceId}/transactions?Limit=250`
    if (cursor) {
      endpoint += `&Cursor=${encodeURIComponent(cursor)}`
    }

    const data = await fetchWithAuth(endpoint)
    const items = data.items || []
    allTransactions.push(...items)

    cursor = data.next || null

    // Safety limit
    if (pageNum > 50) {
      console.log(`  ⚠️ Stopping at page 50 (safety limit)`)
      break
    }
  } while (cursor)

  return { transactions: allTransactions, pages: pageNum }
}

async function analyzeInvoice(invoiceId, knownData) {
  console.log(`\n${'─'.repeat(60)}`)
  console.log(`Invoice #${invoiceId} - ${knownData.type}`)
  console.log(`${'─'.repeat(60)}`)
  console.log(`Known amount: $${knownData.amount.toFixed(2)}`)

  const { transactions, pages } = await getAllInvoiceTransactions(invoiceId)

  console.log(`Pages fetched: ${pages}`)
  console.log(`Transactions: ${transactions.length}`)

  // Calculate total
  const apiTotal = transactions.reduce((sum, tx) => sum + (tx.amount || 0), 0)
  console.log(`API total: $${apiTotal.toFixed(2)}`)

  // Calculate gap
  const gap = knownData.amount - apiTotal
  const gapPct = (gap / knownData.amount * 100)
  console.log(`Gap: $${gap.toFixed(2)} (${gapPct.toFixed(1)}%)`)

  // Fee type breakdown
  const byFeeType = {}
  for (const tx of transactions) {
    const feeType = tx.transaction_fee || 'unknown'
    if (!byFeeType[feeType]) {
      byFeeType[feeType] = { count: 0, amount: 0 }
    }
    byFeeType[feeType].count++
    byFeeType[feeType].amount += tx.amount || 0
  }

  console.log(`\nFee types:`)
  for (const [type, data] of Object.entries(byFeeType).sort((a, b) => b[1].amount - a[1].amount)) {
    console.log(`  ${type}: ${data.count} txns, $${data.amount.toFixed(2)}`)
  }

  // Reference type breakdown
  const byRefType = {}
  for (const tx of transactions) {
    const refType = tx.reference_type || 'unknown'
    if (!byRefType[refType]) {
      byRefType[refType] = { count: 0, amount: 0 }
    }
    byRefType[refType].count++
    byRefType[refType].amount += tx.amount || 0
  }

  console.log(`\nReference types:`)
  for (const [type, data] of Object.entries(byRefType).sort((a, b) => b[1].amount - a[1].amount)) {
    console.log(`  ${type}: ${data.count} txns, $${data.amount.toFixed(2)}`)
  }

  // Check client match for shipment-based transactions
  const shipmentRefs = transactions
    .filter(tx => tx.reference_type === 'Shipment' || tx.reference_type === 'Default')
    .map(tx => tx.reference_id)

  if (shipmentRefs.length > 0) {
    const uniqueRefs = [...new Set(shipmentRefs)]
    const { data: matchedShipments } = await supabase
      .from('shipments')
      .select('shipment_id')
      .in('shipment_id', uniqueRefs.slice(0, 500).map(id => parseInt(id)))

    const matchedSet = new Set(matchedShipments?.map(s => s.shipment_id.toString()) || [])
    const matchedCount = uniqueRefs.filter(id => matchedSet.has(id)).length

    console.log(`\nClient attribution (shipment refs):`)
    console.log(`  Unique shipment refs: ${uniqueRefs.length}`)
    console.log(`  Matched in our DB: ${matchedCount} (${(matchedCount / uniqueRefs.length * 100).toFixed(1)}%)`)
  }

  return {
    invoiceId,
    type: knownData.type,
    knownAmount: knownData.amount,
    apiTotal,
    gap,
    gapPct,
    transactionCount: transactions.length,
    transactions
  }
}

async function main() {
  console.log('═'.repeat(60))
  console.log('WEEKLY INVOICE ANALYSIS - Dec 1 / Nov 30 Billing Cycle')
  console.log('═'.repeat(60))

  // First, let's verify these invoices exist in the API
  console.log('\nFetching invoices from API...')
  const invoicesData = await fetchWithAuth('/2025-07/invoices?StartDate=2025-11-25&EndDate=2025-12-02&Limit=50')
  const apiInvoices = invoicesData.items || []

  console.log(`\nAPI returned ${apiInvoices.length} invoices in date range:`)
  for (const inv of apiInvoices) {
    const known = KNOWN_INVOICES[inv.invoice_id]
    const match = known ? '✓' : ' '
    console.log(`  ${match} #${inv.invoice_id}: ${inv.invoice_type} - $${inv.amount} (${inv.invoice_date})`)
  }

  // Analyze each known invoice
  const results = []
  for (const [invoiceId, knownData] of Object.entries(KNOWN_INVOICES)) {
    try {
      const result = await analyzeInvoice(parseInt(invoiceId), knownData)
      results.push(result)
    } catch (err) {
      console.error(`\nError analyzing invoice #${invoiceId}: ${err.message}`)
      results.push({
        invoiceId: parseInt(invoiceId),
        type: knownData.type,
        knownAmount: knownData.amount,
        apiTotal: 0,
        gap: knownData.amount,
        gapPct: 100,
        transactionCount: 0,
        error: err.message
      })
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`)
  console.log('SUMMARY')
  console.log(`${'═'.repeat(60)}`)

  let totalKnown = 0
  let totalApi = 0

  console.log(`\nInvoice Type             Known        API          Gap          Gap %    Txns`)
  console.log('-'.repeat(80))

  for (const r of results) {
    totalKnown += r.knownAmount
    totalApi += r.apiTotal

    const status = Math.abs(r.gapPct) < 1 ? '✅' : Math.abs(r.gapPct) < 10 ? '⚠️' : '❌'
    const type = r.type.padEnd(20)
    const known = ('$' + r.knownAmount.toFixed(2)).padStart(10)
    const api = ('$' + r.apiTotal.toFixed(2)).padStart(10)
    const gap = ('$' + r.gap.toFixed(2)).padStart(10)
    const gapPct = (r.gapPct.toFixed(1) + '%').padStart(8)
    const txns = r.transactionCount.toString().padStart(6)
    console.log(`${status} ${type} ${known} ${api} ${gap} ${gapPct} ${txns}`)
  }

  console.log('-'.repeat(80))
  const totalGap = totalKnown - totalApi
  const totalGapPct = (totalGap / totalKnown * 100)
  const type = 'TOTAL'.padEnd(20)
  const known = ('$' + totalKnown.toFixed(2)).padStart(10)
  const api = ('$' + totalApi.toFixed(2)).padStart(10)
  const gap = ('$' + totalGap.toFixed(2)).padStart(10)
  const gapPct = (totalGapPct.toFixed(1) + '%').padStart(8)
  console.log(`   ${type} ${known} ${api} ${gap} ${gapPct}`)

  console.log(`\n${'═'.repeat(60)}`)
  console.log('ANALYSIS')
  console.log(`${'═'.repeat(60)}`)

  if (totalGapPct > 40) {
    console.log(`\n⚠️ We're only getting ${(100 - totalGapPct).toFixed(1)}% of the invoice amounts.`)
    console.log(`\nPossible explanations:`)
    console.log(`  1. API is filtering to only show merchants we have "access" to`)
    console.log(`  2. The parent token has limited visibility into child transactions`)
    console.log(`  3. Some transaction types aren't being returned`)
    console.log(`\nNext steps to investigate:`)
    console.log(`  1. Compare transaction counts to Excel exports`)
    console.log(`  2. Try with a child token (though billing API may not work)`)
    console.log(`  3. Contact ShipBob support about parent token visibility`)
  } else if (totalGapPct < 5) {
    console.log(`\n✅ We're getting ${(100 - totalGapPct).toFixed(1)}% of invoice amounts - looks good!`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
