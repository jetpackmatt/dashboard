/**
 * Backfill jetpack_invoice_id on invoices_sb table
 *
 * ShipBob generates up to 6 invoices per week:
 * - Shipping, AdditionalFee, ReturnsFee, WarehouseInboundFee, WarehouseStorage, Credits
 *
 * "Payment" types are not billable - mark them as "PAYMENT" to exclude from processing.
 *
 * This script:
 * 1. Marks Dec 1 week invoices as NULL (for cron to generate JPHS-0038/JPML-0022)
 * 2. Marks all historical invoices as "HISTORICAL"
 * 3. Fixes next_invoice_number to 38/22
 *
 * Usage: node scripts/backfill-shipbob-invoices.js [--commit]
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DRY_RUN = !process.argv.includes('--commit')

// Leave the most recent week's invoices (Dec 1 week) as NULL for cron testing
// Auto-detect based on the latest invoice_date in the table
// Invoices within 7 days of the latest invoice_date will be left for cron

// Desired next_invoice_number values (so Dec 1 generates -0037 and -0021)
const DESIRED_NEXT_INVOICE = {
  'HS': 37, // Henson Shaving → JPHS-0037-120125
  'ML': 21, // Methyl-Life → JPML-0021-120125
}

async function main() {
  console.log('='.repeat(70))
  console.log('BACKFILL SHIPBOB INVOICE IDs')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (no changes)' : '⚠️  COMMIT MODE'}`)
  console.log('='.repeat(70))

  // Step 1: Get all ShipBob invoices from invoices_sb (the correct synced table)
  const { data: invoices, error: invError } = await supabase
    .from('invoices_sb')
    .select('*')
    .order('invoice_date', { ascending: true })

  if (invError || !invoices) {
    console.error('Error fetching invoices:', invError)
    process.exit(1)
  }

  console.log(`\nFound ${invoices.length} ShipBob invoices in invoices_sb`)

  // Step 2: Get clients
  const { data: clients, error: clientError } = await supabase
    .from('clients')
    .select('id, company_name, short_code, next_invoice_number')
    .eq('is_active', true)

  if (clientError || !clients) {
    console.error('Error fetching clients:', clientError)
    process.exit(1)
  }

  console.log(`\nClients:`)
  for (const c of clients) {
    const desired = DESIRED_NEXT_INVOICE[c.short_code]
    const status = c.next_invoice_number === desired ? '✓' : `needs ${desired}`
    console.log(`  ${c.company_name} (${c.short_code}): next_invoice_number = ${c.next_invoice_number} ${status}`)
  }

  // Step 3: Categorize invoices
  // Find the latest invoice_date and leave invoices within 7 days of it as NULL for cron
  const latestDate = invoices.length > 0
    ? new Date(invoices[invoices.length - 1].invoice_date)
    : new Date()
  const cutoffDate = new Date(latestDate)
  cutoffDate.setDate(cutoffDate.getDate() - 7)

  console.log(`\nLatest invoice date: ${latestDate.toISOString().split('T')[0]}`)
  console.log(`Cutoff for "current week": ${cutoffDate.toISOString().split('T')[0]}`)

  const currentWeekInvoices = invoices.filter(inv => {
    const invDate = new Date(inv.invoice_date)
    return invDate > cutoffDate
  })
  const historicalInvoices = invoices.filter(inv => {
    const invDate = new Date(inv.invoice_date)
    return invDate <= cutoffDate
  })
  const paymentInvoices = invoices.filter(inv => inv.invoice_type === 'Payment')

  console.log(`\nInvoice categorization:`)
  console.log(`  Current week (leave NULL for cron): ${currentWeekInvoices.length}`)
  currentWeekInvoices.forEach(inv => {
    console.log(`    - ${inv.shipbob_invoice_id} (${inv.invoice_type}) ${inv.invoice_date} $${inv.base_amount}`)
  })
  console.log(`  Historical (mark as processed): ${historicalInvoices.length}`)
  console.log(`  Payment (mark as PAYMENT): ${paymentInvoices.length}`)

  // Step 4: Prepare updates
  const updates = []

  // Historical invoices get marked as "HISTORICAL" (or "PAYMENT" if Payment type)
  for (const inv of historicalInvoices) {
    if (inv.invoice_type === 'Payment') {
      updates.push({ id: inv.id, shipbob_invoice_id: inv.shipbob_invoice_id, jetpack_invoice_id: 'PAYMENT', type: inv.invoice_type })
    } else {
      updates.push({ id: inv.id, shipbob_invoice_id: inv.shipbob_invoice_id, jetpack_invoice_id: 'HISTORICAL', type: inv.invoice_type })
    }
  }

  // Current week stays NULL (already NULL, but explicit)
  // No update needed, but let's track it
  const nullInvoices = currentWeekInvoices.map(inv => ({
    id: inv.id,
    shipbob_invoice_id: inv.shipbob_invoice_id,
    jetpack_invoice_id: null,
    type: inv.invoice_type
  }))

  console.log(`\n${'='.repeat(70)}`)
  console.log('PLANNED CHANGES')
  console.log('='.repeat(70))

  console.log(`\n1. Mark ${updates.length} historical invoices:`)
  updates.forEach(u => {
    console.log(`   ${u.shipbob_invoice_id} (${u.type}) => "${u.jetpack_invoice_id}"`)
  })

  console.log(`\n2. Leave ${nullInvoices.length} current week invoices as NULL:`)
  nullInvoices.forEach(u => {
    console.log(`   ${u.shipbob_invoice_id} (${u.type}) => NULL (for cron)`)
  })

  console.log(`\n3. Update next_invoice_number:`)
  for (const c of clients) {
    const desired = DESIRED_NEXT_INVOICE[c.short_code]
    if (c.next_invoice_number !== desired) {
      console.log(`   ${c.short_code}: ${c.next_invoice_number} => ${desired}`)
    } else {
      console.log(`   ${c.short_code}: ${c.next_invoice_number} (no change needed)`)
    }
  }

  if (DRY_RUN) {
    console.log('\n[DRY RUN] No changes made. Use --commit to apply.')
  } else {
    console.log('\nApplying changes...')

    // Update historical invoices
    for (const update of updates) {
      const { error } = await supabase
        .from('invoices_sb')
        .update({ jetpack_invoice_id: update.jetpack_invoice_id })
        .eq('id', update.id)

      if (error) {
        console.error(`Error updating ${update.shipbob_invoice_id}:`, error.message)
      }
    }
    console.log(`  ✓ Updated ${updates.length} historical invoices`)

    // Update next_invoice_number for clients
    for (const c of clients) {
      const desired = DESIRED_NEXT_INVOICE[c.short_code]
      if (c.next_invoice_number !== desired) {
        const { error } = await supabase
          .from('clients')
          .update({ next_invoice_number: desired })
          .eq('id', c.id)

        if (error) {
          console.error(`Error updating ${c.short_code} next_invoice_number:`, error.message)
        } else {
          console.log(`  ✓ Updated ${c.short_code} next_invoice_number: ${c.next_invoice_number} => ${desired}`)
        }
      }
    }

    console.log('\nDone! Run test-cron-dryrun.js to verify.')
  }
}

main().catch(console.error)
