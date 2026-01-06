const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function debug() {
  // 1. Get a sample transaction with reference_type = Shipment
  const { data: txSample } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, reference_type, client_id, invoice_id_sb')
    .eq('reference_type', 'Shipment')
    .eq('invoice_id_sb', 8693044)
    .limit(3);

  console.log('Sample transactions:');
  console.table(txSample);

  if (!txSample || txSample.length === 0) {
    console.log('No transactions found');
    return;
  }

  // 2. Check if those reference_ids exist in shipments table
  const refIds = txSample.map(t => t.reference_id);
  console.log('\nLooking up reference_ids in shipments:', refIds);

  const { data: shipments } = await supabase
    .from('shipments')
    .select('shipment_id, client_id')
    .in('shipment_id', refIds);

  console.log('\nMatched shipments:');
  console.table(shipments);

  // 3. Check type comparison
  console.log('\n=== TYPE ANALYSIS ===');
  if (txSample[0]) {
    console.log('Transaction reference_id type:', typeof txSample[0].reference_id);
    console.log('Transaction reference_id value:', txSample[0].reference_id);
  }
  if (shipments && shipments[0]) {
    console.log('Shipment shipment_id type:', typeof shipments[0].shipment_id);
    console.log('Shipment shipment_id value:', shipments[0].shipment_id);

    // Test JS object lookup simulation
    const lookup = {};
    shipments.forEach(s => {
      lookup[s.shipment_id] = s.client_id;
    });

    console.log('\n=== LOOKUP TEST ===');
    console.log('Lookup keys:', Object.keys(lookup));
    console.log('Testing lookup with tx.reference_id:', txSample[0].reference_id);
    console.log('Lookup result:', lookup[txSample[0].reference_id]);
    console.log('Lookup result (string coerced):', lookup[String(txSample[0].reference_id)]);
  }

  // 4. Count how many Shipment transactions have matching shipments
  const { count: txCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('reference_type', 'Shipment')
    .in('invoice_id_sb', [8693044, 8693047, 8693051, 8693054, 8693056]);

  console.log('\n=== MATCHING TEST ===');
  console.log('Total Shipment-type transactions on new invoices:', txCount);

  // 5. How many of those have client_id?
  const { count: withClientId } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('reference_type', 'Shipment')
    .in('invoice_id_sb', [8693044, 8693047, 8693051, 8693054, 8693056])
    .not('client_id', 'is', null);

  console.log('With client_id:', withClientId);
  console.log('Without client_id:', txCount - withClientId);

  // 6. Do a direct join to see if the data SHOULD match
  // First get 10 unattributed transactions
  const { data: unattributed } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id')
    .eq('reference_type', 'Shipment')
    .in('invoice_id_sb', [8693044, 8693047, 8693051, 8693054, 8693056])
    .is('client_id', null)
    .limit(10);

  if (unattributed && unattributed.length > 0) {
    const unattRefIds = unattributed.map(t => t.reference_id);
    console.log('\nUnattributed transaction reference_ids:', unattRefIds);

    // Look up those in shipments
    const { data: matchingShipments } = await supabase
      .from('shipments')
      .select('shipment_id, client_id')
      .in('shipment_id', unattRefIds);

    console.log('Matching shipments with client_id:');
    console.table(matchingShipments);

    if (!matchingShipments || matchingShipments.length === 0) {
      console.log('\n>>> FOUND THE BUG! Shipments do NOT exist in database for these reference_ids <<<');

      // Check if these might be from a different client we don't have
      console.log('\nChecking if shipments exist at ALL...');
      const { count: totalShipments } = await supabase
        .from('shipments')
        .select('*', { count: 'exact', head: true });
      console.log('Total shipments in database:', totalShipments);
    } else {
      console.log('\n>>> Shipments exist and have client_id - WHY is attribution failing? <<<');
    }
  }
}

debug().catch(console.error);
