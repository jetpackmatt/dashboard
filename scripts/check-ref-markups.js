/**
 * Check implied markup percentages from reference XLSX
 */
const xlsx = require('xlsx')
const wb = xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPML-0021-120125.xlsx')
const ws = wb.Sheets['Shipments']
const data = xlsx.utils.sheet_to_json(ws)

// Sample first 5 rows to understand the data
console.log('Sample rows:')
for (let i = 0; i < 5; i++) {
  const row = data[i]
  console.log(`\nRow ${i + 1} (OrderID: ${row['OrderID']}):`)
  console.log(`  Fulfillment without Surcharge: ${row['Fulfillment without Surcharge']}`)
  console.log(`  Surcharge Applied: ${row['Surcharge Applied']}`)
  console.log(`  Original Invoice: ${row['Original Invoice']}`)
}

// For one of the discrepant shipments, let's understand the relationship
const discrepant = data.find(r => String(r['OrderID']) === '320288844')
if (discrepant) {
  console.log('\n\nDiscrepant shipment 320288844:')
  console.log(`  Fulfillment without Surcharge: $${discrepant['Fulfillment without Surcharge']}`)
  console.log(`  Surcharge Applied: $${discrepant['Surcharge Applied']}`)
  console.log(`  Original Invoice: $${discrepant['Original Invoice']}`)

  // Our DB shows base_cost = 15.22, cost = 17.22
  // So ShipBob cost = 17.22 (base 15.22 + surcharge 2.00)
  // Reference Original Invoice = 23.31 (close to fulfillment 21.31 + surcharge 2.00)
  // So Original Invoice = total billed to client (after markup)

  // The calculation should be:
  // markup = (fulfillment / base_cost) - 1
  // We need to find base_cost from the data

  const fulfillment = parseFloat(discrepant['Fulfillment without Surcharge'])
  const surcharge = parseFloat(discrepant['Surcharge Applied'])
  const originalInvoice = parseFloat(discrepant['Original Invoice'])

  // If original = fulfillment + surcharge, then:
  console.log(`  fulfillment + surcharge = ${(fulfillment + surcharge).toFixed(2)}`)
  console.log(`  This equals Original Invoice: ${originalInvoice.toFixed(2)}`)

  // We know from DB: base_cost = $15.22
  // Reference fulfillment = $21.31
  // Implied markup = 21.31 / 15.22 - 1 = 0.40 = 40%
  const dbBaseCost = 15.22
  const impliedMarkup = (fulfillment / dbBaseCost - 1) * 100
  console.log(`\n  Using DB base_cost of $${dbBaseCost}:`)
  console.log(`  Implied markup = (${fulfillment} / ${dbBaseCost}) - 1 = ${impliedMarkup.toFixed(2)}%`)
}
