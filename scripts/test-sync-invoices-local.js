#!/usr/bin/env node
/**
 * Test the sync-invoices transaction linking logic locally
 */

require('dotenv').config({ path: '.env.local' })

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

// ShipBob API helper
async function getTransactionsByInvoice(invoiceId) {
  const allTransactions = []
  const seenIds = new Set()
  let cursor

  do {
    const params = new URLSearchParams({ PageSize: '1000' })
    if (cursor) params.set('Cursor', cursor)

    const url = `${BASE_URL}/2025-07/invoices/${invoiceId}/transactions?${params.toString()}`

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${SHIPBOB_API_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`API error ${response.status}: ${text}`)
    }

    const data = await response.json()
    const items = Array.isArray(data) ? data : (data.items || [])

    let newCount = 0
    for (const tx of items) {
      if (!seenIds.has(tx.transaction_id)) {
        seenIds.add(tx.transaction_id)
        allTransactions.push(tx)
        newCount++
      }
    }

    if (newCount === 0) break
    cursor = Array.isArray(data) ? undefined : data.next
  } while (cursor)

  return allTransactions
}

async function main() {
  console.log('Testing sync-invoices transaction linking...\n')

  // Get unprocessed invoices
  const { data: unprocessedInvoices, error: invoicesError } = await supabase
    .from('invoices_sb')
    .select('id, shipbob_invoice_id, invoice_type, base_amount, invoice_date')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')
    .order('invoice_date', { ascending: true })

  if (invoicesError) {
    console.error('Error fetching invoices:', invoicesError)
    return
  }

  console.log(`Found ${unprocessedInvoices.length} unprocessed invoices`)

  // Group by invoice date for summary
  const byDate = {}
  for (const inv of unprocessedInvoices) {
    if (!byDate[inv.invoice_date]) byDate[inv.invoice_date] = []
    byDate[inv.invoice_date].push(inv)
  }

  console.log('\nInvoices by date:')
  for (const [date, invs] of Object.entries(byDate)) {
    console.log(`  ${date}: ${invs.map(i => `${i.invoice_type}(${i.shipbob_invoice_id})`).join(', ')}`)
  }

  // Test linking for Dec 8 invoices only
  const dec8Invoices = unprocessedInvoices.filter(inv => inv.invoice_date === '2025-12-08')
  console.log(`\nTesting ${dec8Invoices.length} Dec 8 invoices...`)

  const stats = { linked: 0, notFound: 0, errors: 0 }

  for (const invoice of dec8Invoices) {
    console.log(`\nProcessing invoice ${invoice.shipbob_invoice_id} (${invoice.invoice_type})...`)

    try {
      const invoiceId = parseInt(invoice.shipbob_invoice_id, 10)
      const transactions = await getTransactionsByInvoice(invoiceId)

      console.log(`  Fetched ${transactions.length} transactions from API`)

      if (transactions.length === 0) {
        continue
      }

      // Get transaction IDs
      const transactionIds = transactions.map(tx => tx.transaction_id)

      // Check how many exist in our DB
      const { count } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .in('transaction_id', transactionIds.slice(0, 1000)) // Limit for query

      console.log(`  Found ${count} of ${transactionIds.length} in our DB`)

      // Update transactions in DB - batch to avoid .in() limits
      const BATCH_SIZE = 500
      let totalLinked = 0
      let batchErrors = 0

      for (let i = 0; i < transactionIds.length; i += BATCH_SIZE) {
        const batch = transactionIds.slice(i, i + BATCH_SIZE)

        const { data: updated, error: updateError } = await supabase
          .from('transactions')
          .update({
            invoice_id_sb: invoiceId,
            invoice_date_sb: invoice.invoice_date,
            invoiced_status_sb: true
          })
          .in('transaction_id', batch)
          .select('id')

        if (updateError) {
          console.error(`  Error updating batch ${Math.floor(i / BATCH_SIZE) + 1}:`, updateError)
          batchErrors++
        } else {
          totalLinked += updated?.length || 0
        }
      }

      const notFoundCount = transactionIds.length - totalLinked
      stats.linked += totalLinked
      stats.notFound += notFoundCount
      if (batchErrors > 0) stats.errors += batchErrors
      console.log(`  ✓ Linked ${totalLinked}, not found ${notFoundCount}${batchErrors > 0 ? `, ${batchErrors} batch errors` : ''}`)
    } catch (err) {
      console.error(`  Error: ${err.message}`)
      stats.errors++
    }
  }

  console.log('\n========================================')
  console.log('SUMMARY')
  console.log('========================================')
  console.log(`Linked: ${stats.linked}`)
  console.log(`Not found in DB: ${stats.notFound}`)
  console.log(`Errors: ${stats.errors}`)
}

main().catch(console.error)
