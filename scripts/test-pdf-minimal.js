/**
 * Minimal PDF generation test to isolate React error #31
 */
require('dotenv').config({ path: '.env.local' })

async function main() {
  console.log('Testing minimal PDF generation...\n')

  // Import the PDF generator
  const pdfModule = await import('../lib/billing/pdf-generator.tsx')
  const generatePDFInvoice = pdfModule.generatePDFInvoice

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
        Storage: { count: 1, subtotal: 500, markup: 100, total: 600 },
      },
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

    // Optionally save to file
    const fs = require('fs')
    const path = require('path')
    const outputDir = path.join(__dirname, 'output')
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
    const pdfPath = path.join(outputDir, 'test-minimal.pdf')
    fs.writeFileSync(pdfPath, pdfBuffer)
    console.log(`  Saved to: ${pdfPath}`)
  } catch (err) {
    console.error('\nPDF generation failed:')
    console.error('  Message:', err.message)
    console.error('  Stack:', err.stack)
  }
}

main().catch(console.error)
