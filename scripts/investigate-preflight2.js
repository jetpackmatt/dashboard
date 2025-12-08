const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigate() {
  const invoiceIds = [8633634, 8633637, 8633641, 8633632, 8633612, 8633618];
  
  // Check what transactions exist for ANY client with these invoice IDs
  const { data: allTx, count: totalTx } = await supabase
    .from('transactions')
    .select('client_id, reference_type, transaction_fee', { count: 'exact' })
    .in('invoice_id_sb', invoiceIds)
    .limit(20);
  
  console.log('Transactions with these invoice IDs:', totalTx);
  console.log('Sample:', allTx);
  
  // Check if those invoice IDs even exist in the invoices_sb table
  const { data: invoices } = await supabase
    .from('invoices_sb')
    .select('*')
    .in('shipbob_invoice_id', invoiceIds.map(String));
  
  console.log('\nShipBob invoices:');
  for (const inv of invoices || []) {
    console.log('  ID:', inv.shipbob_invoice_id, 'Type:', inv.invoice_type, 'Client:', inv.client_id);
  }
  
  // Check Henson's recent transactions (regardless of invoice_id_sb)
  const hensonClientId = '4f9ed195-aa83-4b14-8725-181b00a8dcbc';
  const { count: hensonTotal } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonClientId);
  
  console.log('\nTotal Henson transactions in DB:', hensonTotal);
  
  // Check what invoice_id_sb values Henson has
  const { data: hensonInvoices } = await supabase
    .from('transactions')
    .select('invoice_id_sb')
    .eq('client_id', hensonClientId)
    .not('invoice_id_sb', 'is', null)
    .limit(1000);
  
  const uniqueInvoiceIds = [...new Set(hensonInvoices?.map(t => t.invoice_id_sb) || [])];
  console.log('Henson unique invoice_id_sb values:', uniqueInvoiceIds.slice(0, 20));
  
  // Check if those specific IDs are in the list
  const found = invoiceIds.filter(id => uniqueInvoiceIds.includes(id));
  console.log('Invoice IDs found in Henson data:', found);
}

investigate();
