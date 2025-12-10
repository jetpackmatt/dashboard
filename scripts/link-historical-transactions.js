/**
 * Link historical transactions to Jetpack invoices
 *
 * Many transactions (especially warehousing fees) have invoice_id_sb but no invoice_id_jp.
 * This script links them by:
 * 1. Looking up the ShipBob invoice date from invoices_sb
 * 2. Finding the Jetpack invoice with matching date AND client_id
 * 3. Updating the transaction with invoice_id_jp and invoice_date_jp
 * 4. Adding missing ShipBob invoice IDs to invoices_jetpack.shipbob_invoice_ids
 *
 * Usage: node scripts/link-historical-transactions.js [--dry-run]
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DRY_RUN = process.argv.includes('--dry-run')

async function main() {
  console.log('='.repeat(60))
  console.log('LINK HISTORICAL TRANSACTIONS TO JETPACK INVOICES')
  console.log('='.repeat(60))
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`)
  console.log(`Time: ${new Date().toISOString()}`)

  // Step 1: Get all unlinked historical transactions with their SB invoice info
  console.log('\n--- Step 1: Finding unlinked transactions ---')

  // Paginate to get all records
  const PAGE_SIZE = 1000
  let unlinked = []
  let page = 0
  let hasMore = true

  while (hasMore) {
    const { data, error } = await supabase
      .from('transactions')
      .select('id, invoice_id_sb, client_id')
      .is('invoice_id_jp', null)
      .not('invoice_id_sb', 'is', null)
      .lt('charge_date', '2025-12-01')  // Only historical
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1)

    if (error) {
      console.error('Error fetching unlinked transactions:', error)
      return
    }

    unlinked = unlinked.concat(data)
    hasMore = data.length === PAGE_SIZE
    page++
  }

  console.log(`Found ${unlinked.length} unlinked historical transactions`)

  // Step 2: Get all ShipBob invoices with their dates
  console.log('\n--- Step 2: Loading ShipBob invoice dates ---')

  const { data: sbInvoices, error: sbError } = await supabase
    .from('invoices_sb')
    .select('shipbob_invoice_id, invoice_date')

  if (sbError) {
    console.error('Error fetching ShipBob invoices:', sbError)
    return
  }

  // Create map of SB invoice ID -> date
  const sbDateMap = new Map()
  for (const sb of sbInvoices) {
    sbDateMap.set(sb.shipbob_invoice_id, sb.invoice_date)
  }
  console.log(`Loaded ${sbDateMap.size} ShipBob invoice dates`)

  // Step 3: Get all Jetpack invoices
  console.log('\n--- Step 3: Loading Jetpack invoices ---')

  const { data: jpInvoices, error: jpError } = await supabase
    .from('invoices_jetpack')
    .select('id, invoice_number, invoice_date, client_id, shipbob_invoice_ids')

  if (jpError) {
    console.error('Error fetching Jetpack invoices:', jpError)
    return
  }

  // Create map: (date_clientId) -> JP invoice
  const jpMap = new Map()
  for (const jp of jpInvoices) {
    const dateStr = jp.invoice_date.split('T')[0]
    const key = `${dateStr}_${jp.client_id}`
    jpMap.set(key, jp)
  }
  console.log(`Loaded ${jpInvoices.length} Jetpack invoices`)

  // Step 4: Match transactions to JP invoices
  console.log('\n--- Step 4: Matching transactions ---')

  const matches = []  // { txId, jpInvoiceNumber, jpInvoiceDate, sbInvoiceId }
  const noMatch = []
  const sbInvoicesToAdd = new Map()  // jpInvoiceId -> Set of SB invoice IDs to add

  for (const tx of unlinked) {
    const sbDate = sbDateMap.get(String(tx.invoice_id_sb))
    if (!sbDate) {
      noMatch.push({ reason: 'no_sb_date', tx })
      continue
    }

    const dateStr = sbDate.split('T')[0]
    const key = `${dateStr}_${tx.client_id}`
    const jp = jpMap.get(key)

    if (!jp) {
      noMatch.push({ reason: 'no_jp_match', tx, sbDate: dateStr })
      continue
    }

    matches.push({
      txId: tx.id,
      jpInvoiceNumber: jp.invoice_number,
      jpInvoiceDate: dateStr,
      sbInvoiceId: tx.invoice_id_sb,
      jpInvoiceId: jp.id,
    })

    // Track SB invoices to add to JP invoice
    const existingSbIds = jp.shipbob_invoice_ids || []
    if (!existingSbIds.includes(tx.invoice_id_sb)) {
      if (!sbInvoicesToAdd.has(jp.id)) {
        sbInvoicesToAdd.set(jp.id, {
          invoiceNumber: jp.invoice_number,
          existingIds: new Set(existingSbIds),
          newIds: new Set(),
        })
      }
      sbInvoicesToAdd.get(jp.id).newIds.add(tx.invoice_id_sb)
    }
  }

  console.log(`Matched: ${matches.length}`)
  console.log(`No match: ${noMatch.length}`)

  // Log no-match reasons
  const noMatchByReason = {}
  for (const nm of noMatch) {
    noMatchByReason[nm.reason] = (noMatchByReason[nm.reason] || 0) + 1
  }
  console.log('No match breakdown:', noMatchByReason)

  // Step 5: Update transactions
  console.log('\n--- Step 5: Updating transactions ---')

  if (DRY_RUN) {
    console.log('[DRY RUN] Would update transactions')
    // Show sample
    const sample = matches.slice(0, 5)
    for (const m of sample) {
      console.log(`  ${m.txId} → ${m.jpInvoiceNumber} (${m.jpInvoiceDate})`)
    }
    if (matches.length > 5) console.log(`  ... and ${matches.length - 5} more`)
  } else {
    // Group by JP invoice for batch updates
    const byJpInvoice = new Map()
    for (const m of matches) {
      if (!byJpInvoice.has(m.jpInvoiceNumber)) {
        byJpInvoice.set(m.jpInvoiceNumber, {
          date: m.jpInvoiceDate,
          txIds: [],
        })
      }
      byJpInvoice.get(m.jpInvoiceNumber).txIds.push(m.txId)
    }

    let totalUpdated = 0
    for (const [invoiceNumber, data] of byJpInvoice) {
      // Batch update in chunks of 500
      const BATCH_SIZE = 500
      for (let i = 0; i < data.txIds.length; i += BATCH_SIZE) {
        const batch = data.txIds.slice(i, i + BATCH_SIZE)
        const { error } = await supabase
          .from('transactions')
          .update({
            invoice_id_jp: invoiceNumber,
            invoice_date_jp: data.date,
          })
          .in('id', batch)

        if (error) {
          console.error(`Error updating batch for ${invoiceNumber}:`, error)
        } else {
          totalUpdated += batch.length
        }
      }
      console.log(`  ${invoiceNumber}: ${data.txIds.length} transactions`)
    }

    console.log(`\nTotal transactions updated: ${totalUpdated}`)
  }

  // Step 6: Update invoices_jetpack.shipbob_invoice_ids
  console.log('\n--- Step 6: Updating invoices_jetpack.shipbob_invoice_ids ---')

  if (sbInvoicesToAdd.size === 0) {
    console.log('No SB invoice IDs to add')
  } else {
    console.log(`${sbInvoicesToAdd.size} Jetpack invoices need SB IDs added`)

    for (const [jpId, data] of sbInvoicesToAdd) {
      const allIds = [...data.existingIds, ...data.newIds]
      const newIdsArray = [...data.newIds]

      if (DRY_RUN) {
        console.log(`  ${data.invoiceNumber}: would add ${newIdsArray.length} SB IDs`)
        console.log(`    New IDs: ${newIdsArray.slice(0, 5).join(', ')}${newIdsArray.length > 5 ? '...' : ''}`)
      } else {
        const { error } = await supabase
          .from('invoices_jetpack')
          .update({ shipbob_invoice_ids: allIds })
          .eq('id', jpId)

        if (error) {
          console.error(`  Error updating ${data.invoiceNumber}:`, error)
        } else {
          console.log(`  ${data.invoiceNumber}: added ${newIdsArray.length} SB IDs`)
        }
      }
    }
  }

  // Summary
  console.log('\n' + '='.repeat(60))
  console.log('SUMMARY')
  console.log('='.repeat(60))
  console.log(`Transactions linked: ${matches.length}`)
  console.log(`JP invoices updated with new SB IDs: ${sbInvoicesToAdd.size}`)
  console.log(`Transactions not matched: ${noMatch.length}`)

  if (DRY_RUN) {
    console.log('\nRun without --dry-run to apply changes')
  }
}

main().catch(console.error)
