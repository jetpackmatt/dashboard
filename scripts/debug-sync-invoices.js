#!/usr/bin/env node
/**
 * Debug why transactions aren't getting linked by sync-invoices
 *
 * Check: Is the transaction in ShipBob's /invoices/{id}/transactions API?
 * If yes → sync-invoices should have linked it (bug in sync code)
 * If no → ShipBob's API isn't returning it (API issue)
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fetchAllInvoiceTransactions(invoiceId) {
  const token = process.env.SHIPBOB_API_TOKEN
  const allTx = []
  let cursor = null

  do {
    let url = `https://api.shipbob.com/2025-07/invoices/${invoiceId}/transactions?PageSize=1000`
    if (cursor) url += `&Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    })

    if (response.status !== 200) {
      console.log('API error:', response.status)
      break
    }

    const data = await response.json()
    const items = data.items || []
    allTx.push(...items)
    cursor = data.next || null
  } while (cursor)

  return allTx
}

async function main() {
  console.log('=== DEBUGGING SYNC-INVOICES ISSUE ===\n')

  // Get our unlinked shipping transactions (the 220 we just "fixed")
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  // The 220 shipping transactions we linked - let's see if they're actually in the API
  // Get transactions with invoice_id_sb = 8730385 that were just updated
  const { data: recentlyLinked } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, updated_at')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', 8730385)
    .gte('updated_at', '2025-12-22T20:00:00Z')  // Today's manual fixes
    .limit(300)

  console.log('Recently linked shipping tx (today):', recentlyLinked?.length)

  // Fetch ALL transactions from invoice 8730385 via API
  console.log('\nFetching ALL transactions from ShipBob API for invoice 8730385...')
  const apiTx = await fetchAllInvoiceTransactions(8730385)
  console.log('API returned:', apiTx.length, 'transactions')

  // Build sets for comparison
  const apiTxIds = new Set(apiTx.map(t => t.transaction_id))
  const apiRefIds = new Set(apiTx.map(t => t.reference_id))

  // Check if our recently linked transactions are in the API
  const recentlyLinkedTxIds = (recentlyLinked || []).map(t => t.transaction_id)
  const recentlyLinkedRefIds = (recentlyLinked || []).map(t => t.reference_id)

  let inApiByTxId = 0
  let inApiByRefId = 0

  for (const txId of recentlyLinkedTxIds) {
    if (apiTxIds.has(txId)) inApiByTxId++
  }
  for (const refId of recentlyLinkedRefIds) {
    if (apiRefIds.has(refId)) inApiByRefId++
  }

  console.log('\n=== COMPARISON ===')
  console.log('Our recently linked tx found in API by transaction_id:', inApiByTxId, '/', recentlyLinkedTxIds.length)
  console.log('Our recently linked tx found in API by reference_id:', inApiByRefId, '/', recentlyLinkedRefIds.length)

  if (inApiByTxId === 0 && inApiByRefId === 0) {
    console.log('\n>>> PROBLEM: Our "linked" transactions are NOT in ShipBob API!')
    console.log('>>> They exist in our DB but ShipBob\'s /invoices/{id}/transactions')
    console.log('>>> does NOT return them. This is an API discrepancy.')
  } else if (inApiByTxId > 0) {
    console.log('\n>>> Our transactions ARE in ShipBob API!')
    console.log('>>> sync-invoices should have linked them - there may be a bug in the sync code')
  }

  // Get a sample of what's in the API but NOT in our recently linked
  const apiOnlyTxIds = [...apiTxIds].filter(id => !new Set(recentlyLinkedTxIds).has(id))
  console.log('\nTransaction IDs in API but not in our recently linked:', apiOnlyTxIds.length)

  // Sample the API data
  console.log('\nSample API transactions:')
  for (const tx of apiTx.slice(0, 5)) {
    console.log('  tx:', tx.transaction_id.substring(0, 12), 'ref:', tx.reference_id, 'fee:', tx.transaction_fee)
  }
}

main().catch(console.error)
