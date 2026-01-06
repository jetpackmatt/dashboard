const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigate() {
  // Henson client_id
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad';

  // Hardcode the invoice ID from preflight screenshot (Dec 8-14 week)
  const invoiceId = 8693044;
  console.log('Invoice ID:', invoiceId);

  // Count Shipping transactions for Henson on this invoice
  const { count: shippingCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonId)
    .eq('invoice_id_sb', invoiceId)
    .eq('fee_type', 'Shipping');

  console.log('Shipping fee_type transactions:', shippingCount);

  // Count by reference_type = Shipment
  const { count: shipmentRefCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonId)
    .eq('invoice_id_sb', invoiceId)
    .eq('reference_type', 'Shipment');

  console.log('reference_type=Shipment transactions:', shipmentRefCount);

  // Fetch all Shipping transactions
  let allTx = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('transaction_id, reference_id, fee_type')
      .eq('client_id', hensonId)
      .eq('invoice_id_sb', invoiceId)
      .eq('fee_type', 'Shipping')
      .range(offset, offset + limit - 1);

    if (error || !data || data.length === 0) break;
    allTx = allTx.concat(data);
    if (data.length < limit) break;
    offset += limit;
  }

  const txIds = allTx.map(t => t.transaction_id);
  const uniqueTxIds = new Set(txIds);
  console.log('\nTotal Shipping transactions fetched:', txIds.length);
  console.log('Unique transaction_ids:', uniqueTxIds.size);

  if (txIds.length !== uniqueTxIds.size) {
    console.log('DUPLICATE TRANSACTION IDS FOUND!');
  }

  // Check for duplicate reference_ids (same shipment billed twice?)
  const refIds = allTx.map(t => t.reference_id);
  const uniqueRefIds = new Set(refIds);
  console.log('\nUnique shipment reference_ids:', uniqueRefIds.size);

  if (refIds.length !== uniqueRefIds.size) {
    console.log('Multiple transactions per shipment found!');

    // Find duplicates
    const refCounts = {};
    refIds.forEach(id => { refCounts[id] = (refCounts[id] || 0) + 1; });
    const dupes = Object.entries(refCounts).filter(([k, v]) => v > 1);
    console.log('Shipments with multiple Shipping transactions:', dupes.length);
    console.log('Extra transactions (dupes cause):', dupes.reduce((sum, [k, v]) => sum + v - 1, 0));
    console.log('Sample duplicates (shipment_id: count):', dupes.slice(0, 10));
  }

  // Also check: are there transactions missing base_cost?
  const { count: missingBaseCost } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', hensonId)
    .eq('invoice_id_sb', invoiceId)
    .eq('fee_type', 'Shipping')
    .is('base_cost', null);

  console.log('\n=== SFTP base_cost check ===');
  console.log('Shipping transactions missing base_cost:', missingBaseCost);

  // Get sample of missing base_cost
  const { data: sampleMissing } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, cost, charge_date, tracking_id')
    .eq('client_id', hensonId)
    .eq('invoice_id_sb', invoiceId)
    .eq('fee_type', 'Shipping')
    .is('base_cost', null)
    .limit(5);

  console.log('Sample missing base_cost:');
  console.table(sampleMissing);
}

investigate().catch(console.error);
