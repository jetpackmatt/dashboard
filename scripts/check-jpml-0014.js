#!/usr/bin/env node
const XLSX = require('xlsx')
const path = require('path')

const files = {
  'costs-shipments.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Original Invoice', merchantCol: 'Merchant Name' },
  'costs-additionalservices.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Invoice Amount', merchantCol: 'Merchant Name' },
  'costs-returns.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Invoice', merchantCol: 'Merchant Name' },
  'costs-receiving.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Invoice Amount', merchantCol: 'Merchant Name' },
  'costs-credits.xlsx': { invoiceCol: 'Credit Invoice Number', amountCol: 'Credit Amount', merchantCol: 'Merchant Name' }
}

const PREFIX = '840'
const MERCHANT = 'Methyl-Life®'

let total = 0

console.log('JPML-0014-101325 cost breakdown (prefix 840, no storage):\n')

for (const [file, config] of Object.entries(files)) {
  const wb = XLSX.readFile(path.join(__dirname, '../reference/cost-history', file))
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet)

  let fileTotal = 0
  for (const row of rows) {
    const merchant = row[config.merchantCol]
    const invoiceId = String(row[config.invoiceCol] || '')
    const amount = parseFloat(row[config.amountCol]) || 0

    if (merchant === MERCHANT && invoiceId.startsWith(PREFIX)) {
      fileTotal += amount
    }
  }

  if (fileTotal !== 0) {
    const name = file.replace('costs-', '').replace('.xlsx', '')
    console.log(name + ': $' + fileTotal.toFixed(2))
    total += fileTotal
  }
}

console.log('\nTotal (non-storage): $' + total.toFixed(2))
console.log('Storage (override): $0.00')
console.log('XLSX cost: $' + total.toFixed(2))
console.log('')
console.log('Current DB subtotal: $2454.38')
console.log('Difference: $' + (total - 2454.38).toFixed(2))
