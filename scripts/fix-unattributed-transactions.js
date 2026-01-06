#!/usr/bin/env node
/**
 * Fix unattributed Shipment transactions by copying client_id from matching shipments
 *
 * Root cause: Transaction sync builds clientLookup at start of run, but if shipments
 * weren't synced yet (or sync timing issues), transactions get upserted with client_id = null.
 * Once in DB, the reconcile only re-fetches transactions within a 3-day window.
 *
 * This script does a direct database join to fix all unattributed Shipment transactions.
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fixUnattributedTransactions() {
  console.log('=== Fix Unattributed Shipment Transactions ===\n')

  // Step 1: Count how many need fixing
  const { data: countData, error: countError } = await supabase.rpc('exec_sql', {
    sql: `
      SELECT COUNT(*) as count
      FROM transactions t
      JOIN shipments s ON t.reference_id = s.shipment_id
      WHERE t.reference_type = 'Shipment'
        AND t.client_id IS NULL
        AND s.client_id IS NOT NULL
    `
  })

  if (countError) {
    // Fallback: do it manually with pagination
    console.log('Using manual approach (rpc not available)...\n')
  }

  // Step 2: Get all unattributed transactions with their shipment's client_id
  console.log('Fetching unattributed Shipment transactions...')

  let totalFixed = 0
  let lastId = null
  const pageSize = 1000

  while (true) {
    // Get batch of unattributed transactions
    let query = supabase
      .from('transactions')
      .select('id, transaction_id, reference_id')
      .eq('reference_type', 'Shipment')
      .is('client_id', null)
      .order('id', { ascending: true })
      .limit(pageSize)

    if (lastId) {
      query = query.gt('id', lastId)
    }

    const { data: transactions, error: txError } = await query

    if (txError) {
      console.error('Error fetching transactions:', txError.message)
      break
    }

    if (!transactions || transactions.length === 0) {
      console.log('No more unattributed transactions found.')
      break
    }

    console.log(`Processing batch of ${transactions.length} transactions...`)

    // Get shipment info for these reference_ids
    const referenceIds = transactions.map(t => t.reference_id)
    const { data: shipments, error: shipError } = await supabase
      .from('shipments')
      .select('shipment_id, client_id')
      .in('shipment_id', referenceIds)

    if (shipError) {
      console.error('Error fetching shipments:', shipError.message)
      break
    }

    // Build lookup
    const shipmentLookup = {}
    for (const s of shipments || []) {
      if (s.client_id) {
        shipmentLookup[s.shipment_id] = s.client_id
      }
    }

    // Update each transaction
    let batchFixed = 0
    for (const tx of transactions) {
      const clientId = shipmentLookup[tx.reference_id]
      if (clientId) {
        const { error: updateError } = await supabase
          .from('transactions')
          .update({
            client_id: clientId,
            updated_at: new Date().toISOString()
          })
          .eq('id', tx.id)

        if (updateError) {
          console.error(`Error updating transaction ${tx.transaction_id}:`, updateError.message)
        } else {
          batchFixed++
        }
      }
      lastId = tx.id
    }

    totalFixed += batchFixed
    console.log(`  Fixed ${batchFixed} in this batch (${totalFixed} total)`)

    if (transactions.length < pageSize) break
  }

  console.log(`\n=== Complete: Fixed ${totalFixed} transactions ===`)

  // Step 3: Verify the fix
  console.log('\nVerifying fix...')
  const { data: remaining } = await supabase
    .from('transactions')
    .select('id', { count: 'exact', head: true })
    .eq('reference_type', 'Shipment')
    .is('client_id', null)

  console.log(`Remaining unattributed Shipment transactions: ${remaining?.length || 0}`)
}

fixUnattributedTransactions().catch(console.error)
