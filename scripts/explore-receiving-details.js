#!/usr/bin/env node
/**
 * Deep dive into Receiving API and per-client WRO transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const parentToken = process.env.SHIPBOB_API_TOKEN
const API_BASE = 'https://api.shipbob.com/2025-07'

async function fetchWithToken(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  })
  return { response, data: response.ok ? await response.json() : null }
}

async function main() {
  console.log('='.repeat(100))
  console.log('RECEIVING API & PER-CLIENT WRO EXPLORATION')
  console.log('='.repeat(100))

  // ============================================================
  // PART 1: Explore /receiving endpoint with parameters
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 1: /receiving ENDPOINT EXPLORATION')
  console.log('█'.repeat(100))

  const params = [
    '',  // no params
    '?Limit=10',
    '?PageSize=10',
    '?page_size=10',
    '?status=all',
  ]

  for (const param of params) {
    console.log(`\n${API_BASE}/receiving${param}`)
    const { response, data } = await fetchWithToken(`${API_BASE}/receiving${param}`, parentToken)
    console.log(`  Status: ${response.status}`)
    if (data) {
      const str = JSON.stringify(data)
      console.log(`  Response (${str.length} chars): ${str.slice(0, 300)}...`)
      if (Array.isArray(data)) {
        console.log(`  Items: ${data.length}`)
        if (data.length > 0) {
          console.log(`  First item keys: ${Object.keys(data[0]).join(', ')}`)
          console.log(`  First item: ${JSON.stringify(data[0])}`)
        }
      } else if (data.items) {
        console.log(`  Items: ${data.items.length}`)
      }
    }
  }

  // ============================================================
  // PART 2: Get clients and their tokens
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 2: PER-CLIENT WRO TRANSACTIONS')
  console.log('█'.repeat(100))

  // Get all clients with tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, shipbob_user_id, api_token')
    .not('api_token', 'is', null)

  console.log(`\nFound ${clients?.length || 0} clients with API tokens`)

  // For each client, query for WRO transactions
  for (const client of (clients || [])) {
    console.log(`\n--- ${client.company_name} (ID: ${client.id}) ---`)
    console.log(`  ShipBob User ID: ${client.shipbob_user_id}`)

    // Query transactions with client token
    const body = {
      start_date: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      end_date: new Date().toISOString().split('T')[0],
      page_size: 1000
    }

    const { response, data } = await fetchWithToken(`${API_BASE}/transactions:query`, client.api_token, {
      method: 'POST',
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      console.log(`  Error: ${response.status} ${response.statusText}`)
      continue
    }

    const txs = data.items || []
    console.log(`  Total transactions: ${txs.length}`)

    // Filter for WRO/Receiving
    const wroTxs = txs.filter(t => t.transaction_fee === 'WRO Receiving Fee')
    console.log(`  WRO Receiving Fee transactions: ${wroTxs.length}`)

    if (wroTxs.length > 0) {
      console.log(`\n  Sample WRO transaction:`)
      console.log(`  ${JSON.stringify(wroTxs[0], null, 4)}`)

      // Unique WRO IDs for this client
      const wroIds = [...new Set(wroTxs.map(t => t.reference_id))]
      console.log(`\n  Unique WRO IDs: ${wroIds.join(', ')}`)
    }

    // Also check for Returns
    const returnTxs = txs.filter(t => 
      t.transaction_fee.toLowerCase().includes('return') ||
      t.reference_type === 'Return'
    )
    console.log(`  Return transactions: ${returnTxs.length}`)

    if (returnTxs.length > 0) {
      console.log(`  Sample Return:`)
      console.log(`  ${JSON.stringify(returnTxs[0], null, 4)}`)
    }

    // Check for Storage
    const storageTxs = txs.filter(t => t.transaction_fee === 'Warehousing Fee')
    console.log(`  Storage transactions: ${storageTxs.length}`)

    if (storageTxs.length > 0) {
      console.log(`  Sample Storage:`)
      console.log(`  ${JSON.stringify(storageTxs[0], null, 4)}`)
    }

    // Fee type breakdown
    const feeTypes = {}
    for (const tx of txs) {
      feeTypes[tx.transaction_fee] = (feeTypes[tx.transaction_fee] || 0) + 1
    }
    console.log(`\n  Fee type breakdown:`)
    for (const [fee, count] of Object.entries(feeTypes).sort((a, b) => b[1] - a[1])) {
      console.log(`    ${fee}: ${count}`)
    }
  }

  // ============================================================
  // PART 3: Try Receiving endpoint per-client
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('PART 3: /receiving ENDPOINT PER-CLIENT')
  console.log('█'.repeat(100))

  for (const client of (clients || []).slice(0, 2)) {
    console.log(`\n--- ${client.company_name} ---`)
    
    const { response, data } = await fetchWithToken(`${API_BASE}/receiving?Limit=10`, client.api_token)
    console.log(`  Status: ${response.status}`)
    
    if (data) {
      const arr = Array.isArray(data) ? data : data.items || []
      console.log(`  Items: ${arr.length}`)
      
      if (arr.length > 0) {
        console.log(`  First item:`)
        console.log(JSON.stringify(arr[0], null, 4))
      }
    }
  }

  // ============================================================
  // SUMMARY
  // ============================================================
  console.log('\n' + '█'.repeat(100))
  console.log('COMPLETE REFERENCE LINKAGE STRATEGY')
  console.log('█'.repeat(100))

  console.log(`
╔══════════════════════════════════════════════════════════════════════════════════════════════════╗
║ TRANSACTION TYPE TO CLIENT LINKAGE                                                                ║
╠══════════════════════════════════════════════════════════════════════════════════════════════════╣
║ Fee Type             │ reference_type │ reference_id       │ Linkage Strategy                    ║
╠══════════════════════╪════════════════╪════════════════════╪═════════════════════════════════════╣
║ Shipping/Pick        │ Shipment       │ Shipment ID        │ JOIN shipments.shipment_id          ║
║ Per Pick Fee         │ Shipment       │ Shipment ID        │ JOIN shipments.shipment_id          ║
║ Credit               │ Default        │ Shipment ID        │ JOIN shipments.shipment_id          ║
║ WRO Receiving Fee    │ WRO            │ WRO ID             │ Sync per-client → client_id known   ║
║ Warehousing Fee      │ FC             │ FC-InvID-LocType   │ Sync per-client → client_id known   ║
║ Return Processing    │ Return         │ Return ID          │ Parse Order from Comment → orders   ║
╚══════════════════════════════════════════════════════════════════════════════════════════════════╝

KEY INSIGHT:
- By syncing transactions PER-CLIENT (with child tokens), we automatically know which client
  each transaction belongs to - no need to look up WRO or Inventory IDs!
- The client_id is implicit in the sync process itself
`)
}

main().catch(console.error)
