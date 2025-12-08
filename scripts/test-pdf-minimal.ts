/**
 * Minimal PDF generation test to isolate React error #31
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

import { createClient } from '@supabase/supabase-js'
import { generatePDFInvoice } from '../lib/billing/pdf-generator'
import {
  collectBillingTransactionsByInvoiceIds,
  applyMarkupsToLineItems,
  generateSummary,
} from '../lib/billing/invoice-generator'
import type { InvoiceData } from '../lib/billing/invoice-generator'
import * as fs from 'fs'
import * as path from 'path'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function testWithMockData() {
  console.log('Testing with MOCK data...\n')

  // Create minimal mock data matching the InvoiceData interface
  const mockData = {
    invoice: {
      id: 'test-id',
      client_id: 'test-client',
      invoice_number: 'JPTEST-0001-120625',
      invoice_date: '2025-12-06',
      period_start: '2025-11-01',
      period_end: '2025-11-30',
      subtotal: 1000.00,
      total_markup: 200.00,
      total_amount: 1200.00,
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
    },
    client: {
      id: 'test-client',
      company_name: 'Test Company',
      short_code: 'TEST',
      billing_email: 'test@example.com',
      billing_terms: 'due_on_receipt',
    },
    lineItems: [
      {
        id: '1',
        billingTable: 'shipments',
        billingRecordId: '1',
        baseAmount: 500.00,
        markupApplied: 100.00,
        billedAmount: 600.00,
        markupRuleId: null,
        markupPercentage: 20,
        lineCategory: 'Shipping',
        description: 'Test Shipment',
        transactionDate: '2025-11-15',
      },
      {
        id: '2',
        billingTable: 'storage',
        billingRecordId: '2',
        baseAmount: 500.00,
        markupApplied: 100.00,
        billedAmount: 600.00,
        markupRuleId: null,
        markupPercentage: 20,
        lineCategory: 'Storage',
        description: 'Test Storage',
        transactionDate: '2025-11-15',
      },
    ],
    summary: {
      subtotal: 1000.00,
      totalMarkup: 200.00,
      totalAmount: 1200.00,
      byCategory: {
        Shipping: { count: 1, subtotal: 500, markup: 100, total: 600 },
        Fulfillment: { count: 0, subtotal: 0, markup: 0, total: 0 },
        'Pick Fees': { count: 0, subtotal: 0, markup: 0, total: 0 },
        'B2B Fees': { count: 0, subtotal: 0, markup: 0, total: 0 },
        'Additional Services': { count: 0, subtotal: 0, markup: 0, total: 0 },
        Returns: { count: 0, subtotal: 0, markup: 0, total: 0 },
        Receiving: { count: 0, subtotal: 0, markup: 0, total: 0 },
        Storage: { count: 1, subtotal: 500, markup: 100, total: 600 },
        Credits: { count: 0, subtotal: 0, markup: 0, total: 0 },
      } as Record<string, { count: number; subtotal: number; markup: number; total: number }>,
    },
  }

  console.log('Mock data created:')
  console.log('  Invoice Number:', mockData.invoice.invoice_number)
  console.log('  Client:', mockData.client.company_name)
  console.log('  Total:', mockData.summary.totalAmount)
  console.log('  Line Items:', mockData.lineItems.length)

  try {
    console.log('\nGenerating PDF...')
    const pdfBuffer = await generatePDFInvoice(mockData)
    console.log(`\nPDF generated successfully!`)
    console.log(`  Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`)

    // Save to file
    const outputDir = path.join(__dirname, 'output')
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
    const pdfPath = path.join(outputDir, 'test-minimal.pdf')
    fs.writeFileSync(pdfPath, pdfBuffer)
    console.log(`  Saved to: ${pdfPath}`)
  } catch (err: unknown) {
    console.error('\nPDF generation failed:')
    if (err instanceof Error) {
      console.error('  Message:', err.message)
      console.error('  Stack:', err.stack)
    } else {
      console.error('  Error:', err)
    }
  }
}

async function testWithRealData() {
  console.log('\n' + '='.repeat(70))
  console.log('Testing with REAL database data...')
  console.log('='.repeat(70) + '\n')

  // Get Henson Shaving client
  const { data: client } = await supabase
    .from('clients')
    .select('id, company_name, short_code, billing_email, billing_terms')
    .eq('company_name', 'Henson Shaving')
    .single()

  if (!client) {
    console.error('Henson Shaving client not found')
    return
  }
  console.log('Client:', client.company_name)

  // Get unprocessed ShipBob invoices
  const { data: unprocessedInvoices } = await supabase
    .from('invoices_sb')
    .select('id, shipbob_invoice_id')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')

  if (!unprocessedInvoices || unprocessedInvoices.length === 0) {
    console.log('No unprocessed invoices found')
    return
  }

  const shipbobInvoiceIds = unprocessedInvoices
    .map(inv => parseInt(inv.shipbob_invoice_id, 10))
    .filter(id => !isNaN(id))

  console.log(`Found ${shipbobInvoiceIds.length} ShipBob invoice IDs`)

  // Collect line items (same as cron does)
  console.log('Collecting billing transactions...')
  let lineItems = await collectBillingTransactionsByInvoiceIds(client.id, shipbobInvoiceIds)
  console.log(`  Found ${lineItems.length} transactions`)

  if (lineItems.length === 0) {
    console.log('No transactions found')
    return
  }

  // Apply markups
  console.log('Applying markups...')
  lineItems = await applyMarkupsToLineItems(client.id, lineItems)

  // Generate summary
  const summary = generateSummary(lineItems)
  console.log(`Summary:`)
  console.log(`  Subtotal: $${summary.subtotal.toFixed(2)}`)
  console.log(`  Markup: $${summary.totalMarkup.toFixed(2)}`)
  console.log(`  Total: $${summary.totalAmount.toFixed(2)}`)

  // Check summary.byCategory for objects
  console.log('\nChecking summary.byCategory types:')
  for (const [cat, data] of Object.entries(summary.byCategory)) {
    console.log(`  ${cat}: count=${typeof data.count}, subtotal=${typeof data.subtotal}`)
  }

  // Parse dates and get period
  const parseDateAsLocal = (dateStr: string): Date => {
    if (dateStr.length === 10 && dateStr.includes('-')) {
      const [year, month, day] = dateStr.split('-').map(Number)
      return new Date(year, month - 1, day)
    }
    return new Date(dateStr)
  }
  const transactionDates = lineItems.map(item => parseDateAsLocal(item.transactionDate))
  const periodStart = new Date(Math.min(...transactionDates.map(d => d.getTime())))
  const periodEnd = new Date(Math.max(...transactionDates.map(d => d.getTime())))

  const formatLocalDate = (d: Date): string => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  // Create invoice data exactly as cron does
  const invoiceData: InvoiceData = {
    invoice: {
      id: 'test-real-data',
      client_id: client.id,
      invoice_number: 'JPHS-TEST-120625',
      invoice_date: formatLocalDate(new Date()),
      period_start: formatLocalDate(periodStart),
      period_end: formatLocalDate(periodEnd),
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
    },
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

  // Log types of all fields
  console.log('\nChecking invoice field types:')
  for (const [key, value] of Object.entries(invoiceData.invoice)) {
    const type = value === null ? 'null' : typeof value
    console.log(`  invoice.${key}: ${type}`)
  }

  console.log('\nChecking client field types:')
  for (const [key, value] of Object.entries(invoiceData.client)) {
    const type = value === null ? 'null' : typeof value
    console.log(`  client.${key}: ${type}`)
  }

  console.log('\nChecking first line item types:')
  const firstItem = lineItems[0]
  for (const [key, value] of Object.entries(firstItem)) {
    const type = value === null ? 'null' : typeof value
    console.log(`  lineItem.${key}: ${type}`)
  }

  try {
    console.log('\nGenerating PDF with real data...')
    const pdfBuffer = await generatePDFInvoice(invoiceData)
    console.log(`\nPDF generated successfully!`)
    console.log(`  Size: ${(pdfBuffer.length / 1024).toFixed(1)} KB`)

    // Save to file
    const outputDir = path.join(__dirname, 'output')
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
    const pdfPath = path.join(outputDir, 'test-real-data.pdf')
    fs.writeFileSync(pdfPath, pdfBuffer)
    console.log(`  Saved to: ${pdfPath}`)
  } catch (err: unknown) {
    console.error('\nPDF generation FAILED:')
    if (err instanceof Error) {
      console.error('  Message:', err.message)
      console.error('  Stack:', err.stack)
    } else {
      console.error('  Error:', err)
    }
  }
}

async function main() {
  await testWithMockData()
  await testWithRealData()
}

main().catch(console.error)
