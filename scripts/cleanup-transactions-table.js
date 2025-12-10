/**
 * Transactions Table Cleanup Script
 *
 * This script performs several cleanup and backfill operations:
 * 1. Backfill tracking_id from additional_details.TrackingId
 * 2. Backfill tracking_id from shipments table (for remaining)
 * 3. Backfill invoice_date_sb from invoices_sb table
 * 4. Backfill transaction_type from raw ShipBob API data pattern
 *
 * Usage: node scripts/cleanup-transactions-table.js [--dry-run]
 *
 * Note: Column drops/renames require Supabase SQL Editor (not supported via JS client)
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DRY_RUN = process.argv.includes('--dry-run')

async function backfillTrackingIdFromAdditionalDetails() {
  console.log('\n' + '='.repeat(60))
  console.log('STEP 1: Backfill tracking_id from additional_details.TrackingId')
  console.log('='.repeat(60))

  // Get count first
  const { count } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('reference_type', 'Shipment')
    .is('tracking_id', null)
    .not('additional_details->TrackingId', 'is', null)

  console.log(`Found ${count} transactions with TrackingId in additional_details but no tracking_id`)

  if (count === 0) {
    console.log('Nothing to backfill!')
    return { updated: 0 }
  }

  if (DRY_RUN) {
    console.log('[DRY RUN] Would update these transactions')
    return { updated: 0, wouldUpdate: count }
  }

  // Paginate and update
  const PAGE_SIZE = 1000
  let totalUpdated = 0
  let hasMore = true
  let iterations = 0
  const MAX_ITERATIONS = 200

  while (hasMore && iterations < MAX_ITERATIONS) {
    iterations++

    // Get batch of transactions
    const { data: batch, error } = await supabase
      .from('transactions')
      .select('id, additional_details')
      .eq('reference_type', 'Shipment')
      .is('tracking_id', null)
      .not('additional_details->TrackingId', 'is', null)
      .limit(PAGE_SIZE)

    if (error) {
      console.error('Error fetching batch:', error)
      break
    }

    if (batch.length === 0) {
      hasMore = false
      break
    }

    // Update each record
    for (const tx of batch) {
      const trackingId = tx.additional_details?.TrackingId
      if (trackingId) {
        const { error: updateError } = await supabase
          .from('transactions')
          .update({ tracking_id: trackingId })
          .eq('id', tx.id)

        if (!updateError) {
          totalUpdated++
        }
      }
    }

    console.log(`  Updated ${totalUpdated} so far...`)
    hasMore = batch.length === PAGE_SIZE
  }

  console.log(`\n✅ Updated ${totalUpdated} transactions with tracking_id from additional_details`)
  return { updated: totalUpdated }
}

async function backfillTrackingIdFromShipments() {
  console.log('\n' + '='.repeat(60))
  console.log('STEP 2: Backfill tracking_id from shipments table')
  console.log('='.repeat(60))

  // This requires a JOIN which Supabase JS client doesn't support well for updates
  // We'll do it in batches: fetch shipments with tracking, then update transactions

  // Get shipments with tracking_id (paginate to get all)
  let shipments = []
  let page = 0
  let hasMoreShipments = true
  const SHIP_PAGE_SIZE = 1000

  while (hasMoreShipments) {
    const { data, error: shipError } = await supabase
      .from('shipments')
      .select('shipment_id, tracking_id')
      .not('tracking_id', 'is', null)
      .range(page * SHIP_PAGE_SIZE, (page + 1) * SHIP_PAGE_SIZE - 1)

    if (shipError) {
      console.error('Error fetching shipments:', shipError)
      return { updated: 0 }
    }

    shipments = shipments.concat(data)
    hasMoreShipments = data.length === SHIP_PAGE_SIZE
    page++
  }

  console.log(`Loaded ${shipments.length} shipments with tracking_id`)

  // Create map
  const trackingMap = new Map()
  for (const s of shipments) {
    trackingMap.set(String(s.shipment_id), s.tracking_id)
  }

  // Get transactions that need updating
  const TX_PAGE_SIZE = 1000
  let allTxToUpdate = []
  let txPage = 0
  let hasMoreTx = true

  while (hasMoreTx) {
    const { data: batch, error } = await supabase
      .from('transactions')
      .select('id, reference_id')
      .eq('reference_type', 'Shipment')
      .is('tracking_id', null)
      .range(txPage * TX_PAGE_SIZE, (txPage + 1) * TX_PAGE_SIZE - 1)

    if (error) {
      console.error('Error fetching transactions:', error)
      break
    }

    allTxToUpdate = allTxToUpdate.concat(batch)
    hasMoreTx = batch.length === TX_PAGE_SIZE
    txPage++
  }

  console.log(`Found ${allTxToUpdate.length} Shipment transactions without tracking_id`)

  // Match and prepare updates
  const updates = []
  for (const tx of allTxToUpdate) {
    const tracking = trackingMap.get(String(tx.reference_id))
    if (tracking) {
      updates.push({ id: tx.id, tracking_id: tracking })
    }
  }

  console.log(`Can fill ${updates.length} from shipments table`)

  if (updates.length === 0) {
    console.log('Nothing to backfill!')
    return { updated: 0 }
  }

  if (DRY_RUN) {
    console.log('[DRY RUN] Would update these transactions')
    return { updated: 0, wouldUpdate: updates.length }
  }

  // Apply updates in batches
  let totalUpdated = 0
  const BATCH_SIZE = 100

  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE)

    for (const u of batch) {
      const { error } = await supabase
        .from('transactions')
        .update({ tracking_id: u.tracking_id })
        .eq('id', u.id)

      if (!error) totalUpdated++
    }

    if ((i + BATCH_SIZE) % 1000 === 0 || i + BATCH_SIZE >= updates.length) {
      console.log(`  Updated ${totalUpdated} so far...`)
    }
  }

  console.log(`\n✅ Updated ${totalUpdated} transactions with tracking_id from shipments`)
  return { updated: totalUpdated }
}

async function backfillInvoiceDateSb() {
  console.log('\n' + '='.repeat(60))
  console.log('STEP 3: Backfill invoice_date_sb from invoices_sb table')
  console.log('='.repeat(60))

  // Load invoices_sb
  const { data: sbInvoices, error: sbError } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_date')

  if (sbError) {
    console.error('Error fetching invoices_sb:', sbError)
    return { updated: 0 }
  }

  // Create map
  const dateMap = new Map()
  for (const inv of sbInvoices) {
    dateMap.set(inv.shipbob_invoice_id, inv.invoice_date)
  }
  console.log(`Loaded ${dateMap.size} ShipBob invoice dates`)

  // Get transactions needing update
  const PAGE_SIZE = 1000
  let allTx = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    const { data: batch, error } = await supabase
      .from('transactions')
      .select('id, invoice_id_sb')
      .not('invoice_id_sb', 'is', null)
      .is('invoice_date_sb', null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (error) {
      console.error('Error fetching transactions:', error)
      break
    }

    allTx = allTx.concat(batch)
    hasMore = batch.length === PAGE_SIZE
    page++
  }

  console.log(`Found ${allTx.length} transactions with invoice_id_sb but no invoice_date_sb`)

  // Match and prepare updates
  const updates = []
  for (const tx of allTx) {
    const date = dateMap.get(String(tx.invoice_id_sb))
    if (date) {
      updates.push({ id: tx.id, invoice_date_sb: date.split('T')[0] })
    }
  }

  console.log(`Can fill ${updates.length} from invoices_sb table`)

  if (updates.length === 0) {
    console.log('Nothing to backfill!')
    return { updated: 0 }
  }

  if (DRY_RUN) {
    console.log('[DRY RUN] Would update these transactions')
    return { updated: 0, wouldUpdate: updates.length }
  }

  // Group by date for batch updates
  const byDate = new Map()
  for (const u of updates) {
    if (!byDate.has(u.invoice_date_sb)) {
      byDate.set(u.invoice_date_sb, [])
    }
    byDate.get(u.invoice_date_sb).push(u.id)
  }

  let totalUpdated = 0
  for (const [date, ids] of byDate) {
    // Batch in chunks of 500
    for (let i = 0; i < ids.length; i += 500) {
      const batch = ids.slice(i, i + 500)
      const { error } = await supabase
        .from('transactions')
        .update({ invoice_date_sb: date })
        .in('id', batch)

      if (!error) {
        totalUpdated += batch.length
      }
    }
  }

  console.log(`\n✅ Updated ${totalUpdated} transactions with invoice_date_sb`)
  return { updated: totalUpdated }
}

async function main() {
  console.log('='.repeat(60))
  console.log('TRANSACTIONS TABLE CLEANUP')
  console.log('='.repeat(60))
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Time: ${new Date().toISOString()}`)

  const results = {}

  // Step 1: Backfill tracking_id from additional_details
  results.trackingFromDetails = await backfillTrackingIdFromAdditionalDetails()

  // Step 2: Backfill tracking_id from shipments table
  results.trackingFromShipments = await backfillTrackingIdFromShipments()

  // Step 3: Backfill invoice_date_sb
  results.invoiceDateSb = await backfillInvoiceDateSb()

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`tracking_id from additional_details: ${results.trackingFromDetails.updated || results.trackingFromDetails.wouldUpdate || 0}`)
  console.log(`tracking_id from shipments: ${results.trackingFromShipments.updated || results.trackingFromShipments.wouldUpdate || 0}`)
  console.log(`invoice_date_sb: ${results.invoiceDateSb.updated || results.invoiceDateSb.wouldUpdate || 0}`)

  console.log('\n--- MANUAL STEPS REQUIRED ---')
  console.log('Run these in Supabase SQL Editor:')
  console.log('')
  console.log('-- 1. Drop raw_data column (only 50 records, not needed)')
  console.log('ALTER TABLE transactions DROP COLUMN IF EXISTS raw_data;')
  console.log('')
  console.log('-- 2. Rename transaction_fee to fee_type for clarity')
  console.log('ALTER TABLE transactions RENAME COLUMN transaction_fee TO fee_type;')
  console.log('')

  if (DRY_RUN) {
    console.log('\nRun without --dry-run to apply changes')
  }
}

main().catch(console.error)
