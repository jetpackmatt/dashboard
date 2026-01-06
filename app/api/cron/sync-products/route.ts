import { NextRequest, NextResponse } from 'next/server'
import { syncProducts } from '@/lib/shipbob/sync'

/**
 * Cron endpoint for scheduled products sync
 *
 * Syncs products from ShipBob API for all clients.
 * Products are needed for:
 * 1. Attribution: Map inventory_id → client_id for storage transactions
 * 2. XLS Export: Lookup SKU from inventory_id for billing sheets
 *
 * After syncing products, also re-attributes any unattributed storage transactions.
 *
 * Schedule: Daily (products don't change frequently)
 */
export async function GET(request: NextRequest) {
  // Verify cron secret (Vercel automatically includes this header)
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  // Allow access if:
  // 1. CRON_SECRET not set (development)
  // 2. Authorization header matches
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Cron SyncProducts] Starting products sync...')
  const startTime = Date.now()

  try {
    const result = await syncProducts()

    const duration = Date.now() - startTime

    console.log(`[Cron SyncProducts] Completed in ${duration}ms`)
    console.log(`[Cron SyncProducts] ${result.productsUpserted} products, ${result.storageTransactionsAttributed} storage txns attributed`)

    return NextResponse.json({
      success: result.success,
      duration: `${duration}ms`,
      summary: {
        clientsProcessed: result.clientsProcessed,
        productsUpserted: result.productsUpserted,
        storageTransactionsAttributed: result.storageTransactionsAttributed,
      },
      clients: result.clients.map(c => ({
        client: c.clientName,
        productsFound: c.productsFound,
        productsUpserted: c.productsUpserted,
        errors: c.errors.length,
      })),
      errors: result.errors.slice(0, 20), // Limit error output
    })
  } catch (error) {
    console.error('[Cron SyncProducts] Error:', error)
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        duration: `${Date.now() - startTime}ms`,
      },
      { status: 500 }
    )
  }
}

// Support POST for manual triggers
export async function POST(request: NextRequest) {
  return GET(request)
}
