#!/usr/bin/env node
/**
 * Deep search for Storage and Returns transactions
 *
 * They MUST exist - let's find them!
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

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
  console.log('DEEP SEARCH: STORAGE AND RETURNS TRANSACTIONS')
  console.log('='.repeat(100))

  // ============================================================
  // APPROACH 1: Check invoices by type
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('APPROACH 1: FIND INVOICES BY TYPE')
  console.log('█'.repeat(100))

  // Go back 365 days to find storage/returns invoices
  const endDate = new Date()
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - 365)

  console.log('\nSearching invoices from ' + startDate.toISOString().split('T')[0] + ' to ' + endDate.toISOString().split('T')[0])

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

    console.log('  Page ' + page + ': ' + items.length + ' invoices (total: ' + allInvoices.length + ')')

    if (page >= 20) break
  } while (cursor)

  // Group by type
  const byType = {}
  for (const inv of allInvoices) {
    if (!byType[inv.invoice_type]) {
      byType[inv.invoice_type] = []
    }
    byType[inv.invoice_type].push(inv)
  }

  console.log('\nInvoices by type:')
  for (const [type, list] of Object.entries(byType)) {
    const total = list.reduce((s, i) => s + i.amount, 0)
    console.log('  ' + type + ': ' + list.length + ' invoices, $' + total.toFixed(2))
  }

  // ============================================================
  // APPROACH 2: Get transactions from Storage invoices
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('APPROACH 2: STORAGE INVOICE TRANSACTIONS')
  console.log('█'.repeat(100))

  const storageInvoices = byType['WarehouseStorage'] || []
  console.log('\nFound ' + storageInvoices.length + ' WarehouseStorage invoices')

  if (storageInvoices.length > 0) {
    // Get transactions from the most recent storage invoice
    const recentStorage = storageInvoices[0]
    console.log('\nMost recent Storage Invoice:')
    console.log('  ID: ' + recentStorage.invoice_id)
    console.log('  Date: ' + recentStorage.invoice_date)
    console.log('  Amount: $' + recentStorage.amount)

    console.log('\nFetching transactions for this invoice...')
    let storageTxs = []
    cursor = null
    page = 0

    do {
      let url = API_BASE + '/invoices/' + recentStorage.invoice_id + '/transactions?pageSize=250'
      if (cursor) url += '&cursor=' + encodeURIComponent(cursor)

      const data = await fetchJson(url)
      const items = data.items || []
      storageTxs.push(...items)
      cursor = data.next
      page++

      if (page >= 10) break
    } while (cursor)

    console.log('Fetched ' + storageTxs.length + ' storage transactions')

    if (storageTxs.length > 0) {
      console.log('\n--- SAMPLE STORAGE TRANSACTION ---')
      console.log(JSON.stringify(storageTxs[0], null, 2))

      // Group by fee type
      const feeTypes = {}
      for (const tx of storageTxs) {
        feeTypes[tx.transaction_fee] = (feeTypes[tx.transaction_fee] || 0) + 1
      }
      console.log('\nFee types in storage invoice:')
      for (const [fee, count] of Object.entries(feeTypes)) {
        console.log('  ' + fee + ': ' + count)
      }

      // Show reference_id patterns
      console.log('\n--- STORAGE REFERENCE ID PATTERNS ---')
      const refPatterns = {}
      for (const tx of storageTxs.slice(0, 20)) {
        const parts = tx.reference_id.split('-')
        const pattern = parts.length + ' parts: ' + parts.map((p, i) => i === 0 ? 'FC' : (i === 1 ? 'InvID' : 'LocType')).join('-')
        refPatterns[pattern] = (refPatterns[pattern] || 0) + 1
      }
      for (const [pattern, count] of Object.entries(refPatterns)) {
        console.log('  ' + pattern + ': ' + count)
      }

      console.log('\nSample reference_ids:')
      for (const tx of storageTxs.slice(0, 5)) {
        console.log('  ' + tx.reference_id + ' (' + tx.reference_type + ')')
      }
    }
  }

  // ============================================================
  // APPROACH 3: Get transactions from Returns invoices
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('APPROACH 3: RETURNS INVOICE TRANSACTIONS')
  console.log('█'.repeat(100))

  const returnsInvoices = byType['ReturnsFee'] || []
  console.log('\nFound ' + returnsInvoices.length + ' ReturnsFee invoices')

  if (returnsInvoices.length > 0) {
    const recentReturns = returnsInvoices[0]
    console.log('\nMost recent Returns Invoice:')
    console.log('  ID: ' + recentReturns.invoice_id)
    console.log('  Date: ' + recentReturns.invoice_date)
    console.log('  Amount: $' + recentReturns.amount)

    console.log('\nFetching transactions for this invoice...')
    let returnsTxs = []
    cursor = null
    page = 0

    do {
      let url = API_BASE + '/invoices/' + recentReturns.invoice_id + '/transactions?pageSize=250'
      if (cursor) url += '&cursor=' + encodeURIComponent(cursor)

      const data = await fetchJson(url)
      const items = data.items || []
      returnsTxs.push(...items)
      cursor = data.next
      page++

      if (page >= 10) break
    } while (cursor)

    console.log('Fetched ' + returnsTxs.length + ' returns transactions')

    if (returnsTxs.length > 0) {
      console.log('\n--- SAMPLE RETURNS TRANSACTION ---')
      console.log(JSON.stringify(returnsTxs[0], null, 2))

      // Group by fee type
      const feeTypes = {}
      for (const tx of returnsTxs) {
        feeTypes[tx.transaction_fee] = (feeTypes[tx.transaction_fee] || 0) + 1
      }
      console.log('\nFee types in returns invoice:')
      for (const [fee, count] of Object.entries(feeTypes)) {
        console.log('  ' + fee + ': ' + count)
      }

      // Check reference linkage
      console.log('\n--- RETURNS REFERENCE ANALYSIS ---')
      for (const tx of returnsTxs.slice(0, 5)) {
        console.log('\nTransaction: ' + tx.transaction_id)
        console.log('  reference_id: ' + tx.reference_id)
        console.log('  reference_type: ' + tx.reference_type)
        console.log('  additional_details: ' + JSON.stringify(tx.additional_details))

        // Try to parse Order ID from Comment
        const comment = tx.additional_details?.Comment || ''
        const orderMatch = comment.match(/Order\s+(\d+)/i)
        if (orderMatch) {
          console.log('  Parsed Order ID: ' + orderMatch[1])

          // Check if order exists in our DB
          const { data: order } = await supabase
            .from('orders')
            .select('shipbob_order_id, client_id')
            .eq('shipbob_order_id', orderMatch[1])
            .single()

          if (order) {
            console.log('  ✅ Order found! client_id: ' + order.client_id)
          } else {
            console.log('  ❌ Order not in database')
          }
        }
      }
    }
  }

  // ============================================================
  // APPROACH 4: Query ALL fee types to find storage/return related
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('APPROACH 4: ALL FEE TYPES CONTAINING STORAGE/RETURN/WAREHOUSE')
  console.log('█'.repeat(100))

  const feeTypes = await fetchJson(API_BASE + '/transaction-fees')
  const allFees = Array.isArray(feeTypes) ? feeTypes : feeTypes.items || []

  const storageRelated = allFees.filter(f =>
    f.toLowerCase().includes('storage') ||
    f.toLowerCase().includes('warehouse') ||
    f.toLowerCase().includes('inventory')
  )

  const returnRelated = allFees.filter(f =>
    f.toLowerCase().includes('return')
  )

  console.log('\nStorage-related fee types:')
  for (const fee of storageRelated) {
    console.log('  - ' + fee)
  }

  console.log('\nReturn-related fee types:')
  for (const fee of returnRelated) {
    console.log('  - ' + fee)
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('SUMMARY')
  console.log('█'.repeat(100))

  console.log('\n')
  console.log('Storage Invoices Found: ' + storageInvoices.length)
  console.log('Returns Invoices Found: ' + returnsInvoices.length)
  console.log('\nStorage Fee Types: ' + storageRelated.join(', '))
  console.log('Return Fee Types: ' + returnRelated.join(', '))
}

main().catch(console.error)
