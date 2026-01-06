#!/usr/bin/env npx tsx
/**
 * Backfill SFTP daily files for missing dates
 */

import { createClient } from '@supabase/supabase-js'
import {
  fetchDailyShippingBreakdown,
  updateTransactionsWithDailyBreakdown
} from '../lib/billing/sftp-client'
import * as dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function main() {
  // Files to process (file date = charge_date + 1)
  // Dec 23 charges → Dec 24 file
  // Dec 24 charges → Dec 25 file
  // Dec 27 charges → Dec 28 file
  const fileDates = [
    new Date(2025, 11, 24), // For Dec 23 charges
    new Date(2025, 11, 25), // For Dec 24 charges
    new Date(2025, 11, 28), // For Dec 27 charges
  ]

  console.log('\n=== Backfill SFTP Daily Files ===\n')

  for (const fileDate of fileDates) {
    const dateStr = `${fileDate.getFullYear()}-${String(fileDate.getMonth() + 1).padStart(2, '0')}-${String(fileDate.getDate()).padStart(2, '0')}`

    console.log(`\n--- Processing file for ${dateStr} ---`)

    const result = await fetchDailyShippingBreakdown(fileDate)

    if (!result.success) {
      console.log(`  ✗ File not found: ${result.error}`)
      continue
    }

    console.log(`  Found ${result.rows.length} shipments`)

    const updateResult = await updateTransactionsWithDailyBreakdown(supabase, result.rows, fileDate)
    console.log(`  ✓ Updated: ${updateResult.updated}, Not found: ${updateResult.notFound}`)

    if (updateResult.errors.length > 0) {
      console.log(`  Errors: ${updateResult.errors.length}`)
    }
  }

  // Check final state
  console.log('\n\n--- Final Coverage Check ---')
  const { data, error } = await supabase
    .from('transactions')
    .select('charge_date')
    .eq('reference_type', 'Shipment')
    .eq('fee_type', 'Shipping')
    .is('base_cost', null)

  if (error) {
    console.log('Error checking:', error.message)
  } else {
    console.log(`Remaining transactions without base_cost: ${data.length}`)

    // Group by date
    const byDate: Record<string, number> = {}
    for (const tx of data) {
      const d = tx.charge_date?.split('T')[0] || 'unknown'
      byDate[d] = (byDate[d] || 0) + 1
    }

    console.log('\nBy date:')
    for (const [date, count] of Object.entries(byDate).sort()) {
      console.log(`  ${date}: ${count}`)
    }
  }
}

main().catch(console.error)
