#!/usr/bin/env npx tsx
/**
 * Re-process SFTP shipping breakdown for a specific date
 *
 * Usage: npx tsx scripts/reprocess-sftp-breakdown.ts [MMDDYY]
 *
 * If no date provided, uses current week's Monday (same as generate-invoices cron)
 *
 * Example:
 *   npx tsx scripts/reprocess-sftp-breakdown.ts 120825  # Dec 8, 2025
 *   npx tsx scripts/reprocess-sftp-breakdown.ts         # Current week
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'
import {
  fetchShippingBreakdown,
  updateTransactionsWithBreakdown,
} from '../lib/billing/sftp-client'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Parse MMDDYY date string to Date
 */
function parseDateString(dateStr: string): Date {
  const mm = parseInt(dateStr.slice(0, 2), 10) - 1
  const dd = parseInt(dateStr.slice(2, 4), 10)
  const yy = parseInt(dateStr.slice(4, 6), 10)
  const year = yy < 50 ? 2000 + yy : 1900 + yy
  return new Date(year, mm, dd)
}

/**
 * Format date as MMDDYY
 */
function formatDateString(date: Date): string {
  const mm = String(date.getMonth() + 1).padStart(2, '0')
  const dd = String(date.getDate()).padStart(2, '0')
  const yy = String(date.getFullYear()).slice(-2)
  return `${mm}${dd}${yy}`
}

/**
 * Get Monday of current week
 */
function getCurrentMonday(): Date {
  const today = new Date()
  const dayOfWeek = today.getDay()
  const daysToMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1
  const monday = new Date(today)
  monday.setDate(today.getDate() - daysToMonday)
  monday.setHours(0, 0, 0, 0)
  return monday
}

async function main() {
  const dateArg = process.argv[2]

  let invoiceDate: Date
  if (dateArg) {
    if (!/^\d{6}$/.test(dateArg)) {
      console.error('Invalid date format. Use MMDDYY (e.g., 120825 for Dec 8, 2025)')
      process.exit(1)
    }
    invoiceDate = parseDateString(dateArg)
  } else {
    invoiceDate = getCurrentMonday()
  }

  const dateStr = formatDateString(invoiceDate)
  console.log(`\nRe-processing SFTP breakdown for: ${invoiceDate.toDateString()} (${dateStr})`)
  console.log('='.repeat(60))

  // Step 1: Fetch SFTP data
  console.log('\n1. Fetching SFTP shipping breakdown...')
  const sftpResult = await fetchShippingBreakdown(invoiceDate)

  if (!sftpResult.success) {
    console.error(`   SFTP fetch failed: ${sftpResult.error}`)
    process.exit(1)
  }

  console.log(`   Found ${sftpResult.rows.length} rows in ${sftpResult.filename}`)

  if (sftpResult.rows.length === 0) {
    console.log('   No rows to process')
    process.exit(0)
  }

  // Show sample rows
  console.log('\n   Sample rows:')
  for (const row of sftpResult.rows.slice(0, 3)) {
    console.log(`   - Shipment ${row.shipment_id}: base=$${row.base_cost}, surcharge=$${row.surcharge}, insurance=$${row.insurance_cost}`)
  }

  // Count refunds vs charges
  const refunds = sftpResult.rows.filter(r => r.base_cost < 0 || r.total < 0)
  const charges = sftpResult.rows.filter(r => r.base_cost >= 0 && r.total >= 0)
  console.log(`\n   Breakdown: ${charges.length} charges, ${refunds.length} refunds`)

  // Step 2: Update transactions
  console.log('\n2. Updating transactions with breakdown data...')
  const updateResult = await updateTransactionsWithBreakdown(supabase, sftpResult.rows)

  console.log('\n' + '='.repeat(60))
  console.log('RESULTS:')
  console.log(`   Updated: ${updateResult.updated}`)
  console.log(`   Not found: ${updateResult.notFound}`)
  console.log(`   Errors: ${updateResult.errors.length}`)

  if (updateResult.errors.length > 0) {
    console.log('\n   First 5 errors:')
    for (const err of updateResult.errors.slice(0, 5)) {
      console.log(`   - ${err}`)
    }
  }

  console.log('\nDone!')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
