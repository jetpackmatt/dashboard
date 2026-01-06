#!/usr/bin/env node
/**
 * Backfill missing order_items and shipment_items
 *
 * Problem: Some orders synced without products, causing shipments to miss items.
 * Solution: Re-fetch orders from API and populate order_items + shipment_items.
 */

const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const BATCH_SIZE = 50;

async function main() {
  const clientId = '6b94c274-0446-4167-9d02-b998f8be59ad'; // Henson

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

  // Get client info
  const { data: client } = await supabase
    .from('clients')
    .select('merchant_id')
    .eq('id', clientId)
    .single();

  console.log('Found API token for Henson');
  console.log('Merchant ID:', client.merchant_id);

  // Find orders without order_items
  console.log('\nFinding orders without order_items...');

  const { data: allOrders } = await supabase
    .from('orders')
    .select('id, shipbob_order_id, order_import_date')
    .eq('client_id', clientId)
    .gte('order_import_date', '2025-12-22')  // Last week's billing period
    .order('order_import_date', { ascending: false });

  // Check which have order_items
  const { data: orderItemsExist } = await supabase
    .from('order_items')
    .select('order_id')
    .in('order_id', allOrders.map(o => o.id));

  const orderIdsWithItems = new Set((orderItemsExist || []).map(oi => oi.order_id));
  const ordersWithoutItems = allOrders.filter(o => !orderIdsWithItems.has(o.id));

  console.log(`Total orders since Dec 22: ${allOrders.length}`);
  console.log(`Orders missing order_items: ${ordersWithoutItems.length}`);

  if (ordersWithoutItems.length === 0) {
    console.log('No orders to backfill!');
    return;
  }

  // Process in batches
  let totalOrderItemsCreated = 0;
  let totalShipmentItemsCreated = 0;
  let ordersProcessed = 0;

  for (let i = 0; i < ordersWithoutItems.length; i += BATCH_SIZE) {
    const batch = ordersWithoutItems.slice(i, i + BATCH_SIZE);
    console.log(`\nProcessing batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(ordersWithoutItems.length/BATCH_SIZE)} (${batch.length} orders)...`);

    for (const order of batch) {
      // Fetch order from API
      const res = await fetch(`https://api.shipbob.com/2025-07/order/${order.shipbob_order_id}`, {
        headers: { Authorization: 'Bearer ' + creds.api_token }
      });

      if (!res.ok) {
        console.log(`  Order ${order.shipbob_order_id}: API Error ${res.status}`);
        continue;
      }

      const apiOrder = await res.json();

      // Create order_items
      if (apiOrder.products && apiOrder.products.length > 0) {
        const orderItemRecords = apiOrder.products.map(product => ({
          client_id: clientId,
          merchant_id: client.merchant_id,
          order_id: order.id,
          shipbob_product_id: product.id || null,
          sku: product.sku || null,
          reference_id: product.reference_id || null,
          quantity: product.quantity || null,
          unit_price: product.unit_price || null,
          // Note: order_items table doesn't have 'name' column
        }));

        const { error: oiError } = await supabase
          .from('order_items')
          .upsert(orderItemRecords, { onConflict: 'order_id,shipbob_product_id' });

        if (oiError) {
          console.log(`  Order ${order.shipbob_order_id}: order_items error: ${oiError.message}`);
        } else {
          totalOrderItemsCreated += orderItemRecords.length;
        }
      }

      // Create shipment_items
      if (apiOrder.shipments && apiOrder.shipments.length > 0) {
        for (const shipment of apiOrder.shipments) {
          if (!shipment.products || shipment.products.length === 0) continue;

          // Build order product quantity lookup
          const orderQtyById = {};
          const orderQtyBySku = {};
          for (const p of apiOrder.products || []) {
            if (p.quantity) {
              if (p.id) orderQtyById[p.id] = p.quantity;
              if (p.sku) orderQtyBySku[p.sku] = p.quantity;
            }
          }

          const shipmentItemRecords = shipment.products.map(product => {
            const inv = product.inventory?.[0] || {};
            const orderQty = (product.id ? orderQtyById[product.id] : null) ??
                            (product.sku ? orderQtyBySku[product.sku] : null);

            return {
              client_id: clientId,
              merchant_id: client.merchant_id,
              shipment_id: shipment.id.toString(),
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

          // Delete existing and insert new
          await supabase
            .from('shipment_items')
            .delete()
            .eq('shipment_id', shipment.id.toString());

          const { error: siError } = await supabase
            .from('shipment_items')
            .insert(shipmentItemRecords);

          if (siError) {
            console.log(`  Shipment ${shipment.id}: shipment_items error: ${siError.message}`);
          } else {
            totalShipmentItemsCreated += shipmentItemRecords.length;
          }
        }
      }

      ordersProcessed++;

      // Rate limiting - 150 req/min max = 1 per 400ms, use 500ms for safety
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    console.log(`  Progress: ${ordersProcessed}/${ordersWithoutItems.length} orders, ${totalOrderItemsCreated} order_items, ${totalShipmentItemsCreated} shipment_items`);
  }

  console.log('\n=== BACKFILL COMPLETE ===');
  console.log(`Orders processed: ${ordersProcessed}`);
  console.log(`Order items created: ${totalOrderItemsCreated}`);
  console.log(`Shipment items created: ${totalShipmentItemsCreated}`);
}

main().catch(console.error);
