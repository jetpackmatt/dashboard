/**
 * Compare manual invoice XLSX with our generated XLSX to find differences
 */
const ExcelJS = require('exceljs')

async function main() {
  console.log('='.repeat(80))
  console.log('COMPARING MANUAL INVOICE XLSX vs OUR DB XLSX')
  console.log('='.repeat(80))

  // Load both workbooks
  const manualWb = new ExcelJS.Workbook()
  await manualWb.xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')

  const ourWb = new ExcelJS.Workbook()
  await ourWb.xlsx.readFile('scripts/output/INVOICE-DETAILS-HENSON-DB.xlsx')

  // ============ SHIPMENTS COMPARISON ============
  console.log('\n' + '='.repeat(70))
  console.log('SHIPMENTS SHEET COMPARISON')
  console.log('='.repeat(70))

  const manualShipments = manualWb.getWorksheet('Shipments')
  const ourShipments = ourWb.getWorksheet('Shipments')

  // Extract OrderIDs from manual (column 5 is OrderID)
  const manualOrderIds = new Set()
  const manualShipmentData = {}
  manualShipments.eachRow((row, rowNum) => {
    if (rowNum === 1) return // Skip header
    const orderId = row.getCell(5).value
    const total = row.getCell(12).value // Original Invoice column
    if (orderId && typeof orderId === 'number') {
      manualOrderIds.add(orderId)
      manualShipmentData[orderId] = {
        base: row.getCell(10).value,
        surcharge: row.getCell(11).value,
        total: total
      }
    }
  })

  // Extract OrderIDs from ours (column 5 is order_id)
  const ourOrderIds = new Set()
  const ourShipmentData = {}
  ourShipments.eachRow((row, rowNum) => {
    if (rowNum === 1) return // Skip header
    const orderId = row.getCell(5).value
    const total = row.getCell(12).value // total column
    if (orderId && orderId !== 'TOTAL') {
      ourOrderIds.add(Number(orderId))
      ourShipmentData[orderId] = {
        base: row.getCell(10).value,
        surcharge: row.getCell(11).value,
        total: total
      }
    }
  })

  console.log(`Manual shipments: ${manualOrderIds.size}`)
  console.log(`Our shipments: ${ourOrderIds.size}`)

  // Find missing from ours
  const missingFromOurs = []
  for (const orderId of manualOrderIds) {
    if (!ourOrderIds.has(orderId)) {
      missingFromOurs.push({
        orderId,
        ...manualShipmentData[orderId]
      })
    }
  }

  // Find extra in ours
  const extraInOurs = []
  for (const orderId of ourOrderIds) {
    if (!manualOrderIds.has(orderId)) {
      extraInOurs.push({
        orderId,
        ...ourShipmentData[orderId]
      })
    }
  }

  console.log(`\nMissing from our DB (in manual but not ours): ${missingFromOurs.length}`)
  if (missingFromOurs.length > 0) {
    const missingTotal = missingFromOurs.reduce((s, m) => s + Number(m.total || 0), 0)
    console.log(`Total $ missing: $${missingTotal.toFixed(2)}`)
    console.log('\nMissing orders:')
    for (const m of missingFromOurs.slice(0, 20)) {
      console.log(`  Order ${m.orderId}: base=$${m.base}, surcharge=$${m.surcharge}, total=$${m.total}`)
    }
  }

  console.log(`\nExtra in our DB (in ours but not manual): ${extraInOurs.length}`)
  if (extraInOurs.length > 0) {
    const extraTotal = extraInOurs.reduce((s, m) => s + Number(m.total || 0), 0)
    console.log(`Total $ extra: $${extraTotal.toFixed(2)}`)
    console.log('\nExtra orders (first 10):')
    for (const m of extraInOurs.slice(0, 10)) {
      console.log(`  Order ${m.orderId}: base=$${m.base}, surcharge=$${m.surcharge}, total=$${m.total}`)
    }
  }

  // Compare amounts for matching orders
  let amountDiffs = []
  for (const orderId of manualOrderIds) {
    if (ourOrderIds.has(orderId)) {
      const manualTotal = Number(manualShipmentData[orderId].total || 0)
      const ourTotal = Number(ourShipmentData[orderId]?.total || 0)
      const diff = ourTotal - manualTotal
      if (Math.abs(diff) > 0.01) {
        amountDiffs.push({ orderId, manualTotal, ourTotal, diff })
      }
    }
  }

  console.log(`\nMatching orders with different amounts: ${amountDiffs.length}`)
  if (amountDiffs.length > 0) {
    const totalDiff = amountDiffs.reduce((s, d) => s + d.diff, 0)
    console.log(`Total amount difference: $${totalDiff.toFixed(2)}`)
    console.log('\nSamples:')
    for (const d of amountDiffs.slice(0, 10)) {
      console.log(`  Order ${d.orderId}: manual=$${d.manualTotal.toFixed(2)}, ours=$${d.ourTotal.toFixed(2)}, diff=$${d.diff.toFixed(2)}`)
    }
  }

  // ============ ADDITIONAL SERVICES COMPARISON ============
  console.log('\n' + '='.repeat(70))
  console.log('ADDITIONAL SERVICES SHEET COMPARISON')
  console.log('='.repeat(70))

  const manualAddl = manualWb.getWorksheet('Additional Services')
  const ourAddl = ourWb.getWorksheet('Additional Services')

  // Count and sum
  let manualAddlCount = 0, manualAddlTotal = 0
  manualAddl.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const amt = row.getCell(5).value // Invoice Amount
    if (typeof amt === 'number') {
      manualAddlCount++
      manualAddlTotal += amt
    }
  })

  let ourAddlCount = 0, ourAddlTotal = 0
  ourAddl.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const amt = row.getCell(5).value
    if (typeof amt === 'number' && row.getCell(2).value !== 'TOTAL') {
      ourAddlCount++
      ourAddlTotal += amt
    }
  })

  console.log(`Manual: ${manualAddlCount} rows, $${manualAddlTotal.toFixed(2)}`)
  console.log(`Ours: ${ourAddlCount} rows, $${ourAddlTotal.toFixed(2)}`)
  console.log(`Difference: ${ourAddlCount - manualAddlCount} rows, $${(ourAddlTotal - manualAddlTotal).toFixed(2)}`)

  // ============ CREDITS COMPARISON ============
  console.log('\n' + '='.repeat(70))
  console.log('CREDITS SHEET COMPARISON')
  console.log('='.repeat(70))

  const manualCredits = manualWb.getWorksheet('Credits')
  const ourCredits = ourWb.getWorksheet('Credits')

  // Extract Reference IDs from manual (column 3)
  const manualCreditIds = new Set()
  const manualCreditData = {}
  manualCredits.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const refId = row.getCell(3).value
    const amt = row.getCell(6).value // Credit Amount
    if (refId && typeof refId === 'number') {
      manualCreditIds.add(refId)
      manualCreditData[refId] = { amount: amt }
    }
  })

  const ourCreditIds = new Set()
  const ourCreditData = {}
  ourCredits.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const refId = row.getCell(3).value
    const amt = row.getCell(6).value
    if (refId && refId !== 'TOTAL') {
      ourCreditIds.add(Number(refId))
      ourCreditData[refId] = { amount: amt }
    }
  })

  console.log(`Manual credits: ${manualCreditIds.size}`)
  console.log(`Our credits: ${ourCreditIds.size}`)

  // Find missing credits
  const missingCredits = []
  for (const refId of manualCreditIds) {
    if (!ourCreditIds.has(refId)) {
      missingCredits.push({
        refId,
        ...manualCreditData[refId]
      })
    }
  }

  console.log(`\nMissing credits from our DB: ${missingCredits.length}`)
  if (missingCredits.length > 0) {
    const missingCreditTotal = missingCredits.reduce((s, c) => s + Number(c.amount || 0), 0)
    console.log(`Total credits missing: $${missingCreditTotal.toFixed(2)}`)
    console.log('\nMissing credits:')
    for (const c of missingCredits) {
      console.log(`  Ref ${c.refId}: $${c.amount}`)
    }
  }

  // ============ STORAGE COMPARISON ============
  console.log('\n' + '='.repeat(70))
  console.log('STORAGE SHEET COMPARISON')
  console.log('='.repeat(70))

  const manualStorage = manualWb.getWorksheet('Storage')
  const ourStorage = ourWb.getWorksheet('Storage')

  let manualStorageCount = 0, manualStorageTotal = 0
  manualStorage.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const amt = row.getCell(7).value // Invoice
    if (typeof amt === 'number') {
      manualStorageCount++
      manualStorageTotal += amt
    }
  })

  let ourStorageCount = 0, ourStorageTotal = 0
  ourStorage.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const amt = row.getCell(5).value // amount
    if (typeof amt === 'number' && row.getCell(1).value !== 'TOTAL') {
      ourStorageCount++
      ourStorageTotal += amt
    }
  })

  console.log(`Manual: ${manualStorageCount} rows, $${manualStorageTotal.toFixed(2)}`)
  console.log(`Ours: ${ourStorageCount} rows, $${ourStorageTotal.toFixed(2)}`)
  console.log(`Difference: ${ourStorageCount - manualStorageCount} rows, $${(ourStorageTotal - manualStorageTotal).toFixed(2)}`)

  // ============ RETURNS COMPARISON ============
  console.log('\n' + '='.repeat(70))
  console.log('RETURNS SHEET COMPARISON')
  console.log('='.repeat(70))

  const manualReturns = manualWb.getWorksheet('Returns')
  const ourReturns = ourWb.getWorksheet('Returns')

  let manualReturnsCount = 0, manualReturnsTotal = 0
  manualReturns.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const val = row.getCell(1).value
    if (val === 'Total') {
      manualReturnsTotal = row.getCell(6).value
    } else if (typeof row.getCell(6).value === 'number') {
      manualReturnsCount++
    }
  })

  let ourReturnsCount = 0, ourReturnsTotal = 0
  ourReturns.eachRow((row, rowNum) => {
    if (rowNum === 1) return
    const amt = row.getCell(4).value
    if (typeof amt === 'number' && row.getCell(2).value !== 'TOTAL') {
      ourReturnsCount++
      ourReturnsTotal += amt
    }
  })

  console.log(`Manual: ${manualReturnsCount} rows, $${manualReturnsTotal}`)
  console.log(`Ours: ${ourReturnsCount} rows, $${ourReturnsTotal.toFixed(2)}`)

  // ============ SUMMARY ============
  console.log('\n' + '='.repeat(70))
  console.log('SUMMARY OF DIFFERENCES')
  console.log('='.repeat(70))
  console.log(`\nShipments: Missing ${missingFromOurs.length} orders worth $${missingFromOurs.reduce((s, m) => s + Number(m.total || 0), 0).toFixed(2)}`)
  console.log(`Credits: Missing ${missingCredits.length} credits worth $${missingCredits.reduce((s, c) => s + Number(c.amount || 0), 0).toFixed(2)}`)
  console.log(`Storage: Difference of ${ourStorageCount - manualStorageCount} rows, $${(ourStorageTotal - manualStorageTotal).toFixed(2)}`)
}

main().catch(console.error)
