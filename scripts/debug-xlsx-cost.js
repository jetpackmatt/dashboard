#!/usr/bin/env node

/**
 * Debug XLSX cost calculation for a specific invoice
 */

const XLSX = require('xlsx')
const path = require('path')

// JPML-0013-100625 uses SB invoice prefix 837 (Oct 6, 2025)
const TARGET_PREFIX = '837'
const TARGET_MERCHANT = 'Methyl-Life®'

const files = {
  'costs-shipments.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Original Invoice', merchantCol: 'Merchant Name' },
  'costs-additionalservices.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Invoice Amount', merchantCol: 'Merchant Name' },
  'costs-returns.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Invoice', merchantCol: 'Merchant Name' },
  'costs-receiving.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Invoice Amount', merchantCol: 'Merchant Name' },
  'costs-storage.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Invoice', merchantCol: 'Merchant Name' },
  'costs-credits.xlsx': { invoiceCol: 'Credit Invoice Number', amountCol: 'Credit Amount', merchantCol: 'Merchant Name' }
}

let grandTotal = 0
const invoiceIds = new Set()

console.log(`\nCalculating cost for ${TARGET_MERCHANT} with invoice prefix ${TARGET_PREFIX}*\n`)

for (const [file, config] of Object.entries(files)) {
  const wb = XLSX.readFile(path.join(__dirname, '../reference/cost-history', file))
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet)

  let fileTotal = 0
  let matchCount = 0

  for (const row of rows) {
    const merchant = row[config.merchantCol]
    const invoiceId = String(row[config.invoiceCol] || '')
    const amount = parseFloat(row[config.amountCol]) || 0

    if (merchant === TARGET_MERCHANT && invoiceId.startsWith(TARGET_PREFIX)) {
      fileTotal += amount
      matchCount++
      invoiceIds.add(invoiceId)
    }
  }

  if (matchCount > 0 || fileTotal !== 0) {
    console.log(`${file}:`)
    console.log(`  Rows: ${matchCount}, Total: $${fileTotal.toFixed(2)}`)
    grandTotal += fileTotal
  }
}

console.log('')
console.log('SB Invoice IDs found:', Array.from(invoiceIds).sort().join(', '))
console.log('')
console.log(`GRAND TOTAL from XLSX: $${grandTotal.toFixed(2)}`)
console.log('DB shows subtotal: $1,889.55')
console.log(`Difference: $${(grandTotal - 1889.55).toFixed(2)}`)
