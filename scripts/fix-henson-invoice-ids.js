const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fix() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad';

  // Get the draft invoice
  const { data: invoice } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, shipbob_invoice_ids')
    .eq('client_id', hensonId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!invoice) {
    console.log('No draft invoice found');
    return;
  }

  console.log('Current IDs:', invoice.shipbob_invoice_ids);

  // Add the Credits invoice ID if missing
  const newIds = [...(invoice.shipbob_invoice_ids || [])];
  if (!newIds.includes(8693056)) {
    newIds.push(8693056);
    newIds.sort((a, b) => a - b);

    const { error } = await supabase
      .from('invoices_jetpack')
      .update({ shipbob_invoice_ids: newIds })
      .eq('id', invoice.id);

    if (error) {
      console.error('Error updating:', error);
    } else {
      console.log('Updated to:', newIds);
      console.log('Now regenerate the invoice in the UI!');
    }
  } else {
    console.log('8693056 already included');
  }
}
fix().catch(console.error);
