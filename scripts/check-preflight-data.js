const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function check() {
  // 1. What SB invoices are unprocessed?
  const { data: invoices, error } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type, invoice_date')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')
    .order('invoice_date', { ascending: false })
    .limit(20);

  if (error) {
    console.log('Error:', error);
    return;
  }

  console.log('Unprocessed SB invoices:');
  console.table(invoices);

  if (!invoices || invoices.length === 0) {
    console.log('No unprocessed invoices found!');

    // Check all invoices_sb
    const { data: allInv } = await supabase
      .from('invoices_sb')
      .select('shipbob_invoice_id, invoice_type, invoice_date, jetpack_invoice_id')
      .order('invoice_date', { ascending: false })
      .limit(10);
    console.log('\nAll recent SB invoices:');
    console.table(allInv);
    return;
  }

  // 2. Get invoice IDs for checking transactions
  const invoiceIds = invoices.map(i => parseInt(i.shipbob_invoice_id));
  console.log('\nInvoice IDs:', invoiceIds);

  // 3. Check transactions for these invoices
  const { data: txCounts } = await supabase
    .from('transactions')
    .select('invoice_id_sb, client_id, fee_type')
    .in('invoice_id_sb', invoiceIds);

  console.log('\nTransactions found:', txCounts?.length || 0);

  if (txCounts && txCounts.length > 0) {
    // Group by invoice
    const byInvoice = {};
    txCounts.forEach(tx => {
      byInvoice[tx.invoice_id_sb] = (byInvoice[tx.invoice_id_sb] || 0) + 1;
    });
    console.log('Transactions by invoice:', byInvoice);

    // Group by fee_type
    const byFeeType = {};
    txCounts.forEach(tx => {
      byFeeType[tx.fee_type] = (byFeeType[tx.fee_type] || 0) + 1;
    });
    console.log('Transactions by fee_type:', byFeeType);
  }

  // 4. Check if transactions exist but WITHOUT invoice_id_sb set
  // Get recent transactions that should be on this week's invoices
  const { data: recentTx } = await supabase
    .from('transactions')
    .select('transaction_id, charge_date, invoice_id_sb, fee_type, client_id')
    .gte('charge_date', '2025-12-08')
    .lte('charge_date', '2025-12-14')
    .limit(20);

  console.log('\nRecent transactions (Dec 8-14 2025):');
  console.table(recentTx);

  // 5. How many total transactions exist for Dec 8-14?
  const { count: totalDec814 } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .gte('charge_date', '2025-12-08')
    .lte('charge_date', '2025-12-14');

  console.log('\nTotal transactions Dec 8-14 2025:', totalDec814);

  // 6. How many have invoice_id_sb set?
  const { count: withInvoice } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .gte('charge_date', '2025-12-08')
    .lte('charge_date', '2025-12-14')
    .not('invoice_id_sb', 'is', null);

  console.log('With invoice_id_sb:', withInvoice);

  // 7. Count transactions linked to the new invoices
  const { count: linkedToNewInvoices } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .in('invoice_id_sb', [8693056, 8693054, 8693051, 8693047, 8693044]);

  console.log('Linked to new invoices (8693044-56):', linkedToNewInvoices);

  // 8. Get a sample of unattributed transactions with their reference_ids
  const { data: sampleTx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, reference_type, client_id')
    .in('invoice_id_sb', [8693044])
    .is('client_id', null)
    .limit(10);

  console.log('\nSample unattributed transactions:');
  console.table(sampleTx);

  // 9. Check if those reference_ids exist in shipments
  if (sampleTx && sampleTx.length > 0) {
    const refIds = sampleTx.filter(t => t.reference_type === 'Shipment').map(t => t.reference_id);
    console.log('\nChecking shipments for reference_ids:', refIds.slice(0, 5));

    const { data: matchedShipments } = await supabase
      .from('shipments')
      .select('shipment_id, client_id')
      .in('shipment_id', refIds.slice(0, 5));

    console.log('Matched shipments:', matchedShipments);
  }
}

check().catch(console.error);
