#!/usr/bin/env node
/**
 * Test order LIST endpoint to check if products are included
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const clientId = '6b94c274-0446-4167-9d02-b998f8be59ad';

  // Get API token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', clientId)
    .eq('provider', 'shipbob')
    .single();

  // Use StartDate like reconcile does (20 days back)
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 20);

  const params = new URLSearchParams({
    Page: '1',
    Limit: '50',
    StartDate: startDate.toISOString(),
    EndDate: endDate.toISOString()
  });

  console.log('Query:', params.toString());

  const res = await fetch('https://api.shipbob.com/2025-07/order?' + params.toString(), {
    headers: { Authorization: 'Bearer ' + creds.api_token }
  });

  const totalPages = res.headers.get('total-pages');
  console.log('Total pages:', totalPages);

  const orders = await res.json();
  console.log('Orders returned:', orders.length);

  // Check if orders have products
  let withProducts = 0;
  let withoutProducts = 0;
  const samplesWithout = [];

  for (const order of orders) {
    const hasProducts = order.products && order.products.length > 0;
    if (hasProducts) {
      withProducts++;
    } else {
      withoutProducts++;
      if (samplesWithout.length < 5) {
        samplesWithout.push({
          id: order.id,
          status: order.status,
          products: order.products,
          created: order.created_date
        });
      }
    }
  }

  console.log('\nWith products:', withProducts);
  console.log('Without products:', withoutProducts);

  if (samplesWithout.length > 0) {
    console.log('\nSample orders without products:');
    for (const s of samplesWithout) {
      console.log(`  Order ${s.id} - status: ${s.status}, products: ${JSON.stringify(s.products)}`);
    }
  }

  // Also check a specific order that's missing items
  console.log('\n--- Checking specific order that is missing items ---');
  const { data: missingOrder } = await supabase
    .from('orders')
    .select('shipbob_order_id')
    .eq('client_id', clientId)
    .eq('id', (await supabase
      .from('orders')
      .select('id')
      .eq('client_id', clientId)
      .not('id', 'in',
        supabase.from('order_items').select('order_id'))
      .order('created_at', { ascending: false })
      .limit(1)
      .single()).data?.id)
    .single();

  // Simpler approach - just get one order ID that's missing items
  const { data: ordersMissingItems } = await supabase
    .from('orders')
    .select('id, shipbob_order_id')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false })
    .limit(100);

  const { data: orderItemOrderIds } = await supabase
    .from('order_items')
    .select('order_id')
    .in('order_id', ordersMissingItems.map(o => o.id));

  const hasItemsSet = new Set(orderItemOrderIds.map(oi => oi.order_id));
  const missingItemsOrders = ordersMissingItems.filter(o => !hasItemsSet.has(o.id));

  if (missingItemsOrders.length > 0) {
    const testOrderId = missingItemsOrders[0].shipbob_order_id;
    console.log('Testing order:', testOrderId);

    // Check if it's in the LIST response
    const inList = orders.find(o => o.id.toString() === testOrderId);
    if (inList) {
      console.log('Found in LIST response:');
      console.log('  Status:', inList.status);
      console.log('  Products:', inList.products ? inList.products.length : 0);
    } else {
      console.log('NOT found in first page of LIST response');

      // Try fetching it directly
      const singleRes = await fetch('https://api.shipbob.com/2025-07/order/' + testOrderId, {
        headers: { Authorization: 'Bearer ' + creds.api_token }
      });
      const singleOrder = await singleRes.json();
      console.log('Direct fetch:');
      console.log('  Status:', singleOrder.status);
      console.log('  Products:', singleOrder.products ? singleOrder.products.length : 0);
    }
  }
}

test().catch(console.error);
