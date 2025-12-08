/**
 * Analyze XLS column structure to understand historical invoice format
 */
const XLSX = require('xlsx')
const path = require('path')
const fs = require('fs')

const HISTORICAL_DIR = path.join(process.cwd(), 'reference/invoices-historical')

// Analyze a few files to see the column structure
const files = fs.readdirSync(HISTORICAL_DIR)
  .filter(f => f.startsWith('INVOICE-DETAILS-') && f.endsWith('.xlsx'))
  .slice(0, 3) // Just analyze first 3 files

for (const filename of files) {
  console.log('\n' + '='.repeat(70))
  console.log('FILE:', filename)
  console.log('='.repeat(70))

  const workbook = XLSX.readFile(path.join(HISTORICAL_DIR, filename))

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 })

    if (data.length === 0) continue

    console.log(`\n--- Sheet: ${sheetName} ---`)
    console.log('Headers:', data[0])

    // Show first data row (if exists)
    if (data.length > 1 && data[1][0] !== 'Total') {
      console.log('First row:', data[1])
    }

    // Find and show total row
    const totalRow = data.find(row => row[0] === 'Total')
    if (totalRow) {
      console.log('Total row:', totalRow)
    }
  }
}
