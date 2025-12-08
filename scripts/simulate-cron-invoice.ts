#!/usr/bin/env npx tsx
/**
 * Simulate Cron Invoice Generation
 *
 * Uses the ACTUAL invoice-generator.ts functions to generate XLSX and PDF
 * for the reference period (JPHS-0037). Outputs to scripts/output/ directory.
 *
 * This does NOT create database records - just generates files for validation.
 *
 * Usage: npx tsx scripts/simulate-cron-invoice.ts
 */

import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'
import * as path from 'path'

// Import actual invoice generator functions
import {
  collectBillingTransactionsByInvoiceIds,
  collectDetailedBillingDataByInvoiceIds,
  applyMarkupsToLineItems,
  generateSummary,
  generateExcelInvoice,
} from '../lib/billing/invoice-generator'
import { generatePDFViaSubprocess } from '../lib/billing/pdf-subprocess'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Simulating Dec 1 Monday cron job
// Invoice Date: Dec 1, 2025 (Monday)
// Billing Period: Nov 24 - Nov 30 (prior Mon-Sun)
// Storage Period: Determined from actual storage transaction dates, rounded to half-month
const INVOICE_IDS = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]
const INVOICE_DATE = new Date(2025, 11, 1) // Dec 1, 2025 (Monday)
const PERIOD_START = new Date(2025, 10, 24) // Nov 24, 2025 (prior Monday)
const PERIOD_END = new Date(2025, 10, 30) // Nov 30, 2025 (prior Sunday)

