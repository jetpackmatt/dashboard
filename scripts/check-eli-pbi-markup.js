const XLSX = require('xlsx');
require('dotenv').config({ path: '.env.local' });

async function main() {
  // Load PowerBI data
  const workbook = XLSX.readFile('/Users/mattmcleod/Dropbox/gits/dashboard/reference/data - 2026-01-05T100550.070 (1).xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  console.log('PowerBI columns:', Object.keys(data[0] || {}));

  const chargeRows = data.filter(r => r['Transaction Type'] === 'Charge');

  // Sum different columns
  const originalInvoice = chargeRows.reduce((sum, r) => sum + (parseFloat(r['Original Invoice']) || 0), 0);

  // Check what other columns exist that might contain marked-up values
  console.log('\nSample row:');
  console.log(JSON.stringify(chargeRows[0], null, 2));

  console.log('\n=== PowerBI Totals ===');
  console.log('Original Invoice total:', originalInvoice.toFixed(2));
  console.log('Row count:', chargeRows.length);

  // Maybe there's a "Fulfillment without Surcharge" column?
  const fulfillmentWithoutSurcharge = chargeRows.reduce((sum, r) => sum + (parseFloat(r['Fulfillment without Surcharge']) || 0), 0);
  const surchargeApplied = chargeRows.reduce((sum, r) => sum + (parseFloat(r['Surcharge Applied']) || 0), 0);

  console.log('Fulfillment without Surcharge total:', fulfillmentWithoutSurcharge.toFixed(2));
  console.log('Surcharge Applied total:', surchargeApplied.toFixed(2));
  console.log('Sum:', (fulfillmentWithoutSurcharge + surchargeApplied).toFixed(2));
}

main().catch(console.error);
