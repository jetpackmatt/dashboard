const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fix() {
  const mlId = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e';

  // Get the draft invoice
  const { data: invoice } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, shipbob_invoice_ids')
    .eq('client_id', mlId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!invoice) {
    console.log('No draft invoice found');
    return;
  }

  console.log('Current IDs:', invoice.shipbob_invoice_ids);

  // Add the ReturnsFee invoice ID
  const newIds = [...(invoice.shipbob_invoice_ids || [])];
  if (!newIds.includes(8693054)) {
    newIds.push(8693054);
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
    console.log('8693054 already included');
  }
}

fix().catch(console.error);
