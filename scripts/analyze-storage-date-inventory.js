/**
 * Analyze the relationship between ChargeStartdate and Inventory ID in reference file
 */
const XLSX = require('xlsx')
const path = require('path')

function excelDateToString(serial) {
  if (typeof serial !== 'number') return String(serial)
  const date = new Date((serial - 25569) * 86400 * 1000)
  return date.toISOString().split('T')[0]
}

async function main() {
  const refPath = path.join(__dirname, '../reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')
  const workbook = XLSX.readFile(refPath)
  const storageSheet = workbook.Sheets['Storage']
  const data = XLSX.utils.sheet_to_json(storageSheet)

  // Filter out any Total row
  const rows = data.filter(r => r['Merchant Name'] && r['Merchant Name'] !== 'Total')

  console.log('='.repeat(70))
  console.log('STORAGE DATE/INVENTORY ANALYSIS')
  console.log('='.repeat(70))
  console.log('Total rows:', rows.length)

  // Get unique dates
  const uniqueDates = new Set()
  const dateDistribution = {}

  for (const row of rows) {
    const dateStr = excelDateToString(row['ChargeStartdate'])
    uniqueDates.add(dateStr)
    dateDistribution[dateStr] = (dateDistribution[dateStr] || 0) + 1
  }

  console.log('\n--- DATE DISTRIBUTION ---')
  const sortedDates = Object.entries(dateDistribution).sort(([a], [b]) => a.localeCompare(b))
  for (const [date, count] of sortedDates) {
    console.log(`  ${date}: ${count} rows`)
  }
  console.log('Total unique dates:', uniqueDates.size)
  console.log('Date range:', sortedDates[0]?.[0], 'to', sortedDates[sortedDates.length - 1]?.[0])

  // Analyze per-inventory distribution
  console.log('\n--- PER-INVENTORY ANALYSIS ---')
  const inventoryDates = {}

  for (const row of rows) {
    const invId = row['Inventory ID']
    const dateStr = excelDateToString(row['ChargeStartdate'])

    if (!inventoryDates[invId]) {
      inventoryDates[invId] = { dates: new Set(), locationTypes: new Set(), counts: 0 }
    }
    inventoryDates[invId].dates.add(dateStr)
    inventoryDates[invId].locationTypes.add(row['Location Type'])
    inventoryDates[invId].counts++
  }

  console.log('\nSample inventory items (first 10):')
  const invEntries = Object.entries(inventoryDates)
  for (const [invId, info] of invEntries.slice(0, 10)) {
    const dates = [...info.dates].sort()
    console.log(`  ${invId}: ${info.counts} rows, ${info.dates.size} dates, locations: ${[...info.locationTypes].join(',')}`)
    console.log(`    Date range: ${dates[0]} to ${dates[dates.length - 1]}`)
  }

  // Check for items with more rows than dates (multiple location types)
  console.log('\n--- ITEMS WITH MULTIPLE LOCATIONS PER DAY ---')
  const multiLocation = invEntries.filter(([, info]) => info.counts > info.dates.size)
  console.log(`Items with more rows than unique dates: ${multiLocation.length}`)
  for (const [invId, info] of multiLocation.slice(0, 5)) {
    console.log(`  ${invId}: ${info.counts} rows, ${info.dates.size} dates, locations: ${[...info.locationTypes].join(',')}`)
  }

  // Verify: rows = sum of (dates * location_types) per inventory
  console.log('\n--- ROW COUNT VERIFICATION ---')
  let totalExpected = 0
  for (const [, info] of invEntries) {
    // Each inventory item should have (dates × locations) rows
    totalExpected += info.dates.size * info.locationTypes.size
  }
  console.log('Expected rows (dates × locations):', totalExpected)
  console.log('Actual rows:', rows.length)
  console.log('Match:', totalExpected === rows.length ? 'YES' : 'NO')
}

main().catch(console.error)
