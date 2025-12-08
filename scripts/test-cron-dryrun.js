/**
 * Dry-run test of the Monday cron invoice generation
 * Mirrors the exact flow in /api/cron/generate-invoices
 *
 * Usage: node scripts/test-cron-dryrun.js
 *
 * Add --commit to actually mark invoices as processed (use with caution!)
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DRY_RUN = !process.argv.includes('--commit')

async function main() {
  console.log('='.repeat(70))
  console.log('CRON DRY-RUN TEST')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : '⚠️  COMMIT MODE - will mark as processed!'}`)
  console.log('='.repeat(70))

  // Step 1: Get all active clients
  console.log('\n1. Fetching active clients...')
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, company_name, short_code, next_invoice_number, billing_email, billing_terms')
    .eq('is_active', true)

  if (clientsError || !clients) {
    console.error('Error fetching clients:', clientsError)
    process.exit(1)
  }
  console.log(`   Found ${clients.length} active clients:`)
  clients.forEach(c => console.log(`   - ${c.company_name} (${c.short_code})`))

  // Step 2: Get ALL unprocessed ShipBob invoices (PARENT TOKEN level)
  // Use invoices_sb table (correct synced table), exclude Payment type (not billable)
  console.log('\n2. Fetching unprocessed ShipBob invoices (jetpack_invoice_id IS NULL)...')
  const { data: unprocessedInvoices, error: invoicesError } = await supabase
    .from('invoices_sb')
    .select('id, shipbob_invoice_id, invoice_type, invoice_date, base_amount')
    .is('jetpack_invoice_id', null)
    .neq('invoice_type', 'Payment')
    .order('invoice_date', { ascending: true })

  if (invoicesError) {
    console.error('Error fetching unprocessed invoices:', invoicesError)
    process.exit(1)
  }

  if (!unprocessedInvoices || unprocessedInvoices.length === 0) {
    console.log('   No unprocessed ShipBob invoices found!')
    console.log('\n   This means either:')
    console.log('   a) All invoices have been processed already')
    console.log('   b) The jetpack_invoice_id column was just added and needs data')
    console.log('\n   To test with specific invoices, reset them:')
    console.log('   UPDATE invoices_sb SET jetpack_invoice_id = NULL WHERE shipbob_invoice_id IN (...)')
    process.exit(0)
  }

  // Convert TEXT shipbob_invoice_id to INTEGER for transactions query
  const shipbobInvoiceIds = unprocessedInvoices
    .map(inv => parseInt(inv.shipbob_invoice_id, 10))
    .filter(id => !isNaN(id))

  console.log(`   Found ${unprocessedInvoices.length} unprocessed ShipBob invoices:`)
  unprocessedInvoices.forEach(inv => {
    console.log(`   - ${inv.shipbob_invoice_id} (${inv.invoice_type}) ${inv.invoice_date} $${inv.base_amount}`)
  })
  console.log(`\n   Invoice IDs for transaction query: [${shipbobInvoiceIds.join(', ')}]`)

  // Step 3: For each client, check what transactions they have
  console.log('\n3. Checking transactions per client...')

  const results = []

  for (const client of clients) {
    if (!client.short_code) {
      console.log(`\n   ${client.company_name}: SKIP (no short_code)`)
      continue
    }

    // Query transactions by invoice_id_sb AND client_id
    // IMPORTANT: Use pagination - Supabase defaults to 1000 row limit!
    const allTransactions = []
    for (const invoiceId of shipbobInvoiceIds) {
      let offset = 0
      while (true) {
        const { data: batch, error: batchError } = await supabase
          .from('transactions')
          .select('id, reference_type, transaction_fee, cost, invoice_id_sb')
          .eq('client_id', client.id)
          .eq('invoice_id_sb', invoiceId)
          .range(offset, offset + 999)

        if (batchError) {
          console.error(`   Error fetching transactions for ${client.company_name}:`, batchError)
          break
        }
        if (!batch || batch.length === 0) break
        allTransactions.push(...batch)
        if (batch.length < 1000) break
        offset += 1000
      }
    }

    const transactions = allTransactions

    if (transactions.length === 0) {
      console.log(`\n   ${client.company_name}: No transactions for these invoices`)
      continue
    }

    // Summarize by category
    const summary = {
      shipments: 0,
      shipmentFees: 0,
      storage: 0,
      returns: 0,
      receiving: 0,
      credits: 0,
      totalCost: 0,
    }

    for (const tx of transactions) {
      const cost = Number(tx.cost) || 0
      summary.totalCost += cost

      if (tx.transaction_fee === 'Credit') {
        summary.credits++
      } else if (tx.reference_type === 'Shipment') {
        if (tx.transaction_fee === 'Shipping') {
          summary.shipments++
        } else {
          summary.shipmentFees++
        }
      } else if (tx.reference_type === 'FC') {
        summary.storage++
      } else if (tx.reference_type === 'Return') {
        summary.returns++
      } else if (tx.reference_type === 'WRO') {
        summary.receiving++
      }
    }

    console.log(`\n   ${client.company_name}:`)
    console.log(`     Total transactions: ${transactions.length}`)
    console.log(`     Shipments: ${summary.shipments}`)
    console.log(`     Additional Services: ${summary.shipmentFees}`)
    console.log(`     Storage: ${summary.storage}`)
    console.log(`     Returns: ${summary.returns}`)
    console.log(`     Receiving: ${summary.receiving}`)
    console.log(`     Credits: ${summary.credits}`)
    console.log(`     Raw cost total: $${summary.totalCost.toFixed(2)}`)

    // Calculate invoice number that would be generated
    const invoiceDate = new Date()
    const dayOfWeek = invoiceDate.getDay()
    const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
    invoiceDate.setDate(invoiceDate.getDate() - daysToMonday)

    const mm = String(invoiceDate.getMonth() + 1).padStart(2, '0')
    const dd = String(invoiceDate.getDate()).padStart(2, '0')
    const yy = String(invoiceDate.getFullYear()).slice(-2)
    const invoiceNumber = `JP${client.short_code}-${String(client.next_invoice_number).padStart(4, '0')}-${mm}${dd}${yy}`

    console.log(`     Would generate: ${invoiceNumber}`)

    results.push({
      client: client.company_name,
      shortCode: client.short_code,
      invoiceNumber,
      transactions: transactions.length,
      rawCost: summary.totalCost,
    })
  }

  // Summary
  console.log('\n' + '='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))

  if (results.length === 0) {
    console.log('No invoices would be generated (no transactions for any client)')
  } else {
    console.log(`Would generate ${results.length} invoice(s):`)
    results.forEach(r => {
      console.log(`  - ${r.invoiceNumber} for ${r.client}: ${r.transactions} transactions, $${r.rawCost.toFixed(2)} raw`)
    })

    console.log(`\nShipBob invoices that would be marked:`)
    const invoiceNumbers = results.map(r => r.invoiceNumber).join(', ')
    console.log(`  jetpack_invoice_id = "${invoiceNumbers}"`)
    console.log(`  Applied to ${unprocessedInvoices.length} ShipBob invoice records`)
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes made. Use --commit to actually process.')
  }
}

main().catch(console.error)
