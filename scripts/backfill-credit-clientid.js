/**
 * Backfill client_id for Credit transactions where it's NULL
 *
 * Credits have reference_type='Default' but reference_id is often a shipment_id
 * This script looks up shipment_id in the shipments table to get client_id
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function backfillCreditClientId() {
  console.log('=== Credit client_id Backfill ===\n');
  const startTime = Date.now();

  // Step 1: Build shipment_id -> client_id lookup
  console.log('Step 1: Building shipment lookup...');
  const shipmentLookup = {};
  let lastId = null;
  const pageSize = 1000;

  while (true) {
    let query = supabase
      .from('shipments')
      .select('id, shipment_id, client_id')
      .not('client_id', 'is', null)
      .order('id', { ascending: true })
      .limit(pageSize);

    if (lastId) {
      query = query.gt('id', lastId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('Error fetching shipments:', error.message);
      break;
    }

    if (!data || data.length === 0) break;

    for (const s of data) {
      shipmentLookup[s.shipment_id] = s.client_id;
      lastId = s.id;
    }

    process.stdout.write(`\r  Loaded ${Object.keys(shipmentLookup).length} shipments...`);

    if (data.length < pageSize) break;
  }

  console.log(`\n  Total: ${Object.keys(shipmentLookup).length} shipments in lookup\n`);

  // Step 2: Get ALL Credit transactions with NULL client_id
  console.log('Step 2: Fetching Credit transactions with NULL client_id...');

  const { data: allCredits, error: txError } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, fee_type, reference_type')
    .is('client_id', null)
    .eq('fee_type', 'Credit');

  if (txError) {
    console.error('Error fetching transactions:', txError.message);
    return;
  }

  console.log(`  Found ${allCredits?.length || 0} Credit transactions with NULL client_id\n`);

  if (!allCredits || allCredits.length === 0) {
    console.log('No credits to update!');
    return;
  }

  // Step 3: Group transactions by their target client_id
  console.log('Step 3: Grouping transactions by client_id...');
  const byClientId = {};
  let noMatch = 0;

  for (const tx of allCredits) {
    // Try shipment lookup first (reference_id is often a shipment_id)
    const clientId = shipmentLookup[tx.reference_id] || null;

    if (clientId) {
      if (!byClientId[clientId]) byClientId[clientId] = [];
      byClientId[clientId].push(tx.transaction_id);
    } else {
      noMatch++;
      // Log the ones we can't match for debugging
      console.log(`  No match for: tx=${tx.transaction_id}, ref_id=${tx.reference_id}, ref_type=${tx.reference_type}`);
    }
  }

  console.log(`  ${Object.keys(byClientId).length} unique client_ids found`);
  console.log(`  ${noMatch} transactions have no matching shipment\n`);

  // Step 4: Batch update by client_id
  console.log('Step 4: Updating transactions by client_id batches...');
  let totalUpdated = 0;
  const clientIds = Object.keys(byClientId);

  for (let i = 0; i < clientIds.length; i++) {
    const clientId = clientIds[i];
    const txIds = byClientId[clientId];

    // Update in batches of 500 transaction_ids at a time
    const BATCH_SIZE = 500;
    for (let j = 0; j < txIds.length; j += BATCH_SIZE) {
      const batch = txIds.slice(j, j + BATCH_SIZE);

      const { error: updateError } = await supabase
        .from('transactions')
        .update({ client_id: clientId })
        .in('transaction_id', batch);

      if (updateError) {
        console.error(`  Error updating batch for client ${clientId}:`, updateError.message);
      } else {
        totalUpdated += batch.length;
      }
    }

    process.stdout.write(`\r  Processed ${i + 1}/${clientIds.length} clients (${totalUpdated} transactions updated)...`);
  }

  console.log('\n');

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('=== Summary ===');
  console.log(`Total credits updated: ${totalUpdated}`);
  console.log(`Skipped (no matching shipment): ${noMatch}`);
  console.log(`Duration: ${duration}s`);

  // Verify the result
  console.log('\nVerifying...');
  const { count: stillNull } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('client_id', null)
    .eq('fee_type', 'Credit');

  console.log(`Remaining Credit transactions with null client_id: ${stillNull}`);
}

backfillCreditClientId().catch(console.error);
