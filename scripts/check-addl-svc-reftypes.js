const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function investigate() {
  const invoiceIds = [8754813, 8754810, 8754809, 8754808, 8754805];

  // Get fee_type and reference_type breakdown for 'additional services' type fees
  const { data } = await supabase
    .from('transactions')
    .select('fee_type, reference_type, cost, client_id')
    .in('invoice_id_sb', invoiceIds)
    .neq('fee_type', 'Shipping')
    .neq('fee_type', 'Storage Fee')
    .neq('fee_type', 'Return Processing')
    .neq('fee_type', 'Receiving')
    .not('fee_type', 'ilike', '%credit%')
    .limit(1000);

  // Group by fee_type and reference_type
  const breakdown = {};
  (data || []).forEach(tx => {
    const key = `${tx.fee_type} | ${tx.reference_type}`;
    if (!breakdown[key]) {
      breakdown[key] = { count: 0, total: 0, nullClient: 0 };
    }
    breakdown[key].count++;
    breakdown[key].total += tx.cost || 0;
    if (!tx.client_id) breakdown[key].nullClient++;
  });

  console.log('Fee Type | Reference Type breakdown:');
  Object.entries(breakdown)
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([key, data]) => {
      const [feeType, refType] = key.split(' | ');
      console.log(`${feeType} (${refType}): ${data.count} tx, $${data.total.toFixed(2)}${data.nullClient > 0 ? ` [${data.nullClient} null client]` : ''}`);
    });

  // Now calculate what preflight would find vs what we have
  console.log('\n=== PREFLIGHT CALCULATION ===');

  // Preflight only counts reference_type='Shipment' (excluding Shipping/Credit)
  // and reference_type='WRO' with fee_type ILIKE '%Inventory Placement%'

  let preflightAddlTotal = 0;
  let dbAddlTotal = 0;

  (data || []).forEach(tx => {
    dbAddlTotal += tx.cost || 0;

    // Would preflight include this?
    const refType = tx.reference_type;
    const feeType = tx.fee_type;

    const isShipmentRef = refType === 'Shipment';
    const isWroInventoryPlacement = refType === 'WRO' && feeType.toLowerCase().includes('inventory placement');

    if (isShipmentRef || isWroInventoryPlacement) {
      preflightAddlTotal += tx.cost || 0;
    }
  });

  console.log(`DB total (all addl svc): $${dbAddlTotal.toFixed(2)}`);
  console.log(`Preflight would find: $${preflightAddlTotal.toFixed(2)}`);
  console.log(`Missing from preflight: $${(dbAddlTotal - preflightAddlTotal).toFixed(2)}`);

  // Show what's missing
  console.log('\n=== MISSING FROM PREFLIGHT ===');
  Object.entries(breakdown)
    .filter(([key]) => {
      const [feeType, refType] = key.split(' | ');
      const isShipmentRef = refType === 'Shipment';
      const isWroInventoryPlacement = refType === 'WRO' && feeType.toLowerCase().includes('inventory placement');
      return !isShipmentRef && !isWroInventoryPlacement;
    })
    .sort((a, b) => b[1].total - a[1].total)
    .forEach(([key, data]) => {
      console.log(`${key}: ${data.count} tx, $${data.total.toFixed(2)}`);
    });
}

investigate().catch(console.error);
