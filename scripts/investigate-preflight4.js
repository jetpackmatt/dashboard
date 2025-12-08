const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigate() {
  // Check what 4f9ed195... is
  const { data: oldClient } = await supabase
    .from('clients')
    .select('*')
    .eq('id', '4f9ed195-aa83-4b14-8725-181b00a8dcbc')
    .single();
  
  console.log('Client 4f9ed195...:', oldClient);
  
  // Now check the preflight validation logic
  // Look for why it's saying "3 shipments (100%)"
  
  // The real Henson ID
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad';
  const invoiceIds = [8633634, 8633637, 8633641, 8633632, 8633612, 8633618];
  
  // Check actual shipment data for the fields being validated
  const { data: shipments } = await supabase
    .from('transactions')
    .select('id, base_cost, surcharge, insurance_cost, carrier_name, ship_option_name, fulfillment_center, cost')
    .eq('client_id', hensonId)
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .in('invoice_id_sb', invoiceIds)
    .limit(10);
  
  console.log('\nHenson shipments sample (real ID):');
  for (const s of shipments || []) {
    console.log({
      base_cost: s.base_cost,
      surcharge: s.surcharge,
      insurance_cost: s.insurance_cost,
      carrier: s.carrier_name,
      ship_option: s.ship_option_name,
      fc: s.fulfillment_center,
      cost: s.cost
    });
  }
  
  // Check how many have nulls in key fields
  const { count: total } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonId)
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .in('invoice_id_sb', invoiceIds);
  
  console.log('\nTotal shipments:', total);
  
  // Check null base_cost
  const { count: nullBase } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonId)
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .in('invoice_id_sb', invoiceIds)
    .is('base_cost', null);
  console.log('Null base_cost:', nullBase);
  
  // Check null carrier
  const { count: nullCarrier } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonId)
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .in('invoice_id_sb', invoiceIds)
    .is('carrier_name', null);
  console.log('Null carrier:', nullCarrier);
  
  // Check null ship_option
  const { count: nullShipOpt } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonId)
    .eq('reference_type', 'Shipment')
    .eq('transaction_fee', 'Shipping')
    .in('invoice_id_sb', invoiceIds)
    .is('ship_option_name', null);
  console.log('Null ship_option:', nullShipOpt);
}

investigate();
