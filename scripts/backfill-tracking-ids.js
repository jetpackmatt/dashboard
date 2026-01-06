#!/usr/bin/env node
/**
 * Backfill tracking_id on transactions from shipments table
 *
 * This fixes the ~7,500 Shipment-type transactions that have
 * reference_id (shipment_id) but no tracking_id copied over.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function backfillTrackingIds() {
  console.log('Backfilling tracking_id on transactions from shipments table...\n');

  // Build shipment_id -> tracking_id map
  console.log('Building shipment -> tracking_id map...');
  const shipmentTrackingMap = new Map();
  let lastShipmentId = null;
  let shipmentCount = 0;

  while (true) {
    let query = supabase
      .from('shipments')
      .select('shipment_id, tracking_id')
      .not('tracking_id', 'is', null)
      .order('shipment_id', { ascending: true })
      .limit(1000);

    if (lastShipmentId) {
      query = query.gt('shipment_id', lastShipmentId);
    }

    const { data: shipments, error } = await query;
    if (error) {
      console.error('Error fetching shipments:', error);
      break;
    }
    if (!shipments || shipments.length === 0) break;

    for (const s of shipments) {
      shipmentTrackingMap.set(s.shipment_id, s.tracking_id);
      lastShipmentId = s.shipment_id;
    }
    shipmentCount += shipments.length;

    if (shipments.length < 1000) break;
  }

  console.log(`Loaded ${shipmentCount} shipments with tracking IDs\n`);

  // Find and update transactions missing tracking_id
  console.log('Finding Shipment transactions missing tracking_id...');
  let updated = 0;
  let notFound = 0;
  let lastTxId = null;

  while (true) {
    let query = supabase
      .from('transactions')
      .select('id, reference_id')
      .eq('reference_type', 'Shipment')
      .is('tracking_id', null)
      .order('id', { ascending: true })
      .limit(500);

    if (lastTxId) {
      query = query.gt('id', lastTxId);
    }

    const { data: txs, error } = await query;
    if (error) {
      console.error('Error fetching transactions:', error);
      break;
    }
    if (!txs || txs.length === 0) break;

    // Process in batches
    for (const tx of txs) {
      lastTxId = tx.id;

      const trackingId = shipmentTrackingMap.get(tx.reference_id);
      if (trackingId) {
        const { error: updateError } = await supabase
          .from('transactions')
          .update({ tracking_id: trackingId })
          .eq('id', tx.id);

        if (updateError) {
          console.error(`Error updating tx ${tx.id}:`, updateError);
        } else {
          updated++;
        }
      } else {
        notFound++;
      }
    }

    console.log(`Progress: ${updated} updated, ${notFound} shipment not found`);

    if (txs.length < 500) break;
  }

  console.log('\n=== COMPLETE ===');
  console.log(`Updated: ${updated} transactions`);
  console.log(`Not found in shipments table: ${notFound}`);

  // Final check
  const { count: remaining } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('reference_type', 'Shipment')
    .is('tracking_id', null);

  console.log(`\nRemaining without tracking_id: ${remaining}`);
}

backfillTrackingIds().catch(console.error);
