#!/usr/bin/env npx tsx
/**
 * Manually sync transactions for a specific invoice ID
 * This handles cases where sync-transactions missed transactions
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function main() {
  const invoiceId = process.argv[2] || '8693047'

  console.log(`\nSyncing transactions from ShipBob invoice ${invoiceId}...`)
  console.log('='.repeat(60))

  const parentToken = process.env.SHIPBOB_API_TOKEN
  if (!parentToken) {
    console.error('SHIPBOB_API_TOKEN not set')
    process.exit(1)
  }

  // Fetch transactions from ShipBob for this invoice
  let allTx: any[] = []
  let cursor: string | null = null

  do {
    let url = `${SHIPBOB_API_BASE}/invoices/${invoiceId}/transactions?PageSize=1000`
    if (cursor) url += `&Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${parentToken}`,
        'Content-Type': 'application/json',
      },
    })

    if (!response.ok) {
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    allTx.push(...(data.items || []))
    cursor = data.next
  } while (cursor)

  console.log(`Found ${allTx.length} transactions in ShipBob invoice ${invoiceId}`)

  if (allTx.length === 0) {
    console.log('No transactions to sync')
    return
  }

  // Show what we found
  console.log('\nTransactions from ShipBob:')
  for (const tx of allTx) {
    console.log(`  ${tx.reference_type} ${tx.reference_id}: ${tx.transaction_fee} $${tx.amount}`)
  }

  // Get client lookups
  console.log('\nBuilding lookups...')

  // WRO lookup
  const { data: wros } = await supabase
    .from('receiving_orders')
    .select('shipbob_receiving_id, client_id, merchant_id')
  const wroLookup: Record<string, { client_id: string; merchant_id: string | null }> = {}
  for (const wro of wros || []) {
    if (wro.shipbob_receiving_id) {
      wroLookup[String(wro.shipbob_receiving_id)] = {
        client_id: wro.client_id,
        merchant_id: wro.merchant_id,
      }
    }
  }

  // Check which transactions are missing
  const txIds = allTx.map(tx => tx.transaction_id)
  const { data: existing } = await supabase
    .from('transactions')
    .select('transaction_id')
    .in('transaction_id', txIds)
  const existingIds = new Set((existing || []).map(t => t.transaction_id))

  const missing = allTx.filter(tx => !existingIds.has(tx.transaction_id))
  console.log(`\n${missing.length} transactions missing from our database`)

  if (missing.length === 0) {
    console.log('All transactions already synced!')
    return
  }

  // Prepare records
  const records = missing.map(tx => {
    // Try to attribute client
    let clientId: string | null = null
    let merchantId: string | null = null

    if (tx.reference_type === 'WRO' && wroLookup[tx.reference_id]) {
      clientId = wroLookup[tx.reference_id].client_id
      merchantId = wroLookup[tx.reference_id].merchant_id
    }

    // Build base record WITHOUT client_id/merchant_id
    // IMPORTANT: Only include these if NOT null to prevent overwriting existing attribution
    const record: Record<string, unknown> = {
      transaction_id: tx.transaction_id,
      reference_id: tx.reference_id,
      reference_type: tx.reference_type,
      fee_type: tx.transaction_fee,
      total_charge: tx.amount,
      transaction_date: tx.charge_date,
      invoice_id_sb: parseInt(invoiceId, 10),
      invoice_date_sb: tx.invoice_date,
      invoiced_status_sb: tx.invoiced_status,
      fulfillment_center: tx.fulfillment_center,
      raw_data: tx,
    }

    // Only include client_id/merchant_id if attribution succeeded
    if (clientId) {
      record.client_id = clientId
      record.merchant_id = merchantId
    }

    return record
  })

  console.log('\nInserting missing transactions:')
  for (const r of records) {
    console.log(`  ${r.reference_type} ${r.reference_id}: ${r.fee_type} $${r.total_charge} -> client ${r.client_id || 'UNATTRIBUTED'}`)
  }

  // Insert
  const { error } = await supabase
    .from('transactions')
    .upsert(records, { onConflict: 'transaction_id' })

  if (error) {
    console.error('Error inserting:', error)
  } else {
    console.log(`\n✅ Successfully inserted ${records.length} transactions`)
  }
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
