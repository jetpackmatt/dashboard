const xlsx = require('xlsx');
const wb = xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPML-0021-120125.xlsx');
console.log('Sheets:', wb.SheetNames);

// Check Additional Services tab
for (const sheetName of wb.SheetNames) {
  const ws = wb.Sheets[sheetName];
  const data = xlsx.utils.sheet_to_json(ws);
  console.log(`\n=== ${sheetName} ===`);
  console.log('Row count:', data.length);

  if (data.length > 0) {
    console.log('Columns:', Object.keys(data[0]));

    // Sum billed amounts - different column names per sheet
    let total = 0;
    const byType = {};
    for (const row of data) {
      // Shipments: Fulfillment without Surcharge + Surcharge Applied + Insurance Amount
      // Additional Services: Invoice Amount
      // Storage: Invoice
      const fulfillment = parseFloat(row['Fulfillment without Surcharge'] || 0);
      const surcharge = parseFloat(row['Surcharge Applied'] || 0);
      const insurance = parseFloat(row['Insurance Amount'] || 0);
      const invoiceAmt = parseFloat(row['Invoice Amount'] || 0);
      const invoice = parseFloat(row['Invoice'] || 0);
      const amt = fulfillment + surcharge + insurance + invoiceAmt + invoice;
      total += amt;

      // Group by type for additional services
      const feeType = row['Fee Type'] || row['Type'] || 'N/A';
      if (!byType[feeType]) byType[feeType] = { count: 0, total: 0 };
      byType[feeType].count++;
      byType[feeType].total += amt;
    }
    console.log('Total Billed:', total.toFixed(2));
    if (Object.keys(byType).length > 1 || Object.keys(byType)[0] !== 'N/A') {
      console.log('By Type:');
      for (const [type, stats] of Object.entries(byType)) {
        console.log(`  ${type}: ${stats.count} rows, $${stats.total.toFixed(2)}`);
      }
    }
  }
}
