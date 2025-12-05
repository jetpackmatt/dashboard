#!/usr/bin/env node
/**
 * Analyze XLSX invoice format
 */

const XLSX = require('xlsx')
const path = require('path')

const file = process.argv[2] || 'reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx'
const workbook = XLSX.readFile(path.resolve(process.cwd(), file))

console.log('=== XLSX Analysis ===\n')
console.log('Sheet names:', workbook.SheetNames)

for (const sheetName of workbook.SheetNames) {
  console.log(`\n--- Sheet: ${sheetName} ---`)
  const sheet = workbook.Sheets[sheetName]
  const data = XLSX.utils.sheet_to_json(sheet, { header: 1 })

  // Show first 15 rows
  console.log('First 15 rows:')
  for (let i = 0; i < Math.min(15, data.length); i++) {
    console.log(`  Row ${i + 1}:`, JSON.stringify(data[i]))
  }

  console.log(`\n  Total rows: ${data.length}`)

  // Show column headers (first row)
  if (data[0]) {
    console.log('  Columns:', data[0].join(' | '))
  }
}
