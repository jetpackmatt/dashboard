#!/usr/bin/env npx tsx
import ExcelJS from "exceljs"

async function main() {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile("reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx")

  // Check all sheets for merchant names
  for (const sheetName of ["Shipments", "Additional Services", "Returns", "Receiving", "Storage", "Credits"]) {
    const sheet = wb.getWorksheet(sheetName)
    if (sheet === undefined) continue

    const merchants = new Map<string, number>()
    let totalRows = 0

    sheet.eachRow((row, idx) => {
      if (idx === 1) return
      // Col 1 is User ID, Col 2 is Merchant Name
      const name = String(row.getCell(2).value || row.getCell(1).value || "").toLowerCase()
      if (name === "total" || name === "" || name === "null" || name === "undefined") return
      totalRows++
      merchants.set(name, (merchants.get(name) || 0) + 1)
    })

    console.log(`\n${sheetName} (${totalRows} rows):`)
    for (const [name, count] of [...merchants.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}x ${name}`)
    }
  }
}

main().catch(console.error)
