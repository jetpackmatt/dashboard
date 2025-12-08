/**
 * Fix duplicate reference_id matching
 *
 * Problem: Import script used Map.set() which overwrites, so only ONE
 * transaction per reference_id got matched. Additionally, different fee types
 * (Shipping, Per Pick Fee, etc.) share the same reference_id but weren't
 * all linked to the same invoice.
 *
 * Solution: Match ALL transactions (any fee type) with the same reference_id
 * to the invoice.
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DRY_RUN = process.argv.includes('--dry-run')

async function fix() {
  console.log('=== FIX DUPLICATE REFERENCE_ID MATCHING ===')
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}\n`)

  // Strategy: Get ANY matched transaction (any fee type), then find ALL unmatched
  // transactions with the same reference_id (regardless of fee type)

  // Step 1: Get all matched transactions (ANY fee type with invoice_id_jp)
  console.log('Step 1: Getting all matched transactions (any fee type)...')
  let matchedTxs = []
  let offset = 0
  const BATCH_SIZE = 1000

  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('reference_id, invoice_id_jp')
      .not('invoice_id_jp', 'is', null)
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) {
      console.log('Error:', error.message)
      break
    }
    if (!data || data.length === 0) break

    matchedTxs = matchedTxs.concat(data)
    offset += BATCH_SIZE
    if (data.length < BATCH_SIZE) break
  }

  console.log(`Found ${matchedTxs.length} matched transactions (all fee types)`)

  // Build map: reference_id -> invoice_id_jp (keep first match)
  const refToInvoice = new Map()
  matchedTxs.forEach(tx => {
    if (!refToInvoice.has(tx.reference_id)) {
      refToInvoice.set(tx.reference_id, tx.invoice_id_jp)
    }
  })

  console.log(`Unique reference_ids with invoices: ${refToInvoice.size}`)

  // Step 2: Find ALL unmatched transactions (any fee type) with matching reference_ids
  console.log('\nStep 2: Finding unmatched transactions with matching reference_ids (ALL fee types)...')

  const refIds = [...refToInvoice.keys()]
  let unmatchedToFix = []

  for (let i = 0; i < refIds.length; i += BATCH_SIZE) {
    const batch = refIds.slice(i, i + BATCH_SIZE)

    // Query ALL unmatched transactions - no fee type filter!
    const { data, error } = await supabase
      .from('transactions')
      .select('id, reference_id, transaction_fee')
      .is('invoice_id_jp', null)
      .in('reference_id', batch)

    if (error) {
      console.log('Error:', error.message)
      continue
    }

    if (data) {
      unmatchedToFix = unmatchedToFix.concat(data)
    }

    if ((i + BATCH_SIZE) % 10000 === 0) {
      console.log(`  Checked ${i + BATCH_SIZE} reference_ids...`)
    }
  }

  console.log(`Found ${unmatchedToFix.length} unmatched transactions to fix`)

  // Group by fee type
  const byFeeType = {}
  unmatchedToFix.forEach(tx => {
    byFeeType[tx.transaction_fee] = (byFeeType[tx.transaction_fee] || 0) + 1
  })
  console.log('By fee type:', byFeeType)

  if (DRY_RUN) {
    console.log('\n[DRY RUN] Would update', unmatchedToFix.length, 'transactions')
    console.log('Sample:', unmatchedToFix.slice(0, 5).map(tx => ({
      id: tx.id,
      reference_id: tx.reference_id,
      fee_type: tx.transaction_fee,
      invoice: refToInvoice.get(tx.reference_id)
    })))
    return
  }

  // Step 3: Update unmatched transactions
  console.log('\nStep 3: Updating transactions...')

  let successCount = 0
  const PARALLEL_SIZE = 50

  for (let i = 0; i < unmatchedToFix.length; i += PARALLEL_SIZE) {
    const batch = unmatchedToFix.slice(i, i + PARALLEL_SIZE)

    const results = await Promise.all(batch.map(async (tx) => {
      const invoiceId = refToInvoice.get(tx.reference_id)
      if (!invoiceId) return false

      const { error } = await supabase
        .from('transactions')
        .update({
          invoice_id_jp: invoiceId,
          invoiced_status_jp: true
        })
        .eq('id', tx.id)

      return !error
    }))

    successCount += results.filter(Boolean).length

    if ((i + PARALLEL_SIZE) % 1000 === 0) {
      console.log(`  Updated ${i + PARALLEL_SIZE}...`)
    }
  }

  console.log(`\nSuccessfully updated: ${successCount} transactions`)
  console.log('\n=== COMPLETE ===')
}

fix().catch(console.error)
