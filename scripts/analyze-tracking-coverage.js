#!/usr/bin/env node
/**
 * Analyze tracking ID coverage for Shipment transactions
 *
 * Breaks down by fee_type to understand which transaction types
 * are missing tracking IDs
 */

const { createClient } = require('@supabase/supabase-js')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('\n=== Tracking ID Coverage Analysis ===\n')

  // Fetch all Shipment transactions with pagination
  const allTx = []
  const PAGE_SIZE = 1000
  let lastId = null

  while (true) {
    let query = supabase
      .from('transactions')
      .select('id, fee_type, tracking_id, reference_id')
      .eq('reference_type', 'Shipment')
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)

    if (lastId) {
      query = query.gt('id', lastId)
    }

    const { data, error } = await query
    if (error) throw error
    if (!data || data.length === 0) break

    allTx.push(...data)
    lastId = data[data.length - 1].id
    if (data.length < PAGE_SIZE) break
  }

  console.log(`Total Shipment transactions: ${allTx.length}\n`)

  // Group by fee_type and count with/without tracking
  const byFeeType = new Map()
  for (const tx of allTx) {
    const key = tx.fee_type || '(null)'
    if (!byFeeType.has(key)) {
      byFeeType.set(key, { withTracking: 0, withoutTracking: 0, missingExamples: [] })
    }
    const counts = byFeeType.get(key)
    if (tx.tracking_id) {
      counts.withTracking++
    } else {
      counts.withoutTracking++
      if (counts.missingExamples.length < 3) {
        counts.missingExamples.push(tx.reference_id)
      }
    }
  }

  console.log('Breakdown by fee_type:\n')
  console.log('fee_type                         | With Tracking | Without | Coverage')
  console.log('-'.repeat(75))

  let totalWith = 0
  let totalWithout = 0

  const sorted = [...byFeeType.entries()].sort((a, b) =>
    (b[1].withTracking + b[1].withoutTracking) - (a[1].withTracking + a[1].withoutTracking)
  )

  for (const [feeType, counts] of sorted) {
    const total = counts.withTracking + counts.withoutTracking
    const pct = total > 0 ? ((counts.withTracking / total) * 100).toFixed(1) : '0'
    console.log(
      feeType.substring(0, 32).padEnd(32) + ' | ' +
      String(counts.withTracking).padStart(13) + ' | ' +
      String(counts.withoutTracking).padStart(7) + ' | ' +
      (pct + '%').padStart(7)
    )
    totalWith += counts.withTracking
    totalWithout += counts.withoutTracking
  }

  console.log('-'.repeat(75))
  const grandTotal = totalWith + totalWithout
  console.log(
    'TOTAL'.padEnd(32) + ' | ' +
    String(totalWith).padStart(13) + ' | ' +
    String(totalWithout).padStart(7) + ' | ' +
    (((totalWith / grandTotal) * 100).toFixed(1) + '%').padStart(7)
  )

  // Show missing examples for fee types that SHOULD have tracking
  console.log('\n--- Fee types missing tracking (with examples) ---\n')

  for (const [feeType, counts] of sorted) {
    if (counts.withoutTracking > 0 && feeType === 'Shipping') {
      console.log(`${feeType}: ${counts.withoutTracking} missing`)
      console.log(`  Sample shipment_ids: ${counts.missingExamples.join(', ')}`)
    }
  }

  // Check if non-Shipping fee types even make sense to have tracking
  console.log('\n--- Analysis ---\n')

  const shippingFeeType = byFeeType.get('Shipping')
  if (shippingFeeType) {
    console.log(`Shipping fee_type: ${shippingFeeType.withTracking}/${shippingFeeType.withTracking + shippingFeeType.withoutTracking} have tracking`)
    if (shippingFeeType.withoutTracking > 0) {
      console.log(`  Missing: ${shippingFeeType.withoutTracking} - these are the ones to investigate`)
    }
  }

  // Check what other fee types are
  const nonShippingMissing = sorted.filter(([ft, c]) => ft !== 'Shipping' && c.withoutTracking > 0)
  if (nonShippingMissing.length > 0) {
    console.log('\nNon-Shipping fee types without tracking:')
    for (const [feeType, counts] of nonShippingMissing) {
      console.log(`  ${feeType}: ${counts.withoutTracking} missing (may not need tracking)`)
    }
  }
}

main().catch(console.error)
