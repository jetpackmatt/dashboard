#!/usr/bin/env node

/**
 * Debug cost breakdown for a specific invoice
 */

const XLSX = require('xlsx')
const path = require('path')

const TARGET_PREFIX = process.argv[2] || '803'
const TARGET_MERCHANT = process.argv[3] || 'Henson Shaving'

const files = {
  'costs-shipments.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Original Invoice', merchantCol: 'Merchant Name', name: 'Shipments' },
  'costs-additionalservices.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Invoice Amount', merchantCol: 'Merchant Name', name: 'Additional Services' },
  'costs-returns.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Invoice', merchantCol: 'Merchant Name', name: 'Returns' },
  'costs-receiving.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Invoice Amount', merchantCol: 'Merchant Name', name: 'Receiving' },
  'costs-storage.xlsx': { invoiceCol: 'Invoice Number', amountCol: 'Invoice', merchantCol: 'Merchant Name', name: 'Storage' },
  'costs-credits.xlsx': { invoiceCol: 'Credit Invoice Number', amountCol: 'Credit Amount', merchantCol: 'Merchant Name', name: 'Credits' }
}

let grandTotal = 0
const allInvoiceIds = new Set()

console.log(`\nCost breakdown for ${TARGET_MERCHANT} - prefix ${TARGET_PREFIX}*\n`)
console.log('='.repeat(60))

for (const [file, config] of Object.entries(files)) {
  const wb = XLSX.readFile(path.join(__dirname, '../reference/cost-history', file))
  const sheet = wb.Sheets[wb.SheetNames[0]]
  const rows = XLSX.utils.sheet_to_json(sheet)

  let fileTotal = 0
  let matchCount = 0
  const invoiceIds = new Set()

  for (const row of rows) {
    const merchant = row[config.merchantCol]
    const invoiceId = String(row[config.invoiceCol] || '')
    const amount = parseFloat(row[config.amountCol]) || 0

    if (merchant === TARGET_MERCHANT && invoiceId.startsWith(TARGET_PREFIX)) {
      fileTotal += amount
      matchCount++
      invoiceIds.add(invoiceId)
      allInvoiceIds.add(invoiceId)
    }
  }

  if (matchCount > 0 || fileTotal !== 0) {
    console.log(`\n${config.name}:`)
    console.log(`  Rows: ${matchCount}`)
    console.log(`  SB Invoice IDs: ${Array.from(invoiceIds).sort().join(', ')}`)
    console.log(`  Total: $${fileTotal.toFixed(2)}`)
    grandTotal += fileTotal
  }
}

console.log('\n' + '='.repeat(60))
console.log(`\nGRAND TOTAL from XLSX: $${grandTotal.toFixed(2)}`)
console.log(`All SB Invoice IDs: ${Array.from(allInvoiceIds).sort().join(', ')}`)