async function main() {
  console.log('='.repeat(70))
  console.log('SIMULATE CRON INVOICE GENERATION')
  console.log('Using actual invoice-generator.ts functions')
  console.log('='.repeat(70))

  // Get Henson client
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, company_name, short_code, merchant_id, next_invoice_number, billing_email, billing_terms')
    .ilike('company_name', '%henson%')
    .single()

  if (clientError || !client) {
    console.error('Failed to get client:', clientError)
    process.exit(1)
  }

  console.log(`\nClient: ${client.company_name} (${client.short_code})`)
  console.log(`Period: ${PERIOD_START.toISOString().split('T')[0]} to ${PERIOD_END.toISOString().split('T')[0]}`)

  // Step 1: Collect billing transactions by invoice_id_sb (NOT date range!)
  // The actual cron should use: invoiced_status_jp = false
  // For this test, we use specific invoice_id_sb values to match reference
  console.log('\n1. Collecting billing transactions by invoice_id_sb...')
  console.log(`   Invoice IDs: ${INVOICE_IDS.join(', ')}`)

  let lineItems = await collectBillingTransactionsByInvoiceIds(client.id, INVOICE_IDS)

  console.log(`   Found ${lineItems.length} line items`)

  // Step 2: Apply markups using actual function (with ship_option_id fix)
  console.log('\n2. Applying markup rules...')
  lineItems = await applyMarkupsToLineItems(client.id, lineItems)
  console.log(`   Applied markups to ${lineItems.length} items`)

  // Step 3: Generate summary
  console.log('\n3. Generating summary...')
  const summary = generateSummary(lineItems)
  console.log(`   Subtotal: $${summary.subtotal.toFixed(2)}`)
  console.log(`   Markup: $${summary.totalMarkup.toFixed(2)}`)
  console.log(`   Total: $${summary.totalAmount.toFixed(2)}`)

  // Helper to format dates as YYYY-MM-DD in local time
  const formatLocalDate = (d: Date): string => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Parse date string as local date (not UTC)
  const parseDateAsLocal = (dateStr: string): Date => {
    if (dateStr.length === 10 && dateStr.includes('-')) {
      const [year, month, day] = dateStr.split('-').map(Number)
      return new Date(year, month - 1, day)
    }
    return new Date(dateStr)
  }

  // Step 3.5: Calculate storage period (rounded to half-month)
  const storageDates = lineItems
    .filter(item => item.lineCategory === 'Storage')
    .map(item => parseDateAsLocal(item.transactionDate))

  let storagePeriodStart: Date | undefined
  let storagePeriodEnd: Date | undefined

  if (storageDates.length > 0) {
    const minStorageDate = new Date(Math.min(...storageDates.map(d => d.getTime())))
    const maxStorageDate = new Date(Math.max(...storageDates.map(d => d.getTime())))

    const storageMonth = minStorageDate.getMonth()
    const storageYear = minStorageDate.getFullYear()
    const dayMin = minStorageDate.getDate()
    const dayMax = maxStorageDate.getDate()

    // Round to half-month boundaries
    if (dayMin <= 15 && dayMax > 15) {
      // Full month
      storagePeriodStart = new Date(storageYear, storageMonth, 1)
      storagePeriodEnd = new Date(storageYear, storageMonth + 1, 0)
    } else if (dayMax <= 15) {
      // First half
      storagePeriodStart = new Date(storageYear, storageMonth, 1)
      storagePeriodEnd = new Date(storageYear, storageMonth, 15)
    } else {
      // Second half
      storagePeriodStart = new Date(storageYear, storageMonth, 16)
      storagePeriodEnd = new Date(storageYear, storageMonth + 1, 0)
    }

    console.log(`   Storage period detected: ${formatLocalDate(storagePeriodStart)} to ${formatLocalDate(storagePeriodEnd)}`)
  }

  // Step 4: Build invoice data structure
  const invoiceNumber = `JPHS-0037-120125` // Dec 1, 2025 format
  const invoiceData = {
    invoice: {
      id: 'test-invoice-id',
      invoice_number: invoiceNumber,
      invoice_date: formatLocalDate(INVOICE_DATE),
      period_start: formatLocalDate(PERIOD_START),
      period_end: formatLocalDate(PERIOD_END),
      status: 'draft',
    },
    client: {
      id: client.id,
      company_name: client.company_name,
      short_code: client.short_code,
      merchant_id: client.merchant_id,
      billing_email: client.billing_email || '',
      billing_terms: client.billing_terms || 'due_on_receipt',
    },
    lineItems,
    summary,
  }

  console.log(`   Invoice Date: ${formatLocalDate(INVOICE_DATE)}`)
  console.log(`   Billing Period: ${formatLocalDate(PERIOD_START)} to ${formatLocalDate(PERIOD_END)}`)

  // Step 5: Collect detailed data for 6-sheet XLSX format (by invoice_id_sb)
  console.log('\n4. Collecting detailed billing data for XLSX...')
  const detailedData = await collectDetailedBillingDataByInvoiceIds(client.id, INVOICE_IDS)
  console.log(`   Shipments: ${detailedData.shipments?.length || 0}`)
  console.log(`   Additional Services (shipmentFees): ${detailedData.shipmentFees?.length || 0}`)
  console.log(`   Storage: ${detailedData.storage?.length || 0}`)
  console.log(`   Returns: ${detailedData.returns?.length || 0}`)
  console.log(`   Receiving: ${detailedData.receiving?.length || 0}`)
  console.log(`   Credits: ${detailedData.credits?.length || 0}`)

  // Step 6: Generate Excel file
  console.log('\n5. Generating Excel invoice...')
  const xlsBuffer = await generateExcelInvoice(invoiceData, detailedData)
  console.log(`   Generated XLSX: ${xlsBuffer.length} bytes`)

  // Step 7: Generate PDF file (using subprocess to avoid webpack issues)
  console.log('\n6. Generating PDF invoice...')
  const pdfBuffer = await generatePDFViaSubprocess(invoiceData, {
    storagePeriodStart: storagePeriodStart ? formatLocalDate(storagePeriodStart) : undefined,
    storagePeriodEnd: storagePeriodEnd ? formatLocalDate(storagePeriodEnd) : undefined,
  })
  console.log(`   Generated PDF: ${pdfBuffer.length} bytes`)

  // Step 8: Save to output directory
  const outputDir = path.join(__dirname, 'output')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const xlsPath = path.join(outputDir, `INVOICE-DETAILS-${invoiceNumber}.xlsx`)
  const pdfPath = path.join(outputDir, `${invoiceNumber}.pdf`)

  fs.writeFileSync(xlsPath, xlsBuffer)
  fs.writeFileSync(pdfPath, pdfBuffer)

  console.log('\n' + '='.repeat(70))
  console.log('OUTPUT FILES GENERATED')
  console.log('='.repeat(70))
  console.log(`XLSX: ${xlsPath}`)
  console.log(`PDF:  ${pdfPath}`)

  // Step 9: Compare with reference
  console.log('\n' + '='.repeat(70))
  console.log('VALIDATION vs REFERENCE (JPHS-0037)')
  console.log('='.repeat(70))

  const refCounts = {
    shipments: 1435,
    additionalServices: 1112,
    storage: 981,
    returns: 3,
    receiving: 1,
    credits: 11,
  }

  const refTotals = {
    shipments: 9715.24,
    additionalServices: 765.95,
    storage: 997.94,
    returns: 14.79,
    receiving: 35.00,
    credits: -686.12,
  }

  console.log('\nRow Counts:')
  console.log(`  Shipments: ${detailedData.shipments?.length || 0} (ref: ${refCounts.shipments})`)
  console.log(`  Additional Services: ${detailedData.shipmentFees?.length || 0} (ref: ${refCounts.additionalServices})`)
  console.log(`  Storage: ${detailedData.storage?.length || 0} (ref: ${refCounts.storage})`)
  console.log(`  Returns: ${detailedData.returns?.length || 0} (ref: ${refCounts.returns})`)
  console.log(`  Receiving: ${detailedData.receiving?.length || 0} (ref: ${refCounts.receiving})`)
  console.log(`  Credits: ${detailedData.credits?.length || 0} (ref: ${refCounts.credits})`)

  // Calculate totals from detailed data
  // Note: detailed data has raw amounts, not marked-up amounts
  // The line items have the marked-up amounts
  let shipmentTotal = 0
  for (const item of lineItems.filter(i => i.billingTable === 'shipments')) {
    shipmentTotal += item.billedAmount
  }

  let addServTotal = 0
  for (const item of lineItems.filter(i => i.billingTable === 'shipment_fees')) {
    addServTotal += item.billedAmount
  }

  let storageTotal = 0
  for (const item of lineItems.filter(i => i.billingTable === 'storage')) {
    storageTotal += item.billedAmount
  }

  let returnsTotal = 0
  for (const item of lineItems.filter(i => i.billingTable === 'returns')) {
    returnsTotal += item.billedAmount
  }

  let receivingTotal = 0
  for (const item of lineItems.filter(i => i.billingTable === 'receiving')) {
    receivingTotal += item.billedAmount
  }

  let creditsTotal = 0
  for (const item of lineItems.filter(i => i.billingTable === 'credits')) {
    creditsTotal += item.billedAmount
  }

  console.log('\nTotals:')
  console.log(`  Shipments: $${shipmentTotal.toFixed(2)} (ref: $${refTotals.shipments.toFixed(2)})`)
  console.log(`  Additional Services: $${addServTotal.toFixed(2)} (ref: $${refTotals.additionalServices.toFixed(2)})`)
  console.log(`  Storage: $${storageTotal.toFixed(2)} (ref: $${refTotals.storage.toFixed(2)})`)
  console.log(`  Returns: $${returnsTotal.toFixed(2)} (ref: $${refTotals.returns.toFixed(2)})`)
  console.log(`  Receiving: $${receivingTotal.toFixed(2)} (ref: $${refTotals.receiving.toFixed(2)})`)
  console.log(`  Credits: $${creditsTotal.toFixed(2)} (ref: $${refTotals.credits.toFixed(2)})`)

  const grandTotal = shipmentTotal + addServTotal + storageTotal + returnsTotal + receivingTotal + creditsTotal
  const refGrandTotal = Object.values(refTotals).reduce((a, b) => a + b, 0)

  console.log(`\n  GRAND TOTAL: $${grandTotal.toFixed(2)} (ref: $${refGrandTotal.toFixed(2)})`)
  console.log(`  DIFFERENCE: $${(grandTotal - refGrandTotal).toFixed(2)}`)

  console.log('\n✅ Files generated - please open and verify format matches reference!')
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
