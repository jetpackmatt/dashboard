/**
 * Search XLS files for specific reference IDs
 */
const XLSX = require('xlsx')
const path = require('path')
const fs = require('fs')

const HISTORICAL_DIR = path.join(process.cwd(), 'reference/invoices-historical')

// Sample reference IDs to search for (unmatched March 18 transactions)
const searchIds = ['247368836', '247357906', '247365338', '247369546', '247366238']

// Get all XLS files
const files = fs.readdirSync(HISTORICAL_DIR).filter(f => f.endsWith('.xlsx'))
console.log('Searching', files.length, 'XLS files for sample reference IDs...\n')

let foundIn = {}

for (const file of files) {
  const xlsPath = path.join(HISTORICAL_DIR, file)
  const workbook = XLSX.readFile(xlsPath)

  // Check shipping sheet
  const sheetName = workbook.SheetNames.find(n => n.toLowerCase().includes('ship'))
  if (!sheetName) continue

  const sheet = workbook.Sheets[sheetName]
  const rows = XLSX.utils.sheet_to_json(sheet)

  // Check for OrderID or Store OrderID
  rows.forEach(row => {
    const orderId = String(row['OrderID'] || row['Store OrderID'] || '')
    if (searchIds.includes(orderId)) {
      foundIn[orderId] = foundIn[orderId] || []
      foundIn[orderId].push(file)
    }
  })
}

console.log('Search results:')
searchIds.forEach(id => {
  console.log(id + ':', foundIn[id] ? foundIn[id].join(', ') : 'NOT FOUND')
})
