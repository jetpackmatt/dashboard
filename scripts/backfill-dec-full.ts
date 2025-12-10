/**
 * Full backfill for Dec 1-7, 2025 (orders, shipments, AND transactions)
 *
 * The transaction-only backfill missed the shipments data needed for preflight.
 */

import { syncAll } from '../lib/shipbob/sync'

async function run() {
  console.log('Full backfill for Dec 1-7, 2025...\n')
  console.log('This will sync orders, shipments, and transactions for all clients.\n')

  // Sync last 8 days to cover Dec 1-7 plus buffer
  const daysBack = 8

  console.log(`Running syncAll with daysBack=${daysBack}...`)

  const result = await syncAll({ daysBack })

  console.log('\n========================================')
  console.log('FULL BACKFILL RESULT')
  console.log('========================================')
  console.log(`Success: ${result.success}`)
  console.log(`Total orders: ${result.totalOrders}`)
  console.log(`Total shipments: ${result.totalShipments}`)
  console.log(`Duration: ${result.duration}ms`)

  console.log('\nPer-client breakdown:')
  for (const client of result.clients) {
    console.log(`\n${client.clientName}:`)
    console.log(`  Orders: ${client.ordersFound} found, ${client.ordersUpserted} upserted`)
    console.log(`  Shipments: ${client.shipmentsUpserted} upserted`)
    console.log(`  Order items: ${client.orderItemsUpserted} upserted`)
    console.log(`  Transactions: ${client.transactionsUpserted} upserted`)
    if (client.errors.length > 0) {
      console.log(`  Errors: ${client.errors.length}`)
      client.errors.slice(0, 3).forEach(e => console.log(`    - ${e}`))
    }
  }

  if (result.errors.length > 0) {
    console.log('\nGlobal errors:')
    result.errors.forEach(e => console.log(`  - ${e}`))
  }
}

run().catch(console.error)
