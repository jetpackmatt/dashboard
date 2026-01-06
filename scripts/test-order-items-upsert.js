#!/usr/bin/env node
/**
 * Test order_items upsert for a specific order
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function test() {
  const clientId = '6b94c274-0446-4167-9d02-b998f8be59ad';
  const merchantId = '386350';

  // Get API token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', clientId)
    .eq('provider', 'shipbob')
    .single();

  // Fetch the order
  const shipbobOrderId = '324546680';
  const res = await fetch('https://api.shipbob.com/2025-07/order/' + shipbobOrderId, {
    headers: { Authorization: 'Bearer ' + creds.api_token }
  });
  const order = await res.json();

  console.log('API Order ID:', order.id);
  console.log('API Products:', order.products ? order.products.length : 0);

  // Get the DB order UUID
  const { data: dbOrder } = await supabase
    .from('orders')
    .select('id')
    .eq('client_id', clientId)
    .eq('shipbob_order_id', shipbobOrderId)
    .single();

  console.log('DB Order UUID:', dbOrder ? dbOrder.id : null);

  if (!dbOrder || !order.products || order.products.length === 0) {
    console.log('Skipping - no order or no products');
    return;
  }

  // Build order_item records (same as sync.ts line 764-776)
  const orderItemRecords = order.products.map(product => ({
    client_id: clientId,
    merchant_id: merchantId,
    order_id: dbOrder.id,
    shipbob_product_id: product.id || null,
    sku: product.sku || null,
    reference_id: product.reference_id || null,
    quantity: product.quantity || null,
    unit_price: product.unit_price || null,
    upc: product.upc || null,
    external_line_id: product.external_line_id || null,
  }));

  console.log('\nWould create order_items:', orderItemRecords.length);
  console.log('First record:', JSON.stringify(orderItemRecords[0], null, 2));

  // Try the upsert
  const { data, error } = await supabase
    .from('order_items')
    .upsert(orderItemRecords, { onConflict: 'order_id,shipbob_product_id', ignoreDuplicates: false });

  if (error) {
    console.log('\nUPSERT ERROR:', error.message);
  } else {
    console.log('\nUpsert successful!');
  }

  // Verify
  const { data: items, error: verifyError } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', dbOrder.id);

  console.log('\nVerification - items in DB:', items ? items.length : 0);
}

test().catch(console.error);
