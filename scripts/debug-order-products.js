#!/usr/bin/env node
/**
 * Debug why some orders don't have products in API response
 * Compares orders WITH items vs WITHOUT items to find pattern
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

  // Get some orders WITHOUT items (missing)
  const { data: missingOrders } = await supabase
    .from('orders')
    .select('id, shipbob_order_id, order_import_date, status')
    .eq('client_id', '6b94c274-0446-4167-9d02-b998f8be59ad')
    .gte('order_import_date', '2025-12-28')
    .order('order_import_date', { ascending: false })
    .limit(100);

  // Filter to only those without order_items
  const { data: orderItemsExist } = await supabase
    .from('order_items')
    .select('order_id')
    .in('order_id', missingOrders.map(o => o.id));

  const orderIdsWithItems = new Set(orderItemsExist.map(oi => oi.order_id));
  const ordersWithoutItems = missingOrders.filter(o => !orderIdsWithItems.has(o.id));
  const ordersWithItems = missingOrders.filter(o => orderIdsWithItems.has(o.id));

  console.log(`\n=== Orders WITHOUT items: ${ordersWithoutItems.length} ===`);
  console.log(`=== Orders WITH items: ${ordersWithItems.length} ===`);

  // Sample a few from each group and check API response
  console.log('\n--- Checking 3 orders WITHOUT items ---');
  for (const order of ordersWithoutItems.slice(0, 3)) {
    const res = await fetch('https://api.shipbob.com/2025-07/order/' + order.shipbob_order_id, {
      headers: { Authorization: 'Bearer ' + creds.api_token }
    });

    if (!res.ok) {
      console.log(`Order ${order.shipbob_order_id}: API Error ${res.status}`);
      continue;
    }

    const apiOrder = await res.json();
    console.log(`Order ${order.shipbob_order_id}:`);
    console.log(`  Status: ${apiOrder.status}`);
    console.log(`  Products: ${apiOrder.products?.length || 0}`);
    console.log(`  Shipments: ${apiOrder.shipments?.length || 0}`);
    if (apiOrder.products && apiOrder.products.length > 0) {
      console.log(`  First product: ${JSON.stringify(apiOrder.products[0], null, 2).substring(0, 200)}...`);
    }
  }

  console.log('\n--- Checking 3 orders WITH items for comparison ---');
  for (const order of ordersWithItems.slice(0, 3)) {
    const res = await fetch('https://api.shipbob.com/2025-07/order/' + order.shipbob_order_id, {
      headers: { Authorization: 'Bearer ' + creds.api_token }
    });

    if (!res.ok) {
      console.log(`Order ${order.shipbob_order_id}: API Error ${res.status}`);
      continue;
    }

    const apiOrder = await res.json();
    console.log(`Order ${order.shipbob_order_id}:`);
    console.log(`  Status: ${apiOrder.status}`);
    console.log(`  Products: ${apiOrder.products?.length || 0}`);
    console.log(`  Shipments: ${apiOrder.shipments?.length || 0}`);
  }
}

main().catch(console.error);
