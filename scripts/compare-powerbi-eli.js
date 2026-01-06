const XLSX = require('xlsx');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ELI_CLIENT_ID = 'e6220921-695e-41f9-9f49-af3e0cdc828a';

async function main() {
  // Load PowerBI data
  const workbook = XLSX.readFile('/Users/mattmcleod/Dropbox/gits/dashboard/reference/data - 2026-01-05T100550.070 (1).xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  console.log('PowerBI Excel columns:', Object.keys(data[0] || {}));
  console.log('Total rows in Excel:', data.length);

  // Find charge rows (shipping charges only)
  const chargeRows = data.filter(r => r['Transaction Type'] === 'Charge');
  console.log('\nPowerBI Charge rows:', chargeRows.length);

  // Get all OrderIDs from PowerBI
  const powerbiOrderIds = new Set(chargeRows.map(r => String(r['OrderID'])));
  console.log('Unique OrderIDs in PowerBI:', powerbiOrderIds.size);

  // Calculate PowerBI total
  const powerbiTotal = chargeRows.reduce((sum, r) => sum + (parseFloat(r['Original Invoice']) || 0), 0);
  console.log('PowerBI Total (Original Invoice):', powerbiTotal.toFixed(2));

  // Get all shipping transactions from our DB for Eli Health (paginated)
  const dbTx = [];
  let lastTxId = null;
  const PAGE_SIZE = 1000;

  // Get invoice date range from PowerBI data
  const invoiceDates = chargeRows.map(r => r['Invoice Date']).filter(Boolean);
  console.log('\nPowerBI Invoice Dates sample:', invoiceDates.slice(0, 5));

  while (true) {
    let query = supabase
      .from('transactions')
      .select('transaction_id, reference_id, charge_date, cost, tracking_id, transaction_type, invoice_id_sb')
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

  console.log('\nDB transactions (Eli Health Shipping, Dec 29 - Jan 4):', dbTx.length);

  const dbRefIds = new Set(dbTx.map(t => t.reference_id));
  console.log('Unique reference_ids (shipment_ids) in DB:', dbRefIds.size);

  // Calculate DB total
  const dbTotal = dbTx.reduce((sum, t) => sum + (parseFloat(t.cost) || 0), 0);
  console.log('DB Total (cost):', dbTotal.toFixed(2));

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

  // Now check orphaned tracking for the transactions in DB not in PowerBI
  if (inDbNotPowerBI.length > 0) {
    console.log('\n=== Checking orphaned tracking for extra transactions ===');
    for (const tx of inDbNotPowerBI) {
      const { data: shipment } = await supabase
        .from('shipments')
        .select('shipment_id, tracking_id, status')
        .eq('shipment_id', tx.reference_id)
        .single();

      if (shipment) {
        const trackingMatch = tx.tracking_id === shipment.tracking_id;
        console.log(`\nShipment ${tx.reference_id}:`);
        console.log(`  TX tracking: ${tx.tracking_id}`);
        console.log(`  Shipment tracking: ${shipment.tracking_id}`);
        console.log(`  Status: ${shipment.status}`);
        console.log(`  Tracking match: ${trackingMatch ? 'YES' : 'NO - ORPHANED!'}`);
      } else {
        console.log(`\nShipment ${tx.reference_id}: NOT FOUND IN SHIPMENTS TABLE`);
      }
    }
  }
}

main().catch(console.error);
