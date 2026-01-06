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

  const chargeRows = data.filter(r => r['Transaction Type'] === 'Charge');

  // PowerBI total
  const pbiTotal = chargeRows.reduce((sum, r) => sum + (parseFloat(r['Original Invoice']) || 0), 0);
  console.log('PowerBI Total (Original Invoice):', pbiTotal.toFixed(2));
  console.log('PowerBI row count:', chargeRows.length);

  // Get all shipping transactions from our DB (paginated)
  const dbTx = [];
  let lastTxId = null;
  const PAGE_SIZE = 1000;

  while (true) {
    let query = supabase
      .from('transactions')
      .select('transaction_id, reference_id, charge_date, cost, base_cost, surcharge, taxes, tracking_id')
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

  console.log('\nDB row count:', dbTx.length);

  // Sum base_cost and cost
  const dbBaseCostTotal = dbTx.reduce((sum, t) => sum + (parseFloat(t.base_cost) || 0), 0);
  const dbCostTotal = dbTx.reduce((sum, t) => sum + (parseFloat(t.cost) || 0), 0);
  const dbSurchargeTotal = dbTx.reduce((sum, t) => sum + (parseFloat(t.surcharge) || 0), 0);

  console.log('DB sum(base_cost):', dbBaseCostTotal.toFixed(2));
  console.log('DB sum(surcharge):', dbSurchargeTotal.toFixed(2));
  console.log('DB sum(cost):', dbCostTotal.toFixed(2));

  // Compare per-shipment
  console.log('\n=== Per-shipment base_cost comparison ===');

  // Build PowerBI lookup
  const pbiByOrderId = new Map();
  chargeRows.forEach(r => {
    pbiByOrderId.set(String(r['OrderID']), parseFloat(r['Original Invoice']) || 0);
  });

  // Build DB lookup
  const dbByShipmentId = new Map();
  dbTx.forEach(t => {
    dbByShipmentId.set(t.reference_id, {
      base_cost: parseFloat(t.base_cost) || 0,
      cost: parseFloat(t.cost) || 0,
      surcharge: parseFloat(t.surcharge) || 0,
    });
  });

  // Find mismatches between base_cost and PowerBI
  let mismatchCount = 0;
  let totalDiff = 0;

  for (const [shipmentId, pbiAmount] of pbiByOrderId) {
    const dbData = dbByShipmentId.get(shipmentId);
    if (!dbData) continue;

    const diff = dbData.base_cost - pbiAmount;
    if (Math.abs(diff) > 0.01) {
      mismatchCount++;
      totalDiff += diff;
      if (mismatchCount <= 10) {
        console.log(`Shipment ${shipmentId}: DB base_cost $${dbData.base_cost.toFixed(2)} vs PBI $${pbiAmount.toFixed(2)} (diff: $${diff.toFixed(2)})`);
      }
    }
  }

  console.log(`\nTotal mismatches: ${mismatchCount}`);
  console.log(`Total difference: $${totalDiff.toFixed(2)}`);

  // Summary
  console.log('\n=== Summary ===');
  console.log('PowerBI Total:', pbiTotal.toFixed(2));
  console.log('DB base_cost Total:', dbBaseCostTotal.toFixed(2));
  console.log('Difference (DB - PBI):', (dbBaseCostTotal - pbiTotal).toFixed(2));
}

main().catch(console.error);
