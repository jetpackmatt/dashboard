#!/usr/bin/env npx tsx
/**
 * End-to-end invoice comparison
 * Generates invoice using actual system, compares to JPHS-0037 reference XLSX
 */
import 'dotenv/config'
import ExcelJS from 'exceljs'
import { createAdminClient } from '../lib/supabase/admin'
import {
  collectBillingTransactions,
  applyMarkupsToLineItems,
  generateSummary,
  collectDetailedBillingData,
} from '../lib/billing/invoice-generator'

const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
// XLSX JPHS-0037 covers Nov 15 - Nov 30 based on storage dates
const PERIOD_START = new Date('2025-11-15')
const PERIOD_END = new Date('2025-11-30')

interface RefTotals {
  shipments: { rows: number; total: number }
  additionalServices: { rows: number; total: number }
  returns: { rows: number; total: number }
  receiving: { rows: number; total: number }
  storage: { rows: number; total: number }
  credits: { rows: number; total: number }
}

async function loadReferenceXLSX(): Promise<RefTotals> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile('reference/invoiceformatexamples/INVOICE-DETAILS-JPHS-0037-120125.xlsx')

  const refTotals: RefTotals = {
    shipments: { rows: 0, total: 0 },
    additionalServices: { rows: 0, total: 0 },
    returns: { rows: 0, total: 0 },
    receiving: { rows: 0, total: 0 },
    storage: { rows: 0, total: 0 },
    credits: { rows: 0, total: 0 },
  }

  // XLSX is Henson-only - all rows are "henson shaving"
  // Original Invoice (billed amount) is in col 12 for Shipments
  const shipSheet = wb.getWorksheet('Shipments')
  if (shipSheet) {
    shipSheet.eachRow((row, idx) => {
      if (idx === 1) return
      const val = row.getCell(2).value
      if (String(val).toLowerCase() === 'total') return
      refTotals.shipments.rows++
      refTotals.shipments.total += Number(row.getCell(12).value) || 0
    })
  }

  // Additional Services - Amount in col 5
  const feesSheet = wb.getWorksheet('Additional Services')
  if (feesSheet) {
    feesSheet.eachRow((row, idx) => {
      if (idx === 1) return
      const val = row.getCell(2).value
      if (String(val).toLowerCase() === 'total') return
      refTotals.additionalServices.rows++
      refTotals.additionalServices.total += Number(row.getCell(5).value) || 0
    })
  }

  // Returns - Amount in col 6
  const retSheet = wb.getWorksheet('Returns')
  if (retSheet) {
    retSheet.eachRow((row, idx) => {
      if (idx === 1) return
      const val = row.getCell(2).value
      if (String(val).toLowerCase() === 'total') return
      refTotals.returns.rows++
      refTotals.returns.total += Number(row.getCell(6).value) || 0
    })
  }

  // Receiving - Amount in col 4
  const recSheet = wb.getWorksheet('Receiving')
  if (recSheet) {
    recSheet.eachRow((row, idx) => {
      if (idx === 1) return
      const val = row.getCell(2).value
      if (String(val).toLowerCase() === 'total') return
      refTotals.receiving.rows++
      refTotals.receiving.total += Number(row.getCell(4).value) || 0
    })
  }

  // Storage - Amount in col 7
  const stoSheet = wb.getWorksheet('Storage')
  if (stoSheet) {
    stoSheet.eachRow((row, idx) => {
      if (idx === 1) return
      // Skip total rows
      const val = row.getCell(1).value
      if (String(val).toLowerCase() === 'total') return
      refTotals.storage.rows++
      refTotals.storage.total += Number(row.getCell(7).value) || 0
    })
  }

  // Credits - Amount in col 5
  const credSheet = wb.getWorksheet('Credits')
  if (credSheet) {
    credSheet.eachRow((row, idx) => {
      if (idx === 1) return
      const val = row.getCell(2).value
      if (String(val).toLowerCase() === 'total') return
      refTotals.credits.rows++
      refTotals.credits.total += Number(row.getCell(5).value) || 0
    })
  }

  return refTotals
}

