#!/usr/bin/env npx tsx
/**
 * Compare ShipBob API transactions vs our database
 * to understand what's missing and why
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function main() {
  const parentToken = process.env.SHIPBOB_API_TOKEN
  if (!parentToken) {
    console.error('SHIPBOB_API_TOKEN not set')
    process.exit(1)
  }

  // Fetch transactions from ShipBob for the Dec 8-15 period
  console.log('=== Fetching from ShipBob API (Dec 8-15) ===')

  const startDate = new Date('2025-12-08T00:00:00Z')
  const endDate = new Date('2025-12-16T00:00:00Z')

  const apiTx: any[] = []
  let cursor: string | null = null
  let page = 0

  do {
    page++
    let url = `${SHIPBOB_API_BASE}/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${parentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_date: startDate.toISOString(),
        to_date: endDate.toISOString(),
        page_size: 1000,
      }),
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    apiTx.push(...(data.items || []))
    cursor = data.next

    console.log(`  Page ${page}: ${apiTx.length} total`)
  } while (cursor)

  console.log(`\nTotal from API: ${apiTx.length}`)

  // Break down by reference_type
  const apiByType: Record<string, { count: number; total: number }> = {}
  for (const tx of apiTx) {
    const type = tx.reference_type || 'Unknown'
    if (!apiByType[type]) apiByType[type] = { count: 0, total: 0 }
    apiByType[type].count++
    apiByType[type].total += tx.amount || 0
  }

  console.log('\nAPI breakdown by reference_type:')
  for (const [type, stats] of Object.entries(apiByType).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${type}: ${stats.count} tx, $${stats.total.toFixed(2)}`)
  }

  // Compare to our DB
  console.log('\n=== Comparing to Database ===')

  const apiIds = apiTx.map(tx => tx.transaction_id)

  // Check how many are in our DB
  const { data: dbTx, count: dbCount } = await supabase
    .from('transactions')
    .select('transaction_id', { count: 'exact' })
    .in('transaction_id', apiIds.slice(0, 1000)) // Supabase limit

  const dbIds = new Set((dbTx || []).map(t => t.transaction_id))
  const missingFromDb = apiTx.filter(tx => !dbIds.has(tx.transaction_id))

  console.log(`API has: ${apiTx.length}`)
  console.log(`DB has (sample): ${dbIds.size}`)
  console.log(`Missing from DB (sample): ${missingFromDb.length}`)

  // Check missing by type
  if (missingFromDb.length > 0) {
    const missingByType: Record<string, number> = {}
    for (const tx of missingFromDb) {
      missingByType[tx.reference_type] = (missingByType[tx.reference_type] || 0) + 1
    }
    console.log('\nMissing by reference_type:')
    for (const [type, count] of Object.entries(missingByType).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${type}: ${count}`)
    }

    // Show sample of missing
    console.log('\nSample of missing transactions:')
    for (const tx of missingFromDb.slice(0, 5)) {
      console.log(`  ${tx.transaction_id}: ${tx.reference_type} ${tx.reference_id} | ${tx.transaction_fee} $${tx.amount} | charge: ${tx.charge_date?.split('T')[0]} | invoice: ${tx.invoice_id}`)
    }
  }

  // Check if transactions exist but have wrong/missing invoice_id_sb
  console.log('\n=== Checking invoice_id_sb discrepancies ===')
  const txWithInvoice = apiTx.filter(tx => tx.invoice_id)
  console.log(`API transactions with invoice_id: ${txWithInvoice.length}`)

  const sampleIds = txWithInvoice.slice(0, 500).map(tx => tx.transaction_id)
  const { data: dbWithInvoice } = await supabase
    .from('transactions')
    .select('transaction_id, invoice_id_sb')
    .in('transaction_id', sampleIds)

  let mismatchCount = 0
  let nullInvoiceCount = 0
  const dbLookup: Record<string, number | null> = {}
  for (const tx of dbWithInvoice || []) {
    dbLookup[tx.transaction_id] = tx.invoice_id_sb
  }

  for (const tx of txWithInvoice.slice(0, 500)) {
    const dbInvoiceId = dbLookup[tx.transaction_id]
    if (dbInvoiceId === undefined) continue // not in DB
    if (dbInvoiceId === null) {
      nullInvoiceCount++
    } else if (dbInvoiceId !== tx.invoice_id) {
      mismatchCount++
    }
  }

  console.log(`  Transactions in DB with NULL invoice_id_sb: ${nullInvoiceCount}`)
  console.log(`  Transactions with mismatched invoice_id_sb: ${mismatchCount}`)
}

main().catch(console.error)
