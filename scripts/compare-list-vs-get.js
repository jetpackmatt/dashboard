#!/usr/bin/env node
/**
 * Compare ShipBob LIST /order vs GET /order/{id} API responses
 * Check if products are included in both
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

  // Fetch via LIST endpoint (same as sync uses)
  const startDate = new Date();
  startDate.setMinutes(startDate.getMinutes() - 60);  // Last hour

  const params = new URLSearchParams({
    Limit: '5',
    Page: '1',
    LastUpdateStartDate: startDate.toISOString(),
  });

  console.log('=== Fetching via LIST endpoint ===');
  console.log(`URL: /order?${params}`);

  const listRes = await fetch(`https://api.shipbob.com/2025-07/order?${params}`, {
    headers: { Authorization: 'Bearer ' + creds.api_token }
  });

  const listOrders = await listRes.json();
  console.log(`\nReturned ${listOrders.length} orders from LIST endpoint`);

  if (listOrders.length > 0) {
    const order = listOrders[0];
    console.log(`\nFirst order from LIST:`);
    console.log(`  ID: ${order.id}`);
    console.log(`  Status: ${order.status}`);
    console.log(`  Products: ${order.products?.length || 0}`);
    console.log(`  Shipments: ${order.shipments?.length || 0}`);
    if (order.products && order.products.length > 0) {
      console.log(`  First product keys: ${Object.keys(order.products[0]).join(', ')}`);
    } else {
      console.log(`  Products field: ${JSON.stringify(order.products)}`);
    }

    // Now fetch the same order via GET endpoint
    console.log(`\n=== Fetching same order via GET endpoint ===`);
    console.log(`URL: /order/${order.id}`);

    const getRes = await fetch(`https://api.shipbob.com/2025-07/order/${order.id}`, {
      headers: { Authorization: 'Bearer ' + creds.api_token }
    });
    const getOrder = await getRes.json();

    console.log(`\nSame order from GET:`);
    console.log(`  ID: ${getOrder.id}`);
    console.log(`  Status: ${getOrder.status}`);
    console.log(`  Products: ${getOrder.products?.length || 0}`);
    console.log(`  Shipments: ${getOrder.shipments?.length || 0}`);
    if (getOrder.products && getOrder.products.length > 0) {
      console.log(`  First product keys: ${Object.keys(getOrder.products[0]).join(', ')}`);
    }

    // Check if products match
    console.log(`\n=== Comparison ===`);
    console.log(`LIST products: ${order.products?.length || 0}`);
    console.log(`GET products: ${getOrder.products?.length || 0}`);
    console.log(`Match: ${(order.products?.length || 0) === (getOrder.products?.length || 0)}`);
  }
}

main().catch(console.error);