async function main() {
  console.log('='.repeat(70))
  console.log('END-TO-END INVOICE COMPARISON')
  console.log('='.repeat(70))
  console.log(`Client: Henson (${HENSON_ID})`)
  console.log(`Period: ${PERIOD_START.toISOString().split('T')[0]} to ${PERIOD_END.toISOString().split('T')[0]}`)

  // Load reference XLSX totals
  console.log('\n## Loading Reference XLSX (JPHS-0037)')
  console.log('-'.repeat(70))
  const refTotals = await loadReferenceXLSX()

  console.log('Reference XLSX totals (Henson only):')
  console.log(`  Shipments:           ${refTotals.shipments.rows} rows, $${refTotals.shipments.total.toFixed(2)}`)
  console.log(`  Additional Services: ${refTotals.additionalServices.rows} rows, $${refTotals.additionalServices.total.toFixed(2)}`)
  console.log(`  Returns:             ${refTotals.returns.rows} rows, $${refTotals.returns.total.toFixed(2)}`)
  console.log(`  Receiving:           ${refTotals.receiving.rows} rows, $${refTotals.receiving.total.toFixed(2)}`)
  console.log(`  Storage:             ${refTotals.storage.rows} rows, $${refTotals.storage.total.toFixed(2)}`)
  console.log(`  Credits:             ${refTotals.credits.rows} rows, $${refTotals.credits.total.toFixed(2)}`)

  const refGrandTotal = refTotals.shipments.total + refTotals.additionalServices.total +
    refTotals.returns.total + refTotals.receiving.total + refTotals.storage.total + refTotals.credits.total
  console.log(`  GRAND TOTAL:         $${refGrandTotal.toFixed(2)}`)

  // Generate invoice using actual system
  console.log('\n## Generating Invoice Using Actual System')
  console.log('-'.repeat(70))

  // Step 1: Collect billing transactions
  console.log('Collecting billing transactions...')
  let lineItems = await collectBillingTransactions(HENSON_ID, PERIOD_START, PERIOD_END)
  console.log(`  Found ${lineItems.length} line items`)

  // Step 2: Apply markups
  console.log('Applying markups using markup engine...')
  lineItems = await applyMarkupsToLineItems(HENSON_ID, lineItems)

  // Step 3: Generate summary
  const summary = generateSummary(lineItems)

  // Group by category for comparison
  const ourTotals = {
    shipments: { rows: 0, total: 0 },
    additionalServices: { rows: 0, total: 0 },
    returns: { rows: 0, total: 0 },
    receiving: { rows: 0, total: 0 },
    storage: { rows: 0, total: 0 },
    credits: { rows: 0, total: 0 },
  }

  for (const item of lineItems) {
    const table = item.billingTable
    const billedAmount = item.billedAmount

    if (table === 'shipments') {
      ourTotals.shipments.rows++
      ourTotals.shipments.total += billedAmount
    } else if (table === 'shipment_fees') {
      ourTotals.additionalServices.rows++
      ourTotals.additionalServices.total += billedAmount
    } else if (table === 'returns') {
      ourTotals.returns.rows++
      ourTotals.returns.total += billedAmount
    } else if (table === 'receiving') {
      ourTotals.receiving.rows++
      ourTotals.receiving.total += billedAmount
    } else if (table === 'storage') {
      ourTotals.storage.rows++
      ourTotals.storage.total += billedAmount
    } else if (table === 'credits') {
      ourTotals.credits.rows++
      ourTotals.credits.total += billedAmount
    }
  }

  console.log('\nOur generated totals:')
  console.log(`  Shipments:           ${ourTotals.shipments.rows} rows, $${ourTotals.shipments.total.toFixed(2)}`)
  console.log(`  Additional Services: ${ourTotals.additionalServices.rows} rows, $${ourTotals.additionalServices.total.toFixed(2)}`)
  console.log(`  Returns:             ${ourTotals.returns.rows} rows, $${ourTotals.returns.total.toFixed(2)}`)
  console.log(`  Receiving:           ${ourTotals.receiving.rows} rows, $${ourTotals.receiving.total.toFixed(2)}`)
  console.log(`  Storage:             ${ourTotals.storage.rows} rows, $${ourTotals.storage.total.toFixed(2)}`)
  console.log(`  Credits:             ${ourTotals.credits.rows} rows, $${ourTotals.credits.total.toFixed(2)}`)

  const ourGrandTotal = ourTotals.shipments.total + ourTotals.additionalServices.total +
    ourTotals.returns.total + ourTotals.receiving.total + ourTotals.storage.total + ourTotals.credits.total
  console.log(`  GRAND TOTAL:         $${ourGrandTotal.toFixed(2)}`)

  // Compare
  console.log('\n## COMPARISON')
  console.log('='.repeat(70))

  const comparisons = [
    { name: 'Shipments', ref: refTotals.shipments, our: ourTotals.shipments },
    { name: 'Additional Services', ref: refTotals.additionalServices, our: ourTotals.additionalServices },
    { name: 'Returns', ref: refTotals.returns, our: ourTotals.returns },
    { name: 'Receiving', ref: refTotals.receiving, our: ourTotals.receiving },
    { name: 'Storage', ref: refTotals.storage, our: ourTotals.storage },
    { name: 'Credits', ref: refTotals.credits, our: ourTotals.credits },
  ]

  let allPass = true

  for (const c of comparisons) {
    const rowMatch = c.ref.rows === c.our.rows
    const amtDiff = Math.abs(c.ref.total - c.our.total)
    const amtMatch = amtDiff < 1.00 // Allow $1 rounding tolerance

    const status = rowMatch && amtMatch ? '✅' : '❌'
    if (!rowMatch || !amtMatch) allPass = false

    console.log(`${status} ${c.name.padEnd(20)} Rows: ${c.ref.rows} vs ${c.our.rows} | Amount: $${c.ref.total.toFixed(2)} vs $${c.our.total.toFixed(2)} (diff: $${amtDiff.toFixed(2)})`)
  }

  const grandDiff = Math.abs(refGrandTotal - ourGrandTotal)
  console.log('-'.repeat(70))
  console.log(`Grand Total Difference: $${grandDiff.toFixed(2)}`)

  // Final result
  console.log('\n' + '='.repeat(70))
  if (allPass && grandDiff < 5.00) {
    console.log('✅ ALL TESTS PASSED - Invoice generation matches reference!')
  } else {
    console.log('❌ SOME TESTS FAILED - See differences above')
  }
  console.log('='.repeat(70))

  // Markup breakdown
  console.log('\n## Markup Breakdown')
  console.log('-'.repeat(70))
  console.log(`Base (cost):     $${summary.subtotal.toFixed(2)}`)
  console.log(`Total Markup:    $${summary.totalMarkup.toFixed(2)}`)
  console.log(`Billed Total:    $${summary.totalAmount.toFixed(2)}`)
  console.log(`Effective Rate:  ${((summary.totalMarkup / summary.subtotal) * 100).toFixed(2)}%`)
}

main().catch(console.error)
