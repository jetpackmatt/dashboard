const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad';

  // Check ALL credits on this week's invoices (Dec 8-14)
  const { data: credits, count } = await supabase
    .from('transactions')
    .select('transaction_id, fee_type, reference_type, reference_id, cost, client_id, invoice_id_sb, additional_details', { count: 'exact' })
    .in('invoice_id_sb', [8693044, 8693047, 8693051, 8693054, 8693056])
    .or('fee_type.ilike.%credit%,reference_type.in.(TicketNumber,Default)')
    .order('cost');

  console.log('Total credit-like transactions this week:', count);
  console.log('\nSample credits (with additional_details):');
  for (const c of credits?.slice(0, 5) || []) {
    console.log(`  ${c.transaction_id}: ${c.fee_type} | ref_type=${c.reference_type} | ref_id=${c.reference_id} | cost=${c.cost}`);
    console.log(`    additional_details:`, JSON.stringify(c.additional_details, null, 2));
  }

  // How many have NULL client_id?
  const withoutClient = credits?.filter(c => c.client_id === null).length || 0;
  const withClient = credits?.filter(c => c.client_id !== null).length || 0;
  console.log('\nWith client_id:', withClient);
  console.log('Without client_id:', withoutClient);

  // How many are Henson?
  const henson = credits?.filter(c => c.client_id === hensonId);
  console.log('\nHenson credits:', henson?.length || 0);
  if (henson && henson.length > 0) {
    console.log('Henson credits total:', henson.reduce((sum, c) => sum + (c.cost || 0), 0));
    console.table(henson);
  }

  // Check which invoice types Henson's credits are on
  const invoiceBreakdown = {};
  for (const c of credits || []) {
    if (!invoiceBreakdown[c.invoice_id_sb]) invoiceBreakdown[c.invoice_id_sb] = { total: 0, withClient: 0, henson: 0 };
    invoiceBreakdown[c.invoice_id_sb].total++;
    if (c.client_id) invoiceBreakdown[c.invoice_id_sb].withClient++;
    if (c.client_id === hensonId) invoiceBreakdown[c.invoice_id_sb].henson++;
  }
  console.log('\nCredits by invoice:');
  console.table(invoiceBreakdown);
}

check().catch(console.error);
