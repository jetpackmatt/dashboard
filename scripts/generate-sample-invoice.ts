#!/usr/bin/env npx tsx
/**
 * Generate Sample Invoice Files
 *
 * Creates sample XLSX and PDF files locally without saving to database.
 * Useful for verifying invoice format and content before going live.
 */

import { createAdminClient } from '../lib/supabase/admin'
import {
  collectBillingTransactions,
  collectDetailedBillingData,
  applyMarkupsToLineItems,
  generateSummary,
  generateExcelInvoice,
} from '../lib/billing/invoice-generator'
import { generatePDFInvoice } from '../lib/billing/pdf-generator'
import type { JetpackInvoice, InvoiceData } from '../lib/billing/invoice-generator'
import fs from 'fs'
import path from 'path'

async function main() {
  console.log('=== Generate Sample Invoice ===\n')

  const supabase = createAdminClient()

  // Get period dates (Nov 24 - Nov 30, 2025) - matching reference invoice
  const periodStart = new Date('2025-11-24')
  const periodEnd = new Date('2025-11-30')
  const invoiceDate = new Date('2025-12-01')

  // Get Henson client
  const { data: client, error: clientError } = await supabase
    .from('clients')
    .select('id, company_name, short_code, next_invoice_number, billing_email, billing_terms')
    .eq('short_code', 'HS')
    .single()

  if (clientError || !client) {
    console.error('Error fetching client:', clientError)
    process.exit(1)
  }

  console.log(`Client: ${client.company_name} (${client.short_code})`)
  console.log(`Period: ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}\n`)

  // Collect transactions
  console.log('Collecting transactions...')
  let lineItems = await collectBillingTransactions(client.id, periodStart, periodEnd)
  console.log(`  Found ${lineItems.length} transactions`)

  // Apply markups
  console.log('Applying markups...')
  lineItems = await applyMarkupsToLineItems(client.id, lineItems)

  // Generate summary
  const summary = generateSummary(lineItems)
  console.log('\nSummary:')
  console.log(`  Subtotal (ShipBob): $${summary.subtotal.toFixed(2)}`)
  console.log(`  Total Markup: $${summary.totalMarkup.toFixed(2)}`)
  console.log(`  Total Amount: $${summary.totalAmount.toFixed(2)}`)

  console.log('\nBy Category:')
  for (const [category, stats] of Object.entries(summary.byCategory)) {
    if (stats.count > 0) {
      console.log(`  ${category}: ${stats.count} items, $${stats.total.toFixed(2)}`)
    }
  }

  // Create fake invoice record for generation
  const invoiceNumber = `JP${client.short_code}-${String(client.next_invoice_number).padStart(4, '0')}-TEST`
  const fakeInvoice: JetpackInvoice = {
    id: 'test-invoice-id',
    client_id: client.id,
    invoice_number: invoiceNumber,
    invoice_date: invoiceDate.toISOString().split('T')[0],
    period_start: periodStart.toISOString().split('T')[0],
    period_end: periodEnd.toISOString().split('T')[0],
    subtotal: summary.subtotal,
    total_markup: summary.totalMarkup,
    total_amount: summary.totalAmount,
    pdf_path: null,
    xlsx_path: null,
    status: 'draft',
    generated_at: new Date().toISOString(),
    approved_by: null,
    approved_at: null,
    approval_notes: null,
    version: 1,
    replaced_by: null,
    regeneration_locked_at: null,
    email_sent_at: null,
    email_error: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }

  const invoiceData: InvoiceData = {
    invoice: fakeInvoice,
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

  // Get detailed data for XLSX
  console.log('\nCollecting detailed data for XLSX...')
  const detailedData = await collectDetailedBillingData(client.id, periodStart, periodEnd)
  console.log(`  Shipments: ${detailedData.shipments.length}`)
  console.log(`  Fees: ${detailedData.shipmentFees.length}`)
  console.log(`  Storage: ${detailedData.storage.length}`)
  console.log(`  Credits: ${detailedData.credits.length}`)
  console.log(`  Returns: ${detailedData.returns.length}`)
  console.log(`  Receiving: ${detailedData.receiving.length}`)

  // Generate XLSX
  console.log('\nGenerating XLSX...')
  const xlsBuffer = await generateExcelInvoice(invoiceData, detailedData)

  // Generate PDF with storage period and client address
  console.log('Generating PDF...')
  const pdfBuffer = await generatePDFInvoice(invoiceData, {
    storagePeriodStart: '2025-11-16',
    storagePeriodEnd: '2025-11-30',
    clientAddress: {
      street: '123 Shaving Lane',
      city: 'Toronto',
      region: 'ON',
      postalCode: 'M5V 1J1',
      country: 'CANADA',
    },
  })

  // Create output directory
  const outputDir = path.join(process.cwd(), 'scripts', 'output')
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }

  // Save files
  const xlsPath = path.join(outputDir, `${invoiceNumber}.xlsx`)
  const pdfPath = path.join(outputDir, `${invoiceNumber}.pdf`)

  fs.writeFileSync(xlsPath, xlsBuffer)
  console.log(`\nSaved: ${xlsPath}`)

  fs.writeFileSync(pdfPath, pdfBuffer)
  console.log(`Saved: ${pdfPath}`)

  console.log('\n=== Done ===')
  console.log('Open the files to verify format and content.')
}

main().catch(console.error)
