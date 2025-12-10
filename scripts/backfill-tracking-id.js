#!/usr/bin/env node
/**
 * Backfill tracking_id on transactions from linked shipments
 */
require('dotenv').config({ path: '.env.local' });
const { createClient } = require('@supabase/supabase-js');

async function backfillTrackingId() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  // Get transactions missing tracking_id
  const { data: toUpdate, error: fetchError } = await supabase
    .from('transactions')
    .select('id, reference_id')
    .eq('reference_type', 'Shipment')
    .is('tracking_id', null)
    .limit(500);

  if (fetchError) {
    console.error('Fetch error:', fetchError.message);
    return;
  }

  console.log('Found', toUpdate?.length || 0, 'transactions to check');

  let updated = 0;
  let noShipment = 0;
  for (const tx of toUpdate || []) {
    // Get shipment tracking
    const { data: ship } = await supabase
      .from('shipments')
      .select('tracking_id')
      .eq('shipment_id', tx.reference_id)
      .single();

    if (ship?.tracking_id) {
      const { error } = await supabase
        .from('transactions')
        .update({ tracking_id: ship.tracking_id })
        .eq('id', tx.id);

      if (error) {
        console.error('Update error:', error.message);
      } else {
        updated++;
      }
    } else {
      noShipment++;
    }
  }

  console.log(`Updated ${updated} transactions with tracking_id`);
  console.log(`${noShipment} transactions have no matching shipment with tracking`);
}

backfillTrackingId().catch(console.error);
