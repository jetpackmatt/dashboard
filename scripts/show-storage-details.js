#!/usr/bin/env node
const XLSX = require('xlsx')
const path = require('path')

const wb = XLSX.readFile(path.join(__dirname, '../reference/cost-history', 'costs-storage.xlsx'))
const sheet = wb.Sheets[wb.SheetNames[0]]
const rows = XLSX.utils.sheet_to_json(sheet)

console.log('Methyl-Life Storage - Full Details:\n')

function excelDateToJS(serial) {
  if (!serial) return 'N/A'
  const days = Math.floor(serial)
  const date = new Date((days - 25569) * 86400000)
  return date.toISOString().split('T')[0]
}

for (const row of rows) {
  if (row['Merchant Name'] === 'Methyl-Life®') {
    const invoiceId = String(row['Invoice Number'])
    const amount = parseFloat(row['Invoice']) || 0
    const invoiceDate = excelDateToJS(row['Invoice Date'])
    const chargeStart = excelDateToJS(row['ChargeStartdate'])
    const comment = row['Comment'] || ''

    console.log('Invoice:', invoiceId, '| Billed:', invoiceDate, '| Storage FOR:', chargeStart)
    console.log('  Amount: $' + amount.toFixed(2))
    console.log('  Comment:', comment.substring(0, 80))
    console.log('')
  }
}
