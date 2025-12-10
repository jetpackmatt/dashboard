/**
 * Backfill script for invoice date fields
 *
 * This script fixes two issues:
 * 1. invoices_jetpack: Corrects period_start and period_end based on invoice_date
 *    - period_end = invoice_date - 1 day (always Sunday)
 *    - period_start = Monday of that week (7 days before period_end + 1)
 *
 * 2. transactions: Backfills invoice_date_jp from linked invoices_jetpack
 *
 * Usage: node scripts/backfill-invoice-dates.js [--dry-run]
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DRY_RUN = process.argv.includes('--dry-run')

/**
 * Get the Monday of the week containing the given date
 */
function getMondayOfWeek(date) {
  const d = new Date(date)
  const day = d.getUTCDay() // 0 = Sunday, 1 = Monday, etc.
  const diff = day === 0 ? 6 : day - 1 // Days to subtract to get to Monday
  d.setUTCDate(d.getUTCDate() - diff)
  return d
}

/**
 * Format date as YYYY-MM-DD
 */
function formatDate(date) {
  return date.toISOString().split('T')[0]
}

async function fixInvoicePeriods() {
  console.log('\n' + '='.repeat(60))
  console.log('STEP 1: Fix period_start and period_end on invoices_jetpack')
  console.log('='.repeat(60))

  // Get all invoices
  const { data: invoices, error } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, invoice_date, period_start, period_end')
    .order('invoice_date', { ascending: true })

  if (error) {
    console.error('Error fetching invoices:', error)
    return { success: false, updated: 0 }
  }

  console.log(`Found ${invoices.length} invoices to check`)

  let updated = 0
  let skipped = 0
  const updates = []

  for (const invoice of invoices) {
    if (!invoice.invoice_date) {
      console.log(`  ⚠️  ${invoice.invoice_number}: No invoice_date, skipping`)
      skipped++
      continue
    }

    // Parse invoice_date (it's YYYY-MM-DD string)
    const invoiceDate = new Date(invoice.invoice_date + 'T00:00:00Z')

    // Calculate correct period_end (day before invoice_date)
    const periodEnd = new Date(invoiceDate)
    periodEnd.setUTCDate(periodEnd.getUTCDate() - 1)

    // Calculate correct period_start (Monday of the week containing period_end)
    const periodStart = getMondayOfWeek(periodEnd)

    const correctPeriodStart = formatDate(periodStart)
    const correctPeriodEnd = formatDate(periodEnd)

    // Check if needs update
    const needsUpdate = invoice.period_start !== correctPeriodStart ||
                        invoice.period_end !== correctPeriodEnd

    if (needsUpdate) {
      console.log(`  📝 ${invoice.invoice_number}:`)
      console.log(`     invoice_date: ${invoice.invoice_date}`)
      console.log(`     period_start: ${invoice.period_start} → ${correctPeriodStart}`)
      console.log(`     period_end:   ${invoice.period_end} → ${correctPeriodEnd}`)

      updates.push({
        id: invoice.id,
        invoice_number: invoice.invoice_number,
        period_start: correctPeriodStart,
        period_end: correctPeriodEnd,
      })
    } else {
      skipped++
    }
  }

  console.log(`\nNeed to update: ${updates.length}`)
  console.log(`Already correct: ${skipped}`)

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would update the above invoices')
    return { success: true, updated: 0, wouldUpdate: updates.length }
  }

  // Apply updates
  for (const update of updates) {
    const { error: updateError } = await supabase
      .from('invoices_jetpack')
      .update({
        period_start: update.period_start,
        period_end: update.period_end,
      })
      .eq('id', update.id)

    if (updateError) {
      console.error(`  ❌ Error updating ${update.invoice_number}:`, updateError)
    } else {
      updated++
    }
  }

  console.log(`\n✅ Updated ${updated} invoices`)
  return { success: true, updated }
}

