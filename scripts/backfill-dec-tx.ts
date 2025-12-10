/**
 * Backfill missing transactions for Dec 1-7, 2025
 *
 * Uses the existing syncAllTransactions function which handles attribution.
 */

import { syncAllTransactions } from '../lib/shipbob/sync'

async function run() {
  console.log('Backfilling transactions for Dec 1-7, 2025...\n')

  const startDate = new Date('2025-12-01')
  const endDate = new Date('2025-12-07T23:59:59')

  console.log(`Start: ${startDate.toISOString()}`)
  console.log(`End: ${endDate.toISOString()}`)

  const result = await syncAllTransactions(startDate, endDate)

  console.log('\n========================================')
  console.log('BACKFILL RESULT')
  console.log('========================================')
  console.log(JSON.stringify(result, null, 2))
}

run().catch(console.error)
