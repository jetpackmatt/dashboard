/**
 * Check all Storage tabs in XLS files
 */
const XLSX = require('xlsx')
const path = require('path')
const fs = require('fs')

const HISTORICAL_DIR = path.join(process.cwd(), 'reference/invoices-historical')
const files = fs.readdirSync(HISTORICAL_DIR).filter(f => f.endsWith('.xlsx') && f.includes('INVOICE-DETAILS'))

let totalStorageRows = 0
let allInventoryIds = new Set()
let filesWithStorage = 0

for (const file of files) {
  const xlsPath = path.join(HISTORICAL_DIR, file)
  const workbook = XLSX.readFile(xlsPath)

  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('storage'))
  if (!sheetName) continue

  filesWithStorage++
  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet)

  totalStorageRows += rows.length

  for (const row of rows) {
    const invId = String(row['Inventory ID'] || '').trim()
    if (invId && invId !== 'undefined') {
      allInventoryIds.add(invId)
    }
  }

  console.log(file.slice(0, 35).padEnd(38), rows.length, 'rows')
}

console.log()
console.log('Files with Storage tab:', filesWithStorage)
console.log('Total storage rows:', totalStorageRows)
console.log('Unique inventory IDs:', allInventoryIds.size)
console.log('Sample IDs:', [...allInventoryIds].slice(0, 10))
