#!/usr/bin/env node
const ExcelJS = require('exceljs')

async function main() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')

  const sheet = wb.getWorksheet('Additional Services')

  // Get fee type distribution (column 4 is Fee Type, column 5 is Invoice Amount)
  const byType = {}
  sheet.eachRow((row, idx) => {
    if (idx === 1) return // header
    const cell1 = row.getCell(1).value
    if (cell1 === 'Total') return // skip total row

    const feeType = String(row.getCell(4).value || 'Unknown')
    const amount = Number(row.getCell(5).value) || 0

    if (!byType[feeType]) byType[feeType] = { count: 0, sum: 0 }
    byType[feeType].count++
    byType[feeType].sum += amount
  })

  console.log('Reference Additional Services by fee type:')
  for (const [type, data] of Object.entries(byType).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`  ${type}: ${data.count} @ $${data.sum.toFixed(2)}`)
  }

  const total = Object.values(byType).reduce((s, d) => s + d.sum, 0)
  console.log(`\nTotal: $${total.toFixed(2)}`)
}
main()
