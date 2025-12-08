const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigate() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad';
  const invoiceIds = [8633634, 8633637, 8633641, 8633632, 8633612, 8633618];
  
  // First get the shipment IDs from transactions
  const { data: shippingTxs } = await supabase
    .from('transactions')
    .select('id, reference_id')
    .eq('client_id', hensonId)
    .eq('transaction_fee', 'Shipping')
    .eq('reference_type', 'Shipment')
    .in('invoice_id_sb', invoiceIds);
  
  const shipmentIds = (shippingTxs || [])
    .filter(tx => tx.reference_id)
    .map(tx => tx.reference_id);
  
  console.log('Shipping transactions with reference_id:', shipmentIds.length);
  console.log('Sample reference_ids:', shipmentIds.slice(0, 5));
  
  // Now check how many of these exist in the shipments table
  const uniqueIds = [...new Set(shipmentIds)];
  console.log('Unique shipment IDs:', uniqueIds.length);
  
  // Check shipments table for these IDs
  const { data: shipments, count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact' })
    .eq('client_id', hensonId)
    .in('shipment_id', uniqueIds.slice(0, 500));
  
  console.log('\nShipments found in shipments table:', shipmentCount);
  
  // Also check total shipments for Henson
  const { count: totalHensonShipments } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonId);
  
  console.log('Total Henson shipments in DB:', totalHensonShipments);
  
  // Check orders table too
  const { count: totalOrders } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonId);
  
  console.log('Total Henson orders in DB:', totalOrders);
}

investigate();
