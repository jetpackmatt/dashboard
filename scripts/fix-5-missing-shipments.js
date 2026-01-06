#!/usr/bin/env node
/**
 * Quick fix for the 5 specific shipments missing items (blocking invoice preflight)
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  const clientId = '6b94c274-0446-4167-9d02-b998f8be59ad'; // Henson
  const merchantId = '386350';

  // Get API token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', clientId)
    .eq('provider', 'shipbob')
    .single();

  if (!creds) {
    console.log('No token found');
    return;
  }

  // These are the 5 missing shipments from preflight
  const missingShipmentIds = ['332339392', '332346406', '332402186', '332363279', '332238838'];

  // Get shipbob_order_ids for these shipments
  const { data: shipments } = await supabase
    .from('shipments')
    .select('shipment_id, order_id, shipbob_order_id')
    .in('shipment_id', missingShipmentIds);

  console.log(`Found ${shipments.length} shipments to fix\n`);

  for (const shipment of shipments) {
    console.log(`=== Fixing shipment ${shipment.shipment_id} ===`);
    console.log(`  ShipBob Order ID: ${shipment.shipbob_order_id}`);

    // Check if already has items
    const { count: itemCount } = await supabase
      .from('shipment_items')
      .select('*', { count: 'exact', head: true })
      .eq('shipment_id', shipment.shipment_id);

    if (itemCount > 0) {
      console.log(`  Already has ${itemCount} items - skipping`);
      continue;
    }

    // Fetch order from API
    const res = await fetch(`https://api.shipbob.com/2025-07/order/${shipment.shipbob_order_id}`, {
      headers: { Authorization: 'Bearer ' + creds.api_token }
    });

    if (!res.ok) {
      console.log(`  API Error: ${res.status}`);
      continue;
    }

    const apiOrder = await res.json();
    console.log(`  API products: ${apiOrder.products?.length || 0}`);
    console.log(`  API shipments: ${apiOrder.shipments?.length || 0}`);

    // Create order_items first
    if (apiOrder.products && apiOrder.products.length > 0) {
      const orderItemRecords = apiOrder.products.map(product => ({
        client_id: clientId,
        merchant_id: merchantId,
        order_id: shipment.order_id,
        shipbob_product_id: product.id || null,
        sku: product.sku || null,
        reference_id: product.reference_id || null,
        quantity: product.quantity || null,
        unit_price: product.unit_price || null,
      }));

      const { error: oiError } = await supabase
        .from('order_items')
        .upsert(orderItemRecords, { onConflict: 'order_id,shipbob_product_id' });

      if (oiError) {
        console.log(`  order_items error: ${oiError.message}`);
      } else {
        console.log(`  Created ${orderItemRecords.length} order_items`);
      }
    }

    // Create shipment_items
    const apiShipment = apiOrder.shipments?.find(s => s.id.toString() === shipment.shipment_id);
    if (apiShipment && apiShipment.products && apiShipment.products.length > 0) {
      // Build order product quantity lookup
      const orderQtyById = {};
      const orderQtyBySku = {};
      for (const p of apiOrder.products || []) {
        if (p.quantity) {
          if (p.id) orderQtyById[p.id] = p.quantity;
          if (p.sku) orderQtyBySku[p.sku] = p.quantity;
        }
      }

      const shipmentItemRecords = apiShipment.products.map(product => {
        const inv = product.inventory?.[0] || {};
        const orderQty = (product.id ? orderQtyById[product.id] : null) ??
                        (product.sku ? orderQtyBySku[product.sku] : null);

        return {
          client_id: clientId,
          merchant_id: merchantId,
          shipment_id: shipment.shipment_id,
          shipbob_product_id: product.id || null,
          sku: product.sku || null,
          reference_id: product.reference_id || null,
          name: product.name || null,
          lot: inv.lot || null,
          expiration_date: inv.expiration_date || null,
          quantity: inv.quantity || orderQty || product.quantity || null,
          is_dangerous_goods: product.is_dangerous_goods || false,
        };
      });

      const { error: siError } = await supabase
        .from('shipment_items')
        .insert(shipmentItemRecords);

      if (siError) {
        console.log(`  shipment_items error: ${siError.message}`);
      } else {
        console.log(`  Created ${shipmentItemRecords.length} shipment_items`);
      }
    } else {
      console.log(`  No products in API for shipment ${shipment.shipment_id}`);
    }

    // Rate limiting
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n=== DONE ===');

  // Verify results
  const { data: results } = await supabase
    .from('shipment_items')
    .select('shipment_id')
    .in('shipment_id', missingShipmentIds);

  console.log(`Shipment items now: ${results?.length || 0}`);
}

main().catch(console.error);
