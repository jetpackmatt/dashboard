#!/usr/bin/env node
/**
 * Check why shipment_items are missing for specific shipments
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Get Henson's API token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', '6b94c274-0446-4167-9d02-b998f8be59ad')
    .eq('provider', 'shipbob')
    .single();

  if (!creds) {
    console.log('No token found');
    return;
  }

  console.log('Found API token');

  // Check ALL 5 missing shipments
  const missingShipmentIds = ['332339392', '332346406', '332402186', '332363279', '332238838'];

  const { data: shipments } = await supabase
    .from('shipments')
    .select('shipment_id, order_id, shipbob_order_id, status, tracking_id')
    .in('shipment_id', missingShipmentIds);

  console.log('\n=== Checking all 5 missing shipments ===');

  for (const shipment of shipments || []) {
    console.log(`\n--- Shipment ${shipment.shipment_id} ---`);
    console.log('DB Status:', shipment.status);
    console.log('Order ID (UUID):', shipment.order_id);
    console.log('ShipBob Order ID (numeric):', shipment.shipbob_order_id);

    // Now fetch the order from ShipBob API using the NUMERIC shipbob_order_id
    const res = await fetch('https://api.shipbob.com/2025-07/order/' + shipment.shipbob_order_id, {
      headers: { Authorization: 'Bearer ' + creds.api_token }
    });

    if (!res.ok) {
      console.log('API Response:', res.status, res.statusText);
      continue;
    }

    const order = await res.json();
    console.log('API Status:', order.status || 'undefined');
    console.log('API Products:', order.products?.length || 0);
    console.log('API Shipments:', order.shipments?.length || 0);

    if (order.shipments?.length > 0) {
      for (const s of order.shipments) {
        console.log(`  Shipment ${s.id} - products: ${s.products?.length || 0}`);
      }
    }
  }

  // Also check a sample of shipments WITH items to compare
  console.log('\n\n=== Checking a shipment WITH items for comparison ===');

  // Find one that HAS items
  const { data: withItems } = await supabase
    .from('shipment_items')
    .select('shipment_id')
    .eq('client_id', '6b94c274-0446-4167-9d02-b998f8be59ad')
    .limit(1)
    .single();

  if (withItems) {
    const { data: goodShip } = await supabase
      .from('shipments')
      .select('shipment_id, order_id, shipbob_order_id, status')
      .eq('shipment_id', withItems.shipment_id)
      .single();

    console.log('Good shipment:', goodShip.shipment_id);
    console.log('Good order_id (UUID):', goodShip.order_id);
    console.log('Good shipbob_order_id (numeric):', goodShip.shipbob_order_id);

    // Use the NUMERIC shipbob_order_id for API call
    const res2 = await fetch('https://api.shipbob.com/2025-07/order/' + goodShip.shipbob_order_id, {
      headers: { Authorization: 'Bearer ' + creds.api_token }
    });
    const goodOrder = await res2.json();
    console.log('API Status:', goodOrder.status);
    console.log('API Products:', goodOrder.products?.length || 0);
    console.log('API Shipments:', goodOrder.shipments?.length || 0);
    if (goodOrder.shipments?.length > 0) {
      console.log('First shipment products:', goodOrder.shipments[0].products?.length || 0);
    }
  }
}

main().catch(console.error);
