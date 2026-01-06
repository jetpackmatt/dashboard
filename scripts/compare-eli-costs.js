const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ELI_CLIENT_ID = 'e6220921-695e-41f9-9f49-af3e0cdc828a';

// Orphaned transactions to exclude
const orphanedTxIds = new Set([
  '01KDRKEGAGS9KGPWAZGE2B726G',
  '01KDRKETK5TQW9RMVTJFYF6C25',
  '01KDNW53SVE0Q7PYV9SZA5NES0',
  '01KDR7K0M6BJRX7ZT9DYB42ZX3',
  '01KDR4V0V3GY268T20S8V10WK3',
]);

async function main() {
  // Load PowerBI data
  const workbook = XLSX.readFile('/Users/mattmcleod/Dropbox/gits/dashboard/reference/data - 2026-01-05T100550.070 (1).xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  const chargeRows = data.filter(r => r['Transaction Type'] === 'Charge');

  // Build PowerBI lookup by OrderID
  const pbiByOrderId = new Map();
  chargeRows.forEach(r => {
    const orderId = String(r['OrderID']);
    if (!pbiByOrderId.has(orderId)) {
      pbiByOrderId.set(orderId, []);
    }
    pbiByOrderId.set(orderId, [...pbiByOrderId.get(orderId), r]);
  });

  // Get all shipping transactions from our DB for Eli Health (paginated)
  const dbTx = [];
  let lastTxId = null;
  const PAGE_SIZE = 1000;

  while (true) {
    let query = supabase
      .from('transactions')
      .select('transaction_id, reference_id, charge_date, cost, tracking_id, transaction_type')
      .eq('client_id', ELI_CLIENT_ID)
      .eq('fee_type', 'Shipping')
      .gte('charge_date', '2025-12-29')
      .lte('charge_date', '2026-01-04')
      .order('transaction_id', { ascending: true })
      .limit(PAGE_SIZE);

    if (lastTxId) {
      query = query.gt('transaction_id', lastTxId);
    }

    const { data: page, error } = await query;
    if (error) {
      console.error('DB Error:', error);
      return;
    }
    if (!page || page.length === 0) break;

    dbTx.push(...page);
    lastTxId = page[page.length - 1].transaction_id;

    if (page.length < PAGE_SIZE) break;
  }

  // Filter out orphaned transactions
  const validDbTx = dbTx.filter(t => !orphanedTxIds.has(t.transaction_id));
  console.log('Valid DB transactions (excluding orphaned):', validDbTx.length);

  // Compare per-shipment costs
  let costMismatches = [];
  let dbOnlyCost = 0;
  let pbiOnlyCost = 0;

  // Check DB transactions against PowerBI
  for (const tx of validDbTx) {
    const pbiRows = pbiByOrderId.get(tx.reference_id) || [];
    if (pbiRows.length === 0) {
      console.log(`DB only: Shipment ${tx.reference_id} | $${tx.cost} | tracking: ${tx.tracking_id}`);
      dbOnlyCost += parseFloat(tx.cost);
    }
  }

  // Check PowerBI against DB
  const dbByShipmentId = new Map();
  validDbTx.forEach(t => {
    if (!dbByShipmentId.has(t.reference_id)) {
      dbByShipmentId.set(t.reference_id, []);
    }
    dbByShipmentId.set(t.reference_id, [...dbByShipmentId.get(t.reference_id), t]);
  });

  for (const [orderId, pbiRows] of pbiByOrderId) {
    const dbRows = dbByShipmentId.get(orderId) || [];
    if (dbRows.length === 0) {
      console.log(`PBI only: OrderID ${orderId} | $${pbiRows[0]['Original Invoice']} | tracking: ${pbiRows[0]['TrackingId']}`);
      pbiOnlyCost += parseFloat(pbiRows[0]['Original Invoice']);
    }
  }

  // Compare totals per shipment
  console.log('\n=== Per-shipment cost comparison ===');
  for (const [orderId, pbiRows] of pbiByOrderId) {
    const dbRows = dbByShipmentId.get(orderId) || [];
    if (dbRows.length === 0) continue;

    const pbiTotal = pbiRows.reduce((s, r) => s + parseFloat(r['Original Invoice']), 0);
    const dbTotal = dbRows.reduce((s, t) => s + parseFloat(t.cost), 0);

    if (Math.abs(pbiTotal - dbTotal) > 0.01) {
      console.log(`Shipment ${orderId}: DB $${dbTotal.toFixed(2)} vs PBI $${pbiTotal.toFixed(2)} (diff: $${(dbTotal - pbiTotal).toFixed(2)})`);
      console.log('  DB transactions:');
      dbRows.forEach(t => console.log(`    ${t.transaction_id} | $${t.cost} | ${t.transaction_type} | ${t.tracking_id}`));
      console.log('  PBI rows:');
      pbiRows.forEach(r => console.log(`    $${r['Original Invoice']} | ${r['TrackingId']}`));
      costMismatches.push({ orderId, dbTotal, pbiTotal, diff: dbTotal - pbiTotal });
    }
  }

  // Calculate final totals
  const validDbTotal = validDbTx.reduce((s, t) => s + parseFloat(t.cost), 0);
  const pbiTotal = chargeRows.reduce((s, r) => s + parseFloat(r['Original Invoice']), 0);

  console.log('\n=== Final Totals ===');
  console.log('Valid DB Total:', validDbTotal.toFixed(2));
  console.log('PowerBI Total:', pbiTotal.toFixed(2));
  console.log('Difference:', (validDbTotal - pbiTotal).toFixed(2));

  if (costMismatches.length > 0) {
    console.log('\nCost mismatches found:', costMismatches.length);
    const totalDiff = costMismatches.reduce((s, m) => s + m.diff, 0);
    console.log('Total mismatch amount:', totalDiff.toFixed(2));
  }
}

main().catch(console.error);
