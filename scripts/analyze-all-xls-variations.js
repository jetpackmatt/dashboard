/**
 * Analyze ALL historical XLS files to find every tab name and column variation
 */
require('dotenv').config({ path: '.env.local' })
const XLSX = require('xlsx')
const fs = require('fs')
const path = require('path')

const HISTORICAL_DIR = path.join(process.cwd(), 'reference/invoices-historical')

const allTabNames = new Set()
const tabColumnMap = {}  // tab name -> Set of column names
const fileTabMap = {}    // filename -> array of tab names

// Also track specific structures by date to find patterns
const fileStructures = []

const files = fs.readdirSync(HISTORICAL_DIR)
  .filter(f => f.endsWith('.xlsx') && f.includes('DETAILS'))
  .sort()

console.log('Analyzing ' + files.length + ' XLS files...')
console.log('='.repeat(70))

for (const filename of files) {
  const filePath = path.join(HISTORICAL_DIR, filename)
  const workbook = XLSX.readFile(filePath)

  fileTabMap[filename] = workbook.SheetNames

  const fileInfo = { filename, tabs: {} }

  for (const sheetName of workbook.SheetNames) {
    allTabNames.add(sheetName)

    const sheet = workbook.Sheets[sheetName]
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 })

    if (data.length > 0 && data[0]) {
      const headers = data[0].filter(h => h != null)

      if (!tabColumnMap[sheetName]) {
        tabColumnMap[sheetName] = new Set()
      }
      headers.forEach(h => tabColumnMap[sheetName].add(h))

      fileInfo.tabs[sheetName] = {
        headers,
        rowCount: data.length - 1  // excluding header
      }
    }
  }

  fileStructures.push(fileInfo)
}

// Output analysis
console.log('\n=== ALL UNIQUE TAB NAMES ===')
const sortedTabs = [...allTabNames].sort()
sortedTabs.forEach(tab => console.log('  - "' + tab + '"'))

console.log('\n=== COLUMNS BY TAB ===')
for (const [tab, columns] of Object.entries(tabColumnMap).sort()) {
  console.log('\n"' + tab + '" columns:')
  const sortedCols = [...columns].sort()
  sortedCols.forEach(col => console.log('    - "' + col + '"'))
}

console.log('\n=== FILES WITH NON-STANDARD TAB NAMES ===')
const standardTabs = ['Shipping', 'Additional Fees', 'Returns', 'Receiving', 'Credits', 'Storage']
const altTabs = ['Shipments', 'Additional Services']

for (const [filename, tabs] of Object.entries(fileTabMap)) {
  const unusual = tabs.filter(t =>
    !standardTabs.includes(t) &&
    !altTabs.includes(t) &&
    t.toLowerCase() !== 'summary'
  )
  if (unusual.length > 0) {
    console.log('  ' + filename + ':')
    unusual.forEach(t => console.log('    - "' + t + '" (non-standard)'))
  }
}

// Show structure variations per file
console.log('\n=== STRUCTURE BY FILE ===')
for (const file of fileStructures) {
  console.log('\n' + file.filename + ':')
  for (const [tab, info] of Object.entries(file.tabs)) {
    console.log('  ' + tab + ': ' + info.rowCount + ' rows, columns: ' + info.headers.join(', '))
  }
}

// Create mapping summary
console.log('\n=== REQUIRED COLUMN MAPPINGS ===')
const shippingTabs = [...allTabNames].filter(t => t.toLowerCase().includes('ship'))
const addlTabs = [...allTabNames].filter(t => t.toLowerCase().includes('additional'))
const returnsTabs = [...allTabNames].filter(t => t.toLowerCase().includes('return'))
const receivingTabs = [...allTabNames].filter(t => t.toLowerCase().includes('receiv'))
const creditsTabs = [...allTabNames].filter(t => t.toLowerCase().includes('credit'))
const storageTabs = [...allTabNames].filter(t => t.toLowerCase().includes('storage'))

console.log('\nShipping-related tabs: ' + shippingTabs.join(', '))
console.log('Additional-related tabs: ' + addlTabs.join(', '))
console.log('Returns-related tabs: ' + returnsTabs.join(', '))
console.log('Receiving-related tabs: ' + receivingTabs.join(', '))
console.log('Credits-related tabs: ' + creditsTabs.join(', '))
console.log('Storage-related tabs: ' + storageTabs.join(', '))

// Now check which columns are used for ID matching in each tab type
console.log('\n=== ID COLUMN ANALYSIS ===')
for (const [tab, columns] of Object.entries(tabColumnMap)) {
  const colArray = [...columns]
  const idCols = colArray.filter(c =>
    c.toLowerCase().includes('id') ||
    c.toLowerCase().includes('order') ||
    c.toLowerCase().includes('number') ||
    c.toLowerCase().includes('reference')
  )
  const amountCols = colArray.filter(c =>
    c.toLowerCase().includes('invoice') ||
    c.toLowerCase().includes('amount') ||
    c.toLowerCase().includes('charge') ||
    c.toLowerCase().includes('credit')
  )
  console.log('\n"' + tab + '":')
  console.log('  ID columns: ' + idCols.join(', '))
  console.log('  Amount columns: ' + amountCols.join(', '))
}
