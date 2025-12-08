const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigate() {
  // Get client IDs and names
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, short_code')
    .eq('is_active', true);
  
  console.log('Active clients:');
  for (const c of clients || []) {
    console.log(' ', c.short_code, c.company_name, c.id);
  }
  
  // Now check actual transaction counts per client for these invoices
  const invoiceIds = [8633634, 8633637, 8633641, 8633632, 8633612, 8633618];
  
  for (const c of clients || []) {
    const { count } = await supabase
      .from('transactions')
      .select('*', { count: 'exact', head: true })
      .eq('client_id', c.id)
      .in('invoice_id_sb', invoiceIds);
    
    if (count > 0) {
      console.log('\n' + c.company_name + ' transactions:', count);
      
      // Check their shipments specifically
      const { count: shipCount } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', c.id)
        .eq('reference_type', 'Shipment')
        .eq('transaction_fee', 'Shipping')
        .in('invoice_id_sb', invoiceIds);
      
      console.log('  Shipments:', shipCount);
      
      // Check how many have null base_cost
      const { count: nullBaseCost } = await supabase
        .from('transactions')
        .select('*', { count: 'exact', head: true })
        .eq('client_id', c.id)
        .eq('reference_type', 'Shipment')
        .eq('transaction_fee', 'Shipping')
        .in('invoice_id_sb', invoiceIds)
        .is('base_cost', null);
      
      console.log('  Missing base_cost:', nullBaseCost);
      
      // Check sample with fields
      const { data: sample } = await supabase
        .from('transactions')
        .select('id, base_cost, surcharge, cost, carrier_name, ship_option_name')
        .eq('client_id', c.id)
        .eq('reference_type', 'Shipment')
        .eq('transaction_fee', 'Shipping')
        .in('invoice_id_sb', invoiceIds)
        .limit(3);
      
      console.log('  Sample:', sample);
    }
  }
}

investigate();