async function backfillTransactionInvoiceDate() {
  console.log('\n' + '='.repeat(60))
  console.log('STEP 2: Backfill invoice_date_jp on transactions')
  console.log('='.repeat(60))

  // Get all invoices with their dates
  const { data: invoices, error: invError } = await supabase
    .from('invoices_jetpack')
    .select('invoice_number, invoice_date')
    .not('invoice_date', 'is', null)

  if (invError) {
    console.error('Error fetching invoices:', invError)
    return { success: false, updated: 0 }
  }

  // Create a map of invoice_number -> invoice_date
  const invoiceDateMap = new Map()
  for (const inv of invoices) {
    invoiceDateMap.set(inv.invoice_number, inv.invoice_date)
  }

  console.log(`Loaded ${invoiceDateMap.size} invoices with dates`)

  // Get transactions that have invoice_id_jp but no invoice_date_jp
  // Use pagination to get all records (Supabase default limit is 1000)
  const PAGE_SIZE = 1000
  let allTransactions = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    const { data: transactions, error: txError } = await supabase
      .from('transactions')
      .select('id, invoice_id_jp')
      .not('invoice_id_jp', 'is', null)
      .is('invoice_date_jp', null)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (txError) {
      console.error('Error fetching transactions:', txError)
      return { success: false, updated: 0 }
    }

    allTransactions = allTransactions.concat(transactions)
    hasMore = transactions.length === PAGE_SIZE
    page++

    if (page % 10 === 0) {
      console.log(`  Fetched ${allTransactions.length} transactions so far...`)
    }
  }

  const transactions = allTransactions
  console.log(`Found ${transactions.length} transactions with invoice_id_jp but no invoice_date_jp`)

  if (transactions.length === 0) {
    console.log('Nothing to backfill!')
    return { success: true, updated: 0 }
  }

  // Group transactions by invoice_id_jp for batch updates
  const txByInvoice = new Map()
  for (const tx of transactions) {
    if (!txByInvoice.has(tx.invoice_id_jp)) {
      txByInvoice.set(tx.invoice_id_jp, [])
    }
    txByInvoice.get(tx.invoice_id_jp).push(tx.id)
  }

  console.log(`Grouped into ${txByInvoice.size} invoice batches`)

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would update the above transactions')
    let wouldUpdate = 0
    for (const [invoiceNumber, txIds] of txByInvoice) {
      const invoiceDate = invoiceDateMap.get(invoiceNumber)
      if (invoiceDate) {
        console.log(`  ${invoiceNumber}: ${txIds.length} transactions → ${invoiceDate}`)
        wouldUpdate += txIds.length
      } else {
        console.log(`  ⚠️  ${invoiceNumber}: No invoice_date found, ${txIds.length} transactions skipped`)
      }
    }
    return { success: true, updated: 0, wouldUpdate }
  }

  // Apply updates in batches
  let totalUpdated = 0
  let notFound = 0

  for (const [invoiceNumber, txIds] of txByInvoice) {
    const invoiceDate = invoiceDateMap.get(invoiceNumber)

    if (!invoiceDate) {
      console.log(`  ⚠️  ${invoiceNumber}: No invoice_date found, skipping ${txIds.length} transactions`)
      notFound += txIds.length
      continue
    }

    // Supabase has a limit on .in() - batch in chunks of 500
    const BATCH_SIZE = 500
    for (let i = 0; i < txIds.length; i += BATCH_SIZE) {
      const batch = txIds.slice(i, i + BATCH_SIZE)

      const { error: updateError, count } = await supabase
        .from('transactions')
        .update({ invoice_date_jp: invoiceDate })
        .in('id', batch)

      if (updateError) {
        console.error(`  ❌ Error updating batch for ${invoiceNumber}:`, updateError)
      } else {
        totalUpdated += batch.length
      }
    }

    console.log(`  ✅ ${invoiceNumber}: ${txIds.length} transactions → ${invoiceDate}`)
  }

  console.log(`\n✅ Updated ${totalUpdated} transactions`)
  if (notFound > 0) {
    console.log(`⚠️  Skipped ${notFound} transactions (invoice not found)`)
  }

  return { success: true, updated: totalUpdated }
}

async function main() {
  console.log('='.repeat(60))
  console.log('INVOICE DATE BACKFILL SCRIPT')
  console.log('='.repeat(60))
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : 'LIVE'}`)
  console.log(`Time: ${new Date().toISOString()}`)

  // Step 1: Fix invoice periods
  const step1 = await fixInvoicePeriods()

  // Step 2: Backfill transaction invoice_date_jp
  const step2 = await backfillTransactionInvoiceDate()

  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`Invoice periods fixed: ${step1.updated || step1.wouldUpdate || 0}`)
  console.log(`Transaction dates backfilled: ${step2.updated || step2.wouldUpdate || 0}`)

  if (DRY_RUN) {
    console.log('\nRun without --dry-run to apply changes')
  }
}

main().catch(console.error)
