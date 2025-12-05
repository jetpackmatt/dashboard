#!/usr/bin/env node
/**
 * Sync Pending (Uninvoiced) Transactions
 *
 * Purpose: Hourly sync of all pending transactions
 *
 * CRITICAL API BEHAVIOR:
 * - Billing API requires PARENT token (not child tokens)
 * - POST /transactions:query returns ALL pending transactions for all merchants
 * - Client attribution done via JOIN to shipments table (reference_id = shipment_id)
 *
 * Strategy:
 * 1. Use parent token to fetch all pending transactions
 * 2. Match Shipment transactions to clients via shipments.shipment_id
 * 3. Upsert with client_id when match found, null when no match
 *
 * Usage:
 *   node scripts/sync-pending-transactions.js           # Sync all pending
 *   node scripts/sync-pending-transactions.js --dry-run # Show what would sync
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const API_BASE = 'https://api.shipbob.com/2025-07'
const parentToken = process.env.SHIPBOB_API_TOKEN

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${parentToken}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`API error ${response.status}: ${text}`)
  }

  return response.json()
}

async function main() {
  console.log('='.repeat(80))
  console.log('SYNC PENDING TRANSACTIONS')
  console.log('Timestamp: ' + new Date().toISOString())
  console.log('='.repeat(80))

  // Parse command line args
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')

  if (dryRun) console.log('\n[DRY RUN MODE - No database writes]')

  // ============================================
  // STEP 1: Fetch pending transactions
  // ============================================
  // NOTE: ShipBob's pagination cursor is BROKEN for this endpoint (Dec 2025)
  // The cursor returns the same data repeatedly. We fetch max 1000 per call.
  // For most clients, 1000 pending transactions covers the current week.
  console.log('\n--- Step 1: Fetching Pending Transactions ---\n')
  console.log('  (Note: Pagination disabled due to ShipBob API bug - cursor loops)')

  let allTransactions = []

  try {
    // Fetch up to 1000 pending transactions (API max page size)
    const data = await fetchJson(
      `${API_BASE}/transactions:query`,
      { method: 'POST', body: JSON.stringify({ page_size: 1000 }) }
    )

    allTransactions = data.items || []
    console.log(`  Fetched ${allTransactions.length} transactions`)

    if (data.next) {
      console.log('  (API reports more pages but pagination is broken - cursor loops)')
    }
  } catch (err) {
    console.log(`  ERROR: ${err.message}`)
    process.exit(1)
  }

  console.log(`\nTotal pending transactions: ${allTransactions.length}`)

  if (allTransactions.length === 0) {
    console.log('\nNo pending transactions to sync.')
    return
  }

  // Categorize by reference_type
  const byType = {}
  for (const tx of allTransactions) {
    const type = tx.reference_type || 'Unknown'
    byType[type] = (byType[type] || 0) + 1
  }
  console.log('\nBreakdown by reference_type:')
  for (const [type, count] of Object.entries(byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${type}: ${count}`)
  }

  // ============================================
  // STEP 2: Build shipment_id → client_id lookup
  // ============================================
  console.log('\n--- Step 2: Building Client Lookup ---\n')

  // Get unique shipment IDs from transactions
  const shipmentIds = [...new Set(
    allTransactions
      .filter(tx => tx.reference_type === 'Shipment' || tx.reference_type === 'Default')
      .map(tx => tx.reference_id)
  )]

  console.log(`Looking up ${shipmentIds.length} unique shipment IDs`)

  // Fetch client_id for each shipment (in batches)
  const shipmentClientMap = {}
  const BATCH_SIZE = 500

  for (let i = 0; i < shipmentIds.length; i += BATCH_SIZE) {
    const batch = shipmentIds.slice(i, i + BATCH_SIZE)

    const { data: shipments, error } = await supabase
      .from('shipments')
      .select('shipment_id, client_id')
      .in('shipment_id', batch)

    if (error) {
      console.log(`  Lookup error: ${error.message}`)
    } else {
      for (const s of (shipments || [])) {
        shipmentClientMap[s.shipment_id] = s.client_id
      }
    }
  }

  console.log(`Found client mappings for ${Object.keys(shipmentClientMap).length} shipments`)

  // Track attribution stats
  const stats = {
    withClient: 0,
    noMatch: 0,
    nonShipment: 0
  }

  // ============================================
  // STEP 3: Prepare and upsert transactions
  // ============================================
  console.log('\n--- Step 3: Upserting Transactions ---\n')

  if (dryRun) {
    // Just show stats
    for (const tx of allTransactions) {
      if (tx.reference_type === 'Shipment' || tx.reference_type === 'Default') {
        if (shipmentClientMap[tx.reference_id]) {
          stats.withClient++
        } else {
          stats.noMatch++
        }
      } else {
        stats.nonShipment++
      }
    }

    console.log(`[DRY RUN] Would upsert ${allTransactions.length} transactions:`)
    console.log(`  With client_id: ${stats.withClient}`)
    console.log(`  No match (Shipment not in DB): ${stats.noMatch}`)
    console.log(`  Non-shipment types (no client): ${stats.nonShipment}`)
    return
  }

  // Build transaction records - ONLY for OUR clients (skip other merchants)
  const txRecords = []
  for (const tx of allTransactions) {
    // Only process Shipment/Default types that we can attribute
    if (tx.reference_type === 'Shipment' || tx.reference_type === 'Default') {
      const clientId = shipmentClientMap[tx.reference_id]
      if (clientId) {
        stats.withClient++
        txRecords.push({
          transaction_id: tx.transaction_id,
          client_id: clientId,
          reference_id: tx.reference_id,
          reference_type: tx.reference_type,
          transaction_fee: tx.transaction_fee,
          amount: tx.amount,
          charge_date: tx.charge_date,
          invoiced_status: tx.invoiced_status || false,
          invoice_id: tx.invoice_id || null,
          fulfillment_center: tx.fulfillment_center || null,
          additional_details: tx.additional_details || null,
          created_at: new Date().toISOString()
        })
      } else {
        // Shipment not in our DB = belongs to another merchant, skip
        stats.noMatch++
      }
    } else {
      // WRO, FC, Return types - skip (can't attribute without more work)
      stats.nonShipment++
    }
  }

  console.log(`\nFiltered to ${txRecords.length} transactions for OUR clients`)
  console.log(`  (Skipped ${stats.noMatch + stats.nonShipment} belonging to other merchants)`)

  // Upsert in batches
  let upserted = 0
  let errors = 0

  for (let i = 0; i < txRecords.length; i += BATCH_SIZE) {
    const batch = txRecords.slice(i, i + BATCH_SIZE)

    const { error } = await supabase
      .from('transactions')
      .upsert(batch, { onConflict: 'transaction_id' })

    if (error) {
      console.log(`  Batch ${Math.floor(i/BATCH_SIZE)+1} error: ${error.message}`)
      errors++
    } else {
      upserted += batch.length
      console.log(`  Batch ${Math.floor(i/BATCH_SIZE)+1}: ${batch.length} upserted`)
    }
  }

  // ============================================
  // SUMMARY
  // ============================================
  console.log('\n' + '='.repeat(80))
  console.log('SYNC COMPLETE')
  console.log('='.repeat(80))
  console.log(`\nTotal transactions upserted: ${upserted}`)
  console.log(`  With client_id: ${stats.withClient}`)
  console.log(`  No shipment match: ${stats.noMatch}`)
  console.log(`  Non-shipment types: ${stats.nonShipment}`)
  if (errors > 0) console.log(`\nBatch errors: ${errors}`)

  // Warn about unattributed transactions
  const unattributed = stats.noMatch + stats.nonShipment
  if (unattributed > 0) {
    console.log(`\n⚠️  ${unattributed} transactions have NULL client_id`)
    console.log('   - "No match" = Shipment not yet synced to shipments table')
    console.log('   - "Non-shipment" = WRO/Storage/Return types need separate attribution')
  }
}

main().catch(console.error)
