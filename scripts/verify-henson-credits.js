const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad';

  // Check Henson credits on this week's invoices (Dec 8-14)
  const { data: credits, count } = await supabase
    .from('transactions')
    .select('transaction_id, fee_type, reference_type, reference_id, cost, invoice_id_sb', { count: 'exact' })
    .eq('client_id', hensonId)
    .in('invoice_id_sb', [8693044, 8693047, 8693051, 8693054, 8693056])
    .eq('fee_type', 'Credit');

  console.log('Henson credits this week:', count);
  console.log('Total credit amount:', credits?.reduce((sum, c) => sum + (c.cost || 0), 0).toFixed(2));
  console.log('\nCredits by invoice:');
  const byInvoice = {};
  for (const c of credits || []) {
    const inv = c.invoice_id_sb;
    if (!byInvoice[inv]) byInvoice[inv] = { count: 0, total: 0 };
    byInvoice[inv].count++;
    byInvoice[inv].total += c.cost || 0;
  }
  console.table(byInvoice);

  console.log('\nIndividual credits:');
  for (const c of credits || []) {
    console.log(`  ${c.transaction_id}: ref=${c.reference_id}, cost=${c.cost}`);
  }
}

check().catch(console.error);
