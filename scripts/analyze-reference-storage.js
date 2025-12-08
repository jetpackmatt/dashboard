#!/usr/bin/env node
/**
 * Analyze the reference Storage tab to understand the date structure
 */

const XLSX = require('xlsx')
const path = require('path')

async function main() {
  const refPath = path.join(__dirname, '../reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')

  console.log('Reading reference file...')
  const workbook = XLSX.readFile(refPath)

  // Get Storage sheet
  const storageSheet = workbook.Sheets['Storage']
  if (!storageSheet) {
    console.log('No Storage sheet found!')
    console.log('Available sheets:', workbook.SheetNames)
    return
  }

  const storageData = XLSX.utils.sheet_to_json(storageSheet)
  console.log('Storage rows:', storageData.length)

  // Check for date column
  const firstRow = storageData[0]
  console.log('\nFirst row keys:', Object.keys(firstRow))
  console.log('First row sample:', firstRow)

  // Find date-like columns
  const dateColumns = []
  for (const key of Object.keys(firstRow)) {
    const val = firstRow[key]
    if (typeof val === 'string' && val.match(/\d{4}-\d{2}-\d{2}/)) {
      dateColumns.push(key)
    }
    if (typeof val === 'number' && val > 40000 && val < 50000) {
      // Excel date serial number
      dateColumns.push(key + ' (Excel date)')
    }
  }
  console.log('\nPotential date columns:', dateColumns)

  // Analyze date distribution
  console.log('\n--- ANALYZING DATE DISTRIBUTION ---')

  // Check 'Date' column if exists
  const dateCol = 'Date'
  if (firstRow.hasOwnProperty(dateCol)) {
    const dateValues = {}
    for (const row of storageData) {
      let dateVal = row[dateCol]

      // Convert Excel serial date to string
      if (typeof dateVal === 'number') {
        const excelDate = new Date((dateVal - 25569) * 86400 * 1000)
        dateVal = excelDate.toISOString().split('T')[0]
      }

      dateValues[dateVal] = (dateValues[dateVal] || 0) + 1
    }

    console.log('\nDate column distribution:')
    for (const [date, count] of Object.entries(dateValues).sort()) {
      console.log(`  ${date}: ${count}`)
    }

    console.log('\nTotal dates:', Object.keys(dateValues).length)
    console.log('Total rows:', Object.values(dateValues).reduce((a, b) => a + b, 0))
  }

  // Count unique inventory items
  console.log('\n--- ANALYZING INVENTORY ITEMS ---')
  const inventoryCol = Object.keys(firstRow).find(k =>
    k.toLowerCase().includes('inventory') ||
    k.toLowerCase().includes('sku') ||
    k.toLowerCase().includes('product')
  )

  if (inventoryCol) {
    const uniqueItems = new Set()
    const itemCounts = {}
    for (const row of storageData) {
      const item = row[inventoryCol]
      uniqueItems.add(item)
      itemCounts[item] = (itemCounts[item] || 0) + 1
    }
    console.log(`\nUnique inventory items (column "${inventoryCol}"):`, uniqueItems.size)
    console.log('Sample item counts:')
    const sorted = Object.entries(itemCounts).sort((a, b) => b[1] - a[1]).slice(0, 10)
    for (const [item, count] of sorted) {
      console.log(`  ${item}: ${count} rows`)
    }
  }

  // Show all column names
  console.log('\n--- ALL COLUMN NAMES ---')
  for (const key of Object.keys(firstRow)) {
    console.log(`  "${key}": ${typeof firstRow[key]} = ${firstRow[key]}`)
  }
}

main().catch(console.error)
