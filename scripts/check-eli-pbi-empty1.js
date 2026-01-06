const XLSX = require('xlsx');
require('dotenv').config({ path: '.env.local' });

async function main() {
  const workbook = XLSX.readFile('/Users/mattmcleod/Dropbox/gits/dashboard/reference/data - 2026-01-05T100550.070 (1).xlsx');
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const data = XLSX.utils.sheet_to_json(sheet);

  const chargeRows = data.filter(r => r['Transaction Type'] === 'Charge');

  // Sum the __EMPTY_1 column (marked up total)
  const markedUpTotal = chargeRows.reduce((sum, r) => sum + (parseFloat(r['__EMPTY_1']) || 0), 0);
  const markedUpBase = chargeRows.reduce((sum, r) => sum + (parseFloat(r['__EMPTY']) || 0), 0);

  console.log('=== PowerBI Marked Up Columns ===');
  console.log('__EMPTY (marked up base) total:', markedUpBase.toFixed(2));
  console.log('__EMPTY_1 (marked up total) total:', markedUpTotal.toFixed(2));

  // Verify the math
  const fulfillmentWithoutSurcharge = chargeRows.reduce((sum, r) => sum + (parseFloat(r['Fulfillment without Surcharge']) || 0), 0);
  const surchargeApplied = chargeRows.reduce((sum, r) => sum + (parseFloat(r['Surcharge Applied']) || 0), 0);

  console.log('\n=== Verification ===');
  console.log('Fulfillment without Surcharge × 1.35:', (fulfillmentWithoutSurcharge * 1.35).toFixed(2));
  console.log('Marked up base + surcharge:', (markedUpBase + surchargeApplied).toFixed(2));
}

main().catch(console.error);
