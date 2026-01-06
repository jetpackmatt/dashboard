const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const mlId = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e';

  // Check Methyl-Life's draft invoice
  const { data: invoice } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, shipbob_invoice_ids, status')
    .eq('client_id', mlId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  console.log('=== METHYL-LIFE INVOICE CHECK ===');
  console.log('Draft invoice:', invoice?.invoice_number);
  console.log('ShipBob invoice IDs:', invoice?.shipbob_invoice_ids);
  console.log('Includes ReturnsFee 8693054?', invoice?.shipbob_invoice_ids?.includes(8693054));

  // Check transactions on ReturnsFee invoice 8693054
  const { data: returnTx } = await supabase
    .from('transactions')
    .select('transaction_id, client_id, reference_id, reference_type, fee_type, cost, invoice_id_sb')
    .eq('invoice_id_sb', 8693054);

  console.log('\n=== TRANSACTIONS ON RETURNSFEE INVOICE 8693054 ===');
  returnTx?.forEach(tx => {
    const clientMatch = tx.client_id === mlId ? 'ML ✓' : (tx.client_id ? 'OTHER' : 'NULL');
    console.log(`  ${tx.transaction_id}: ref=${tx.reference_id}, type=${tx.reference_type}, fee=${tx.fee_type}, cost=${tx.cost}, client=${clientMatch}`);
  });

  // Count by client
  const mlCount = returnTx?.filter(tx => tx.client_id === mlId).length || 0;
  const nullCount = returnTx?.filter(tx => tx.client_id === null).length || 0;
  const otherCount = (returnTx?.length || 0) - mlCount - nullCount;
  console.log(`\nClient attribution: ML=${mlCount}, NULL=${nullCount}, OTHER=${otherCount}`);

  // Check what invoice IDs Methyl-Life SHOULD have based on their transactions
  const { data: mlTx } = await supabase
    .from('transactions')
    .select('invoice_id_sb')
    .eq('client_id', mlId)
    .is('invoice_id_jp', null)
    .not('invoice_id_sb', 'is', null);

  const uniqueInvoiceIds = [...new Set(mlTx?.map(tx => tx.invoice_id_sb) || [])].sort((a, b) => a - b);
  console.log('\n=== INVOICE IDS WITH ML TRANSACTIONS (unbilled) ===');
  console.log('Found:', uniqueInvoiceIds);

  if (invoice?.shipbob_invoice_ids) {
    const missing = uniqueInvoiceIds.filter(id => !invoice.shipbob_invoice_ids.includes(id));
    const extra = invoice.shipbob_invoice_ids.filter(id => !uniqueInvoiceIds.includes(id));
    console.log('Missing from invoice:', missing);
    console.log('Extra in invoice:', extra);
  }
}

check().catch(console.error);
