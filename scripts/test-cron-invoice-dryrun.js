/**
 * Dry-run test of the actual invoice generation cron job
 *
 * Runs the exact same code path as /api/cron/generate-invoices
 * but does NOT:
 * - Create invoice records in invoices_jetpack
 * - Store files in Supabase storage
 * - Mark transactions as invoiced
 * - Mark ShipBob invoices as processed
 *
 * DOES:
 * - Query exactly like the cron does
 * - Generate line items with markups
 * - Generate XLSX and PDF buffers
 * - Report what WOULD be created
 *
 * Usage:
 *   node scripts/test-cron-invoice-dryrun.js
 *   node scripts/test-cron-invoice-dryrun.js --save-xlsx   # Also save XLSX files to scripts/output/
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const fs = require('fs')
const path = require('path')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const saveXlsx = process.argv.includes('--save-xlsx')

async function main() {
  console.log('='.repeat(70))
  console.log('CRON INVOICE GENERATION - DRY RUN')
  console.log('='.repeat(70))
  console.log('This simulates exactly what the Monday cron job will do.')
  console.log('NO changes will be made to the database.\n')

  // Import the actual invoice generator functions
  // We need to use dynamic import for ESM modules
  const invoiceGenerator = await import('../lib/billing/invoice-generator.ts')
  const {
    collectBillingTransactionsByInvoiceIds,
    collectDetailedBillingDataByInvoiceIds,
    applyMarkupsToLineItems,
    generateSummary,
    generateExcelInvoice,
    generatePDFInvoice,
  } = invoiceGenerator

  // Step 1: Calculate invoice date (this Monday)
  const today = new Date()
  const dayOfWeek = today.getDay()
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const invoiceDate = new Date(today)
  invoiceDate.setDate(today.getDate() - daysToMonday)
  invoiceDate.setHours(0, 0, 0, 0)
  console.log(`Invoice date: ${invoiceDate.toISOString().split('T')[0]}`)

  // Step 2: Get all active clients (excluding internal)
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, company_name, short_code, next_invoice_number, billing_email, billing_terms')
    .eq('is_active', true)
    .or('is_internal.is.null,is_internal.eq.false')

  if (clientsError || !clients) {
    console.error('Error fetching clients:', clientsError)
    return
  }
  console.log(`Found ${clients.length} active clients: ${clients.map(c => c.company_name).join(', ')}`)

  // Step 3: Get unprocessed ShipBob invoices
  const { data: unprocessedInvoices, error: invoicesError } = await supabase
    .from('invoices_sb')
    .select('id, shipbob_invoice_id, invoice_type, base_amount, invoice_date')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')
    .order('invoice_date', { ascending: true })

  if (invoicesError) {
    console.error('Error fetching unprocessed invoices:', invoicesError)
    return
  }

  if (!unprocessedInvoices || unprocessedInvoices.length === 0) {
    console.log('\n*** No unprocessed ShipBob invoices found ***')
    console.log('The cron job would exit here with "No unprocessed ShipBob invoices"')
    return
  }

  const shipbobInvoiceIds = unprocessedInvoices
    .map(inv => parseInt(inv.shipbob_invoice_id, 10))
    .filter(id => !isNaN(id))

  console.log(`\nFound ${unprocessedInvoices.length} unprocessed ShipBob invoices:`)
  for (const inv of unprocessedInvoices) {
    console.log(`  - ${inv.shipbob_invoice_id} (${inv.invoice_type}) $${Number(inv.base_amount).toFixed(2)} [${inv.invoice_date}]`)
  }

  const results = []

  for (const client of clients) {
    if (!client.short_code) {
      console.log(`\n[${client.company_name}] SKIPPED - No short code configured`)
      continue
    }

    console.log(`\n${'='.repeat(70)}`)
    console.log(`[${client.company_name}] Processing...`)
    console.log('='.repeat(70))

    try {
      // Step 4: Collect billing transactions (exactly like cron)
      let lineItems = await collectBillingTransactionsByInvoiceIds(client.id, shipbobInvoiceIds)

      if (lineItems.length === 0) {
        console.log(`  No transactions for this client in these invoices, skipping`)
        continue
      }
      console.log(`  Found ${lineItems.length} transactions`)

      // Step 5: Apply markups
      lineItems = await applyMarkupsToLineItems(client.id, lineItems)

      // Count by category
      const categoryCounts = {}
      for (const item of lineItems) {
        const cat = item.lineCategory || 'Unknown'
        categoryCounts[cat] = (categoryCounts[cat] || 0) + 1
      }
      console.log(`  Categories:`)
      for (const [cat, count] of Object.entries(categoryCounts)) {
        console.log(`    - ${cat}: ${count}`)
      }

      // Step 6: Generate summary
      const summary = generateSummary(lineItems)
      console.log(`  Summary:`)
      console.log(`    Subtotal (base):  $${summary.subtotal.toFixed(2)}`)
      console.log(`    Total Markup:     $${summary.totalMarkup.toFixed(2)}`)
      console.log(`    Total Amount:     $${summary.totalAmount.toFixed(2)}`)

      // Determine period
      const parseDateAsLocal = (dateStr) => {
        if (dateStr && dateStr.length === 10 && dateStr.includes('-')) {
          const [year, month, day] = dateStr.split('-').map(Number)
          return new Date(year, month - 1, day)
        }
        return new Date(dateStr)
      }
      const transactionDates = lineItems.map(item => parseDateAsLocal(item.transactionDate))
      const periodStart = new Date(Math.min(...transactionDates.map(d => d.getTime())))
      const periodEnd = new Date(Math.max(...transactionDates.map(d => d.getTime())))
      console.log(`  Period: ${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}`)

      // Generate invoice number (what WOULD be used)
      const formatDateForInvoice = (d) => {
        const month = String(d.getMonth() + 1).padStart(2, '0')
        const day = String(d.getDate()).padStart(2, '0')
        const year = String(d.getFullYear()).slice(-2)
        return `${month}${day}${year}`
      }
      const invoiceNumber = `JP${client.short_code}-${String(client.next_invoice_number).padStart(4, '0')}-${formatDateForInvoice(invoiceDate)}`
      console.log(`  Invoice Number: ${invoiceNumber}`)

      // Step 7: Collect detailed data for XLSX (exactly like cron)
      const detailedData = await collectDetailedBillingDataByInvoiceIds(client.id, shipbobInvoiceIds)
      console.log(`  Detailed data collected:`)
      console.log(`    - Shipments: ${detailedData.shipments.length}`)
      console.log(`    - Shipment Fees: ${detailedData.shipmentFees.length}`)
      console.log(`    - Returns: ${detailedData.returns.length}`)
      console.log(`    - Receiving: ${detailedData.receiving.length}`)
      console.log(`    - Storage: ${detailedData.storage.length}`)
      console.log(`    - Credits: ${detailedData.credits.length}`)

      // Check returns timestamps
      if (detailedData.returns.length > 0) {
        console.log(`  Returns timestamp check:`)
        for (const ret of detailedData.returns.slice(0, 3)) {
          const hasFullTimestamp = ret.return_creation_date && ret.return_creation_date.includes('T')
          console.log(`    - Return ${ret.return_id}: ${ret.return_creation_date} ${hasFullTimestamp ? '(FULL)' : '(DATE ONLY)'}`)
        }
        if (detailedData.returns.length > 3) {
          console.log(`    ... and ${detailedData.returns.length - 3} more`)
        }
      }

      // Step 8: Generate files (in memory only)
      const invoiceData = {
        invoice: {
          id: 'DRY-RUN',
          invoice_number: invoiceNumber,
          invoice_date: invoiceDate.toISOString().split('T')[0],
          period_start: periodStart.toISOString().split('T')[0],
          period_end: periodEnd.toISOString().split('T')[0],
          subtotal: summary.subtotal,
          total_markup: summary.totalMarkup,
          total_amount: summary.totalAmount,
          status: 'draft',
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

      console.log(`  Generating XLSX...`)
      const xlsBuffer = await generateExcelInvoice(invoiceData, detailedData)
      console.log(`  XLSX generated: ${(xlsBuffer.length / 1024).toFixed(1)} KB`)

      console.log(`  Generating PDF...`)
      const pdfBuffer = await generatePDFInvoice(invoiceData)
      console.log(`  PDF generated: ${(pdfBuffer.length / 1024).toFixed(1)} KB`)

      // Optionally save XLSX
      if (saveXlsx) {
        const outputDir = path.join(__dirname, 'output')
        if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
        const xlsxPath = path.join(outputDir, `${invoiceNumber}-DRYRUN.xlsx`)
        fs.writeFileSync(xlsxPath, xlsBuffer)
        console.log(`  XLSX saved to: ${xlsxPath}`)
      }

      results.push({
        client: client.company_name,
        invoiceNumber,
        transactions: lineItems.length,
        subtotal: summary.subtotal,
        markup: summary.totalMarkup,
        total: summary.totalAmount,
        xlsxSize: xlsBuffer.length,
        pdfSize: pdfBuffer.length,
      })

      console.log(`  [OK] Would generate invoice ${invoiceNumber}`)
    } catch (err) {
      console.error(`  [ERROR] ${err.message}`)
      console.error(err.stack)
    }
  }

  // Final summary
  console.log(`\n${'='.repeat(70)}`)
  console.log('DRY RUN COMPLETE')
  console.log('='.repeat(70))
  console.log(`\nWould generate ${results.length} invoice(s):\n`)
  for (const r of results) {
    console.log(`  ${r.invoiceNumber} (${r.client})`)
    console.log(`    ${r.transactions} transactions | $${r.subtotal.toFixed(2)} base | $${r.markup.toFixed(2)} markup | $${r.total.toFixed(2)} total`)
  }
  console.log(`\nNO DATABASE CHANGES WERE MADE.`)
  console.log(`To run the actual cron, call: curl -H "Authorization: Bearer $CRON_SECRET" localhost:3000/api/cron/generate-invoices`)
}

main().catch(console.error)
