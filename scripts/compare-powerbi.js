const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function main() {
  // Load PowerBI data
  const workbook = XLSX.readFile('/Users/mattmcleod/Dropbox/gits/dashboard/reference/data - 2026-01-05T100530.568 (1).xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  // Find weird rows
  const weirdRows = data.filter(r => r['Transaction Type'] !== 'Charge' || r['OrderID'] === undefined);
  console.log('Rows with non-Charge Transaction Type or undefined OrderID:');
  weirdRows.forEach(r => console.log(JSON.stringify(r, null, 2)));

  // Get all OrderIDs from PowerBI (shipping charges only)
  const chargeRows = data.filter(r => r['Transaction Type'] === 'Charge');
  const powerbiOrderIds = new Set(chargeRows.map(r => String(r['OrderID'])));
  console.log('\nPowerBI Charge rows:', chargeRows.length);
  console.log('Unique OrderIDs in PowerBI:', powerbiOrderIds.size);

  // Get all shipment reference_ids from our DB for Henson in the period (paginated!)
  const dbTx = [];
  let lastTxId = null;
  const PAGE_SIZE = 1000;

  while (true) {
    let query = supabase
      .from('transactions')
      .select('transaction_id, reference_id, charge_date, cost, tracking_id, transaction_type')
      .eq('client_id', '6b94c274-0446-4167-9d02-b998f8be59ad')
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

  console.log('\nDB transactions:', dbTx.length);

  const dbRefIds = new Set(dbTx.map(t => t.reference_id));
  console.log('Unique reference_ids in DB:', dbRefIds.size);

  // Find what's in DB but not in PowerBI
  const inDbNotPowerBI = dbTx.filter(t => !powerbiOrderIds.has(t.reference_id));
  console.log('\n=== In DB but NOT in PowerBI (' + inDbNotPowerBI.length + ' transactions) ===');
  inDbNotPowerBI.forEach(t => {
    console.log(`  ${t.transaction_id} | shipment ${t.reference_id} | ${t.charge_date} | $${t.cost} | type: ${t.transaction_type} | tracking: ${t.tracking_id}`);
  });

  // Find what's in PowerBI but not in DB
  const inPowerBINotDb = chargeRows.filter(r => !dbRefIds.has(String(r['OrderID'])));
  console.log('\n=== In PowerBI but NOT in DB (' + inPowerBINotDb.length + ' rows) ===');
  inPowerBINotDb.forEach(r => {
    console.log(`  OrderID ${r['OrderID']} | $${r['Original Invoice']} | tracking: ${r['TrackingId']}`);
  });

  // Find shipment_ids with multiple transactions in DB
  const txByShipment = {};
  dbTx.forEach(t => {
    if (!txByShipment[t.reference_id]) {
      txByShipment[t.reference_id] = [];
    }
    txByShipment[t.reference_id].push(t);
  });

  const multiTx = Object.entries(txByShipment).filter(([id, txs]) => txs.length > 1);
  console.log('\n=== Shipments with multiple transactions in DB (' + multiTx.length + ') ===');
  multiTx.forEach(([shipmentId, txs]) => {
    console.log(`\nShipment ${shipmentId} (${txs.length} transactions):`);
    txs.forEach(t => {
      console.log(`  ${t.transaction_id} | ${t.charge_date} | $${t.cost} | type: ${t.transaction_type || 'null'} | tracking: ${t.tracking_id}`);
    });

    // Check what PowerBI has for this shipment
    const pbiRows = chargeRows.filter(r => String(r['OrderID']) === shipmentId);
    console.log(`  PowerBI has ${pbiRows.length} row(s) for this shipment:`);
    pbiRows.forEach(r => {
      console.log(`    Type: ${r['Transaction Type']} | $${r['Original Invoice']} | tracking: ${r['TrackingId']}`);
    });
  });
}

main().catch(console.error);
