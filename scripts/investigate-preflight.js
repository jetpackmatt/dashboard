const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigate() {
  // Get unprocessed ShipBob invoices
  const { data: unprocessedInvoices } = await supabase
    .from('invoices_sb')
    .select('id, shipbob_invoice_id')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment');
  
  console.log('Unprocessed ShipBob invoices:', unprocessedInvoices?.length);
  
  const invoiceIds = (unprocessedInvoices || [])
    .map(i => parseInt(i.shipbob_invoice_id))
    .filter(id => !Number.isNaN(id));
  console.log('Invoice IDs:', invoiceIds);
  
  // Check Henson's transactions for one of these invoices
  const hensonClientId = '4f9ed195-aa83-4b14-8725-181b00a8dcbc';
  
  // Count all transactions for Henson in these invoices
  const { count: totalCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonClientId)
    .in('invoice_id_sb', invoiceIds);
  
  console.log('Total Henson transactions:', totalCount);
  
  // Check shipments specifically  
  const { count: shipmentCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonClientId)
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .in('invoice_id_sb', invoiceIds);
  
  console.log('\nShipment count:', shipmentCount);
  
  // Check sample shipments
  const { data: sampleShipments } = await supabase
    .from('transactions')
    .select('id, reference_type, transaction_fee, base_cost, surcharge, cost, carrier_name, ship_option_name')
    .eq('client_id', hensonClientId)
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .in('invoice_id_sb', invoiceIds)
    .limit(5);
  
  console.log('Sample shipments:');
  for (const s of sampleShipments || []) {
    console.log('  base_cost:', s.base_cost, 'surcharge:', s.surcharge, 'cost:', s.cost, 
                'carrier:', s.carrier_name, 'ship_option:', s.ship_option_name);
  }
  
  // Check how many have null base_cost
  const { count: nullBaseCost } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonClientId)
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .in('invoice_id_sb', invoiceIds)
    .is('base_cost', null);
  
  console.log('\nShipments with null base_cost:', nullBaseCost, 'of', shipmentCount);
  
  // Check carrier_name nulls
  const { count: nullCarrier } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonClientId)
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .in('invoice_id_sb', invoiceIds)
    .is('carrier_name', null);
  
  console.log('Shipments with null carrier_name:', nullCarrier);
  
  // Check ship_option_name nulls  
  const { count: nullShipOption } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonClientId)
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .in('invoice_id_sb', invoiceIds)
    .is('ship_option_name', null);
  
  console.log('Shipments with null ship_option_name:', nullShipOption);
}

investigate();
