#!/usr/bin/env npx tsx
/**
 * Generate Invoice Files - Creates actual PDF + XLS using the real invoice generator
 *
 * Usage: npx tsx scripts/generate-invoice-files.ts
 */

import { createAdminClient } from '../lib/supabase/admin'
import {
  collectBillingTransactionsByInvoiceIds,
  collectDetailedBillingDataByInvoiceIds,
  applyMarkupsToLineItems,
  generateSummary,
  generateExcelInvoice,
} from '../lib/billing/invoice-generator'
import { generatePDFInvoice } from '../lib/billing/pdf-generator'
import * as fs from 'fs'
import * as path from 'path'

// Test with JPHS-0037 invoice IDs (Nov 24 - Nov 30 week)
const INVOICE_IDS = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]
const HENSON_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function main() {
  console.log('═'.repeat(70))
  console.log('  INVOICE FILE GENERATION')
  console.log('═'.repeat(70))

  const supabase = createAdminClient()

  // Get client info
  const { data: client } = await supabase
    .from('clients')
    .select('id, company_name, short_code, next_invoice_number, billing_email, billing_terms')
    .eq('id', HENSON_CLIENT_ID)
    .single()

  if (!client) {
    console.error('Client not found')
    process.exit(1)
  }

  console.log(`\nClient: ${client.company_name} (${client.short_code})`)
  console.log(`Invoice IDs: ${INVOICE_IDS.join(', ')}`)

  // Step 1: Collect transactions
  console.log('\n1. Collecting transactions...')
  let lineItems = await collectBillingTransactionsByInvoiceIds(client.id, INVOICE_IDS)
  console.log(`   Found ${lineItems.length} transactions`)

  // Step 2: Apply markups
  console.log('\n2. Applying markup rules...')
  lineItems = await applyMarkupsToLineItems(client.id, lineItems)

  // Step 3: Generate summary
  console.log('\n3. Generating summary...')
  const summary = generateSummary(lineItems)

  console.log(`   Subtotal: $${summary.subtotal.toFixed(2)}`)
  console.log(`   Markup: $${summary.totalMarkup.toFixed(2)}`)
  console.log(`   Total: $${summary.totalAmount.toFixed(2)}`)

  // Calculate period from transaction dates
  // IMPORTANT: Parse dates as local time to avoid timezone shift
  // A date string like "2025-11-24" is UTC midnight, which shifts to Nov 23 in Pacific time
  const parseDateAsLocal = (dateStr: string): Date => {
    // If it's a date-only string (YYYY-MM-DD), parse as local midnight
    if (dateStr.length === 10 && dateStr.includes('-')) {
      const [year, month, day] = dateStr.split('-').map(Number)
      return new Date(year, month - 1, day) // month is 0-indexed
    }
    // If it's a full ISO timestamp, use it directly
    return new Date(dateStr)
  }

  const dates = lineItems.map(item => parseDateAsLocal(item.transactionDate))
  const periodStart = new Date(Math.min(...dates.map(d => d.getTime())))
  const periodEnd = new Date(Math.max(...dates.map(d => d.getTime())))

  // Format date as YYYY-MM-DD in local time (avoiding UTC conversion)
  const formatLocalDate = (d: Date): string => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Invoice date = this Monday (the day the invoice is issued)
  // Calculate Monday of current week in LOCAL time
  const now = new Date()
  const dayOfWeek = now.getDay()
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const invoiceDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysToMonday)

  const mm = String(invoiceDate.getMonth() + 1).padStart(2, '0')
  const dd = String(invoiceDate.getDate()).padStart(2, '0')
  const yy = String(invoiceDate.getFullYear()).slice(-2)
  const invoiceNumber = `JP${client.short_code}-${String(client.next_invoice_number).padStart(4, '0')}-${mm}${dd}${yy}`

  console.log(`\n4. Invoice: ${invoiceNumber}`)
  console.log(`   Invoice Date: ${formatLocalDate(invoiceDate)}`)
  console.log(`   Period: ${formatLocalDate(periodStart)} to ${formatLocalDate(periodEnd)}`)

  // Build invoice data
  const invoice = {
    id: 'test-invoice-id',
    client_id: client.id,
    invoice_number: invoiceNumber,
    invoice_date: formatLocalDate(invoiceDate),
    period_start: formatLocalDate(periodStart),
    period_end: formatLocalDate(periodEnd),
    subtotal: summary.subtotal,
    total_markup: summary.totalMarkup,
    total_amount: summary.totalAmount,
    status: 'draft' as const,
    generated_at: new Date().toISOString(),
    regeneration_locked_at: null,
    xlsx_path: null,
    pdf_path: null,
    approved_at: null,
    approved_by: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const invoiceData = {
    invoice,
    client: {
      id: client.id,
      company_name: client.company_name,
      short_code: client.short_code,
      billing_email: client.billing_email,
      billing_terms: client.billing_terms || 'due_on_receipt',
    },
    lineItems,
    summary,
  }

  // Step 5: Collect detailed data for XLSX
  console.log('\n5. Collecting detailed data for XLSX...')
  const detailedData = await collectDetailedBillingDataByInvoiceIds(client.id, INVOICE_IDS)
  console.log(`   Shipments: ${detailedData.shipments.length}`)
  console.log(`   Shipment Fees: ${detailedData.shipmentFees.length}`)
  console.log(`   Returns: ${detailedData.returns.length}`)
  console.log(`   Receiving: ${detailedData.receiving.length}`)
  console.log(`   Storage: ${detailedData.storage.length}`)
  console.log(`   Credits: ${detailedData.credits.length}`)

  // Step 6: Generate XLSX
  console.log('\n6. Generating XLSX...')
  const xlsBuffer = await generateExcelInvoice(invoiceData, detailedData)
  console.log(`   XLS buffer size: ${xlsBuffer.length} bytes`)

  // Step 7: Generate PDF
  console.log('\n7. Generating PDF...')
  const pdfBuffer = await generatePDFInvoice(invoiceData)
  console.log(`   PDF buffer size: ${pdfBuffer.length} bytes`)

  // Step 8: Save files locally
  const outputDir = path.join(__dirname, 'output')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  const xlsPath = path.join(outputDir, `INVOICE-DETAILS-${invoiceNumber}.xlsx`)
  const pdfPath = path.join(outputDir, `${invoiceNumber}.pdf`)

  fs.writeFileSync(xlsPath, xlsBuffer)
  fs.writeFileSync(pdfPath, pdfBuffer)

  console.log('\n' + '═'.repeat(70))
  console.log('  FILES GENERATED')
  console.log('═'.repeat(70))
  console.log(`\n  XLS: ${xlsPath}`)
  console.log(`  PDF: ${pdfPath}`)

  // Summary
  console.log('\n' + '─'.repeat(70))
  console.log('INVOICE SUMMARY')
  console.log('─'.repeat(70))
  console.log(`Invoice: ${invoiceNumber}`)
  console.log(`Client: ${client.company_name}`)
  console.log(`Period: ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}`)
  console.log(`\nBreakdown by Category:`)

  for (const [category, data] of Object.entries(summary.byCategory)) {
    if (data.count > 0) {
      console.log(`  ${category}: ${data.count} items, $${data.total.toFixed(2)}`)
    }
  }

  console.log(`\n  Subtotal: $${summary.subtotal.toFixed(2)}`)
  console.log(`  Markup: $${summary.totalMarkup.toFixed(2)}`)
  console.log(`  TOTAL: $${summary.totalAmount.toFixed(2)}`)
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
