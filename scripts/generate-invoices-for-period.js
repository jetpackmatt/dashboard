/**
 * Generate invoices for a specific billing period
 *
 * This script selects transactions by ShipBob invoice ID prefix instead of
 * date range, which is more reliable since transaction dates may not align
 * perfectly with invoice periods.
 *
 * Usage: node scripts/generate-invoices-for-period.js
 *
 * Configure the period below before running.
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// ============================================
// CONFIGURE THESE FOR YOUR TEST PERIOD
// ============================================
const CONFIG = {
  // ShipBob invoice ID prefix to match (e.g., '8633' for Dec 1 period)
  // All transactions with invoice_id_sb starting with this prefix will be included
  invoiceIdPrefix: '8633',

  // Period dates for the invoice record (display purposes)
  periodStart: new Date('2025-11-24T00:00:00-05:00'), // Monday Nov 24
  periodEnd: new Date('2025-11-30T23:59:59-05:00'),   // Sunday Nov 30

  // Invoice date (usually the Monday after period ends)
  invoiceDate: new Date('2025-12-01T00:00:00-05:00'), // Monday Dec 1

  // Set to true to actually create invoices, false for dry run
  dryRun: false,
}

// Helper to format date as MMDDYY
function formatDateForInvoice(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const year = String(date.getFullYear()).slice(-2)
  return `${month}${day}${year}`
}

async function main() {
  console.log('='.repeat(60))
  console.log('INVOICE GENERATION FOR SPECIFIC PERIOD')
  console.log('='.repeat(60))
  console.log(`ShipBob Invoice Prefix: ${CONFIG.invoiceIdPrefix}*`)
  console.log(`Period: ${CONFIG.periodStart.toDateString()} - ${CONFIG.periodEnd.toDateString()}`)
  console.log(`Invoice Date: ${CONFIG.invoiceDate.toDateString()}`)
  console.log(`Mode: ${CONFIG.dryRun ? 'DRY RUN' : 'LIVE'}`)
  console.log('='.repeat(60))

  // Get all active clients
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, company_name, short_code, next_invoice_number, billing_email, billing_terms, merchant_id')
    .eq('is_active', true)
    .or('is_internal.is.null,is_internal.eq.false')

  if (clientsError || !clients) {
    console.error('Error fetching clients:', clientsError)
    process.exit(1)
  }

  console.log(`\nFound ${clients.length} active clients`)

  for (const client of clients) {
    console.log(`\n${'─'.repeat(50)}`)
    console.log(`CLIENT: ${client.company_name} (${client.short_code})`)
    console.log('─'.repeat(50))

    if (!client.short_code) {
      console.log('  ⚠️  No short code configured, skipping')
      continue
    }

    // Check if invoice already exists for this period
    const periodStartStr = CONFIG.periodStart.toISOString().split('T')[0]
    const { data: existingInvoice } = await supabase
      .from('invoices_jetpack')
      .select('id, invoice_number')
      .eq('client_id', client.id)
      .eq('period_start', periodStartStr)
      .eq('version', 1)
      .single()

    if (existingInvoice) {
      console.log(`  ⚠️  Invoice already exists: ${existingInvoice.invoice_number}`)
      continue
    }

    // Count transactions matching the ShipBob invoice prefix
    console.log(`  Counting transactions with invoice_id_sb starting with ${CONFIG.invoiceIdPrefix}...`)

    // Calculate the numeric range for the prefix
    // For 7-digit invoice IDs, prefix '8633' means invoice_id_sb >= 8633000 and < 8634000
    const prefixMin = parseInt(CONFIG.invoiceIdPrefix) * 1000
    const prefixMax = (parseInt(CONFIG.invoiceIdPrefix) + 1) * 1000

    // Query with range filter to avoid row limit issues
    const { count: txCount, error: txError } = await supabase
      .from('transactions')
      .select('id', { count: 'exact', head: true })
      .eq('client_id', client.id)
      .is('invoice_id_jp', null) // Not already invoiced by Jetpack
      .gte('invoice_id_sb', prefixMin)
      .lt('invoice_id_sb', prefixMax)

    if (txError) {
      console.log(`  ❌ Error fetching transactions: ${txError.message}`)
      continue
    }

    console.log(`  Transactions found: ${txCount || 0}`)

    if (!txCount || txCount === 0) {
      console.log('  ⚠️  No transactions for this period')
      continue
    }

    // Generate invoice number
    const invoiceNumber = `JP${client.short_code}-${String(client.next_invoice_number).padStart(4, '0')}-${formatDateForInvoice(CONFIG.invoiceDate)}`
    console.log(`  Invoice number: ${invoiceNumber}`)

    if (CONFIG.dryRun) {
      console.log('  [DRY RUN] Would create invoice')
      continue
    }

    // Call the API to generate the invoice
    // We'll need to use the API since it has all the complex logic
    console.log('  Generating via API...')

    // Actually, let's create the invoice record directly and then generate files
    // This is simpler for a test script
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices_jetpack')
      .insert({
        client_id: client.id,
        invoice_number: invoiceNumber,
        invoice_date: CONFIG.invoiceDate.toISOString().split('T')[0],
        period_start: CONFIG.periodStart.toISOString().split('T')[0],
        period_end: CONFIG.periodEnd.toISOString().split('T')[0],
        subtotal: 0,       // Will be updated by regenerate
        total_markup: 0,   // Will be updated by regenerate
        total_amount: 0,   // Will be updated by regenerate
        status: 'draft',  // UI shows 'draft' in "Pending Approval" section
        generated_at: new Date().toISOString(),
        version: 1,
      })
      .select()
      .single()

    if (invoiceError) {
      console.error(`  ❌ Error creating invoice: ${invoiceError.message}`)
      continue
    }

    console.log(`  ✅ Created invoice record: ${invoice.id}`)

    // Mark all transactions in this period with the invoice number (human-readable format)
    // This is CRITICAL - regenerate only looks at transactions already marked with invoice_id_jp
    console.log(`  Marking transactions with invoice_id_jp = ${invoiceNumber}...`)
    const { data: marked, error: markError } = await supabase
      .from('transactions')
      .update({
        invoice_id_jp: invoiceNumber, // Use human-readable invoice number, not UUID
        invoiced_status_jp: 'pending',
        invoice_date_jp: CONFIG.invoiceDate.toISOString().split('T')[0],
      })
      .eq('client_id', client.id)
      .is('invoice_id_jp', null)
      .gte('invoice_id_sb', prefixMin)
      .lt('invoice_id_sb', prefixMax)
      .select('id')

    if (markError) {
      console.error(`  ⚠️  Error marking transactions: ${markError.message}`)
    } else {
      console.log(`  ✅ Marked ${marked?.length || 0} transactions`)
    }

    // Increment next_invoice_number
    await supabase
      .from('clients')
      .update({ next_invoice_number: client.next_invoice_number + 1 })
      .eq('id', client.id)

    console.log(`  ✅ Incremented next_invoice_number to ${client.next_invoice_number + 1}`)
    console.log(`  ℹ️  Use the admin UI to regenerate files for this invoice`)
  }

  console.log(`\n${'='.repeat(60)}`)
  console.log('COMPLETE')
  console.log('='.repeat(60))
  console.log('\nNext steps:')
  console.log('1. Go to Admin > Run Invoicing in the dashboard')
  console.log('2. The invoices should appear in "Pending Approval"')
  console.log('3. Use "Regenerate" to generate PDF/XLS files')
}

main().catch(console.error)
