/**
 * Analyze the reference XLSX structure to understand column headers and format
 */
require('dotenv').config({ path: '.env.local' })
const ExcelJS = require('exceljs')

async function main() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')

  console.log('='.repeat(70))
  console.log('REFERENCE XLSX STRUCTURE ANALYSIS')
  console.log('='.repeat(70))

  // List all worksheets
  console.log('\nWorksheets:')
  wb.eachSheet((sheet, idx) => {
    console.log(`  ${idx}. ${sheet.name} (${sheet.rowCount} rows)`)
  })

  // Analyze each sheet
  for (const sheetName of ['Shipments', 'Additional Services', 'Returns', 'Receiving', 'Storage', 'Credits']) {
    const sheet = wb.getWorksheet(sheetName)
    if (!sheet) {
      console.log(`\n⚠️ Sheet "${sheetName}" not found`)
      continue
    }

    console.log('\n' + '='.repeat(70))
    console.log(`SHEET: ${sheetName}`)
    console.log('='.repeat(70))

    // Get headers (row 1)
    const headers = []
    sheet.getRow(1).eachCell((cell, colNum) => {
      headers.push({ col: colNum, name: cell.value })
    })

    console.log('\nHeaders:')
    for (const h of headers) {
      console.log(`  ${h.col}. ${h.name}`)
    }

    // Sample first data row
    if (sheet.rowCount > 1) {
      console.log('\nSample row (row 2):')
      const row = sheet.getRow(2)
      for (const h of headers) {
        const val = row.getCell(h.col).value
        console.log(`  ${h.name}: ${JSON.stringify(val)}`)
      }
    }

    // Count rows (excluding header)
    console.log('\nTotal data rows:', sheet.rowCount - 1)

    // For Shipments, show column statistics
    if (sheetName === 'Shipments') {
      console.log('\nShipments Column Analysis:')

      // Unique values in certain columns
      const merchants = new Set()
      const userIds = new Set()
      const carriers = new Set()

      let totalBase = 0
      let totalSurcharge = 0
      let totalAmount = 0

      sheet.eachRow((row, idx) => {
        if (idx === 1) return
        userIds.add(row.getCell(1).value)
        merchants.add(row.getCell(2).value)
        carriers.add(row.getCell(7).value)
        totalBase += Number(row.getCell(10).value) || 0
        totalSurcharge += Number(row.getCell(11).value) || 0
        totalAmount += Number(row.getCell(12).value) || 0
      })

      console.log('  Unique UserIDs:', [...userIds].join(', '))
      console.log('  Unique Merchants:', [...merchants].join(', '))
      console.log('  Unique Carriers:', carriers.size, '-', [...carriers].slice(0, 5).join(', '))
      console.log('\n  Totals:')
      console.log('    Base:', '$' + totalBase.toFixed(2))
      console.log('    Surcharge:', '$' + totalSurcharge.toFixed(2))
      console.log('    Total:', '$' + totalAmount.toFixed(2))
    }

    // For Additional Services, show fee types
    if (sheetName === 'Additional Services') {
      const feeTypes = {}
      sheet.eachRow((row, idx) => {
        if (idx === 1) return
        const feeType = row.getCell(6).value // Assuming fee type is in col 6
        feeTypes[feeType] = (feeTypes[feeType] || 0) + 1
      })
      console.log('\nFee Types:')
      for (const [type, count] of Object.entries(feeTypes).sort((a, b) => b[1] - a[1])) {
        console.log(`  ${type}: ${count}`)
      }
    }
  }
}

main().catch(console.error)
