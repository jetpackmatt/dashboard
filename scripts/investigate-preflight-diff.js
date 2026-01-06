const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigate() {
  // Get current week's SB invoices (unprocessed)
  const { data: invoices } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_type, total_due')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment');

  console.log('Unprocessed SB Invoices:', invoices);

  const invoiceIds = invoices.map(i => parseInt(i.shipbob_invoice_id));
  console.log('Invoice IDs:', invoiceIds);

  // Get ALL shipping transactions on these invoices
  const { data: shippingTx } = await supabase
    .from('transactions')
    .select('client_id, total_charge, fee_type, reference_id')
    .in('invoice_id_sb', invoiceIds)
    .eq('fee_type', 'Shipping');

  const shippingTotal = shippingTx?.reduce((sum, tx) => sum + (tx.total_charge || 0), 0) || 0;
  console.log('\nShipping transactions count:', shippingTx?.length);
  console.log('Shipping total from DB:', shippingTotal.toFixed(2));
  console.log('Expected from SB:', 13261.35);
  console.log('Preflight showing:', 13241.02);
  console.log('Difference:', (13261.35 - shippingTotal).toFixed(2));

  // Check for null client_id in shipping
  const nullClientShipping = shippingTx?.filter(tx => tx.client_id === null);
  console.log('\nShipping with null client_id:', nullClientShipping?.length);
  if (nullClientShipping?.length > 0) {
    const nullTotal = nullClientShipping.reduce((sum, tx) => sum + (tx.total_charge || 0), 0);
    console.log('Null client shipping total:', nullTotal.toFixed(2));
  }

  // Get ALL additional services on these invoices
  const { data: addlSvcTx } = await supabase
    .from('transactions')
    .select('client_id, total_charge, fee_type')
    .in('invoice_id_sb', invoiceIds)
    .neq('fee_type', 'Shipping')
    .neq('fee_type', 'Storage Fee')
    .neq('fee_type', 'Return Processing')
    .neq('fee_type', 'Receiving')
    .not('fee_type', 'ilike', '%credit%');

  const addlTotal = addlSvcTx?.reduce((sum, tx) => sum + (tx.total_charge || 0), 0) || 0;
  console.log('\n--- Additional Services ---');
  console.log('Addl Svc transactions count:', addlSvcTx?.length);
  console.log('Addl Svc total from DB:', addlTotal.toFixed(2));
  console.log('Expected from SB:', 887.74);
  console.log('Preflight showing:', 874.33);
  console.log('Difference:', (887.74 - addlTotal).toFixed(2));

  // Check for null client_id
  const nullClientAddl = addlSvcTx?.filter(tx => tx.client_id === null);
  console.log('\nAddl Svc with null client_id:', nullClientAddl?.length);
  if (nullClientAddl?.length > 0) {
    const nullTotal = nullClientAddl.reduce((sum, tx) => sum + (tx.total_charge || 0), 0);
    console.log('Null client addl svc total:', nullTotal.toFixed(2));
    // Show fee types
    const feeTypes = {};
    nullClientAddl.forEach(tx => {
      feeTypes[tx.fee_type] = (feeTypes[tx.fee_type] || 0) + (tx.total_charge || 0);
    });
    console.log('Null client addl svc by fee_type:', feeTypes);
  }

  // Show fee type breakdown for ALL addl svc
  console.log('\n--- Addl Svc Fee Type Breakdown (ALL) ---');
  const feeTypeBreakdown = {};
  addlSvcTx?.forEach(tx => {
    const key = tx.fee_type;
    if (!feeTypeBreakdown[key]) {
      feeTypeBreakdown[key] = { count: 0, total: 0, nullClient: 0, nullTotal: 0 };
    }
    feeTypeBreakdown[key].count++;
    feeTypeBreakdown[key].total += tx.total_charge || 0;
    if (tx.client_id === null) {
      feeTypeBreakdown[key].nullClient++;
      feeTypeBreakdown[key].nullTotal += tx.total_charge || 0;
    }
  });

  Object.entries(feeTypeBreakdown)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([feeType, data]) => {
      console.log(`  ${feeType}: ${data.count} tx, $${data.total.toFixed(2)} (${data.nullClient} null = $${data.nullTotal.toFixed(2)})`);
    });
}

investigate().catch(console.error);
