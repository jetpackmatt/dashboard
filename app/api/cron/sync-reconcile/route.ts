import { NextRequest, NextResponse } from 'next/server'
import { syncAll, syncAllTransactions, syncBillingAwareTimelines, syncMissingShipmentItems, reconcileTrackingIds, reconcileVoidedShippingTransactions } from '@/lib/shipbob/sync'

// Allow up to 5 minutes for reconciliation (45-day lookback + transactions)
export const maxDuration = 300

/**
 * Hourly reconciliation sync
 *
 * Runs every hour to:
 * 1. Catch any orders/shipments missed by per-minute sync (45-day lookback)
 * 2. Catch any transactions missed by per-minute sync (3-day lookback)
 * 3. Run soft-delete reconciliation (detect deleted records in ShipBob)
 *
 * Uses 45-day lookback for orders (to catch cancelled/deleted) and
 * 3-day lookback for transactions (to catch any missed by real-time sync).
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

  console.log('[Cron Reconcile] Starting hourly reconciliation sync...')
  const startTime = Date.now()

  try {
    // STEP 1: Sync orders/shipments (45-day lookback to catch cancelled/deleted)
    // Note: daysBack triggers reconciliation, minutesBack skips it
    // Uses StartDate filter to fetch orders created in the last 45 days
    console.log('[Cron Reconcile] Step 1: Syncing orders/shipments...')
    const results = await syncAll({ daysBack: 45 })

    const ordersDuration = Date.now() - startTime
    console.log(`[Cron Reconcile] Orders/shipments completed in ${ordersDuration}ms`)
    console.log(`[Cron Reconcile] Total: ${results.totalOrders} orders, ${results.totalShipments} shipments`)

    // STEP 2: Sync transactions (3-day lookback to catch any missed by real-time sync)
    // Uses parent token - separate from orders sync which uses child tokens
    console.log('[Cron Reconcile] Step 2: Syncing transactions (3-day lookback)...')
    const txStartTime = Date.now()

    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - 3) // 3-day lookback

    const txResult = await syncAllTransactions(startDate, endDate)

    const txDuration = Date.now() - txStartTime
    console.log(`[Cron Reconcile] Transactions completed in ${txDuration}ms`)
    console.log(`[Cron Reconcile] Transactions: ${txResult.transactionsFetched} fetched, ${txResult.transactionsUpserted} upserted`)

    // STEP 3: Catch billable shipments missing timeline data (event_labeled)
    // These are shipments that "aged out" of the 14-day timeline sync window but need timeline data for invoicing
    console.log('[Cron Reconcile] Step 3: Syncing billing-aware timelines...')
    const billingTimelineResult = await syncBillingAwareTimelines(50)
    if (billingTimelineResult.updated > 0) {
      console.log(`[Cron Reconcile] Billing timelines: ${billingTimelineResult.updated} updated`)
    }

    // STEP 4: Catch billable shipments missing shipment_items (products_sold)
    // These are shipments where API returned empty products during initial sync
    console.log('[Cron Reconcile] Step 4: Syncing missing shipment items...')
    const missingItemsResult = await syncMissingShipmentItems(50)
    if (missingItemsResult.itemsInserted > 0) {
      console.log(`[Cron Reconcile] Missing items: ${missingItemsResult.itemsInserted} items inserted`)
    }

    // STEP 5: Reconcile tracking IDs between transactions and shipments
    // Fixes placeholder tracking (SBAAA...) and reshipment tracking mismatches
    console.log('[Cron Reconcile] Step 5: Reconciling tracking IDs...')
    const trackingResult = await reconcileTrackingIds(500)
    if (trackingResult.updated > 0) {
      console.log(`[Cron Reconcile] Tracking IDs: ${trackingResult.updated} updated`)
    }

    // STEP 6: Reconcile voided/duplicate shipping transactions
    // When ShipBob voids and recreates a label, we get 2 transactions for the same shipment
    // Only the latest (by charge_date) is actually billed - mark older ones as is_voided
    console.log('[Cron Reconcile] Step 6: Reconciling voided shipping transactions...')
    const voidedResult = await reconcileVoidedShippingTransactions()
    if (voidedResult.voided > 0) {
      console.log(`[Cron Reconcile] Voided transactions: ${voidedResult.voided} marked (${voidedResult.duplicateGroups} duplicate groups)`)
    }

    const duration = Date.now() - startTime

    // Build per-client summary
    const clientSummary = results.clients.map((c) => ({
      client: c.clientName,
      ordersFound: c.ordersFound,
      ordersUpserted: c.ordersUpserted,
      shipmentsUpserted: c.shipmentsUpserted,
      orderItemsUpserted: c.orderItemsUpserted,
      transactionsUpserted: c.transactionsUpserted,
      ordersDeleted: c.ordersDeleted,
      shipmentsDeleted: c.shipmentsDeleted,
      errors: c.errors.length,
      duration: `${c.duration}ms`,
    }))

    return NextResponse.json({
      success: results.success && txResult.success,
      type: 'reconciliation',
      duration: `${duration}ms`,
      summary: {
        totalOrders: results.totalOrders,
        totalShipments: results.totalShipments,
        clientsProcessed: results.clients.length,
        transactionsFetched: txResult.transactionsFetched,
        transactionsUpserted: txResult.transactionsUpserted,
        billingTimelinesUpdated: billingTimelineResult.updated,
        missingItemsInserted: missingItemsResult.itemsInserted,
        trackingIdsReconciled: trackingResult.updated,
        voidedTransactionsMarked: voidedResult.voided,
        duplicateGroups: voidedResult.duplicateGroups,
      },
      clients: clientSummary,
      errors: [...results.errors, ...txResult.errors, ...billingTimelineResult.errors, ...missingItemsResult.errors, ...trackingResult.errors, ...voidedResult.errors].slice(0, 20),
    })
  } catch (error) {
    console.error('[Cron Reconcile] Error:', error)
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
