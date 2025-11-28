/**
 * ShipBob Data Sync Service
 *
 * Two-tier sync:
 * 1. Orders/Shipments - Uses child brand tokens (per-brand)
 * 2. Transactions/Billing - Uses parent Jetpack token (consolidated)
 *
 * The billing data is attributed to brands via reference_id mapping.
 */

import { ShipBobClient, ShipBobOrder, ShipBobTransaction } from './client'
import { createAdminClient } from '@/lib/supabase/admin'

export interface SyncResult {
  success: boolean
  clientId: string
  ordersFound: number
  ordersInserted: number
  ordersUpdated: number
  shipmentIds: string[]  // For billing enrichment
  errors: string[]
}

export interface BillingSyncResult {
  success: boolean
  transactionsFound: number
  transactionsInserted: number
  transactionsUpdated: number
  invoicesFound: number
  invoicesInserted: number
  errors: string[]
}

/**
 * Get a client's ShipBob API token from the database
 */
async function getClientToken(clientId: string): Promise<string | null> {
  const supabase = createAdminClient()

  const { data, error } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', clientId)
    .eq('provider', 'shipbob')
    .single()

  if (error || !data) {
    return null
  }

  // Type assertion needed until Supabase types are regenerated
  return (data as { api_token: string }).api_token
}

/**
 * Map ShipBob order to our shipments table schema
 */
function mapOrderToShipment(order: ShipBobOrder, clientId: string) {
  const shipment = order.shipments?.[0] // Primary shipment

  return {
    client_id: clientId,
    shipbob_order_id: order.id.toString(),
    shipbob_reference_id: order.reference_id,
    store_order_id: order.order_number,
    tracking_id: shipment?.tracking_number || null,
    order_date: order.created_date ? new Date(order.created_date).toISOString().split('T')[0] : null,
    carrier: shipment?.carrier || null,
    carrier_service: shipment?.shipping_method || null,
    transaction_status: order.status,
    delivered_date: shipment?.actual_delivery_date ? new Date(shipment.actual_delivery_date).toISOString() : null,
    actual_weight_oz: shipment?.measurements?.total_weight_oz || null,
    length: shipment?.measurements?.length_in || null,
    width: shipment?.measurements?.width_in || null,
    height: shipment?.measurements?.height_in || null,
    raw_data: order,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Sync orders for a specific client
 *
 * @param clientId - Our internal client UUID
 * @param daysBack - How many days of orders to fetch (default 30)
 */
export async function syncClientOrders(
  clientId: string,
  daysBack: number = 30
): Promise<SyncResult> {
  const result: SyncResult = {
    success: false,
    clientId,
    ordersFound: 0,
    ordersInserted: 0,
    ordersUpdated: 0,
    shipmentIds: [],
    errors: [],
  }

  try {
    // Get client's API token
    const token = await getClientToken(clientId)
    if (!token) {
      result.errors.push('No API token found for this client')
      return result
    }

    // Create ShipBob client with this brand's token
    const shipbob = new ShipBobClient(token)

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)

    // Fetch ALL orders from ShipBob (paginated)
    const allOrders: ShipBobOrder[] = []
    let page = 1
    const pageSize = 250 // ShipBob max per page

    while (true) {
      const orders = await shipbob.orders.searchOrders({
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        limit: pageSize,
        page,
      })

      if (orders.length === 0) break
      allOrders.push(...orders)

      if (orders.length < pageSize) break // Last page
      page++
    }

    result.ordersFound = allOrders.length

    if (allOrders.length === 0) {
      result.success = true
      return result
    }

    const orders = allOrders

    // Extract shipment IDs for billing enrichment
    for (const order of orders) {
      if (order.shipments) {
        for (const shipment of order.shipments) {
          result.shipmentIds.push(shipment.id.toString())
        }
      }
    }

    // Upsert orders into our database
    const supabase = createAdminClient()

    for (const order of orders) {
      const shipmentData = mapOrderToShipment(order, clientId)

      // Check if record exists
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (supabase as any)
        .from('shipments')
        .select('id, updated_at')
        .eq('shipbob_order_id', shipmentData.shipbob_order_id)
        .single()

      if (existing) {
        // Update existing record
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('shipments')
          .update(shipmentData)
          .eq('shipbob_order_id', shipmentData.shipbob_order_id)

        if (error) {
          result.errors.push(`Failed to update order ${order.id}: ${error.message}`)
        } else {
          result.ordersUpdated++
        }
      } else {
        // Insert new record
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('shipments')
          .insert({
            ...shipmentData,
            created_at: new Date().toISOString(),
          })

        if (error) {
          result.errors.push(`Failed to insert order ${order.id}: ${error.message}`)
        } else {
          result.ordersInserted++
        }
      }
    }

    result.success = result.errors.length === 0
    return result

  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    return result
  }
}

/**
 * Sync orders for all active clients
 */
export async function syncAllClients(daysBack: number = 30): Promise<SyncResult[]> {
  const supabase = createAdminClient()

  // Get all active clients with tokens
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: clients, error } = await (supabase as any)
    .from('clients')
    .select('id')
    .eq('is_active', true)

  if (error || !clients) {
    return [{
      success: false,
      clientId: 'all',
      ordersFound: 0,
      ordersInserted: 0,
      ordersUpdated: 0,
      shipmentIds: [],
      errors: ['Failed to fetch clients'],
    }]
  }

  // Sync each client
  const results: SyncResult[] = []
  for (const client of clients as { id: string }[]) {
    const result = await syncClientOrders(client.id, daysBack)
    results.push(result)
  }

  return results
}

// ============================================================================
// BILLING SYNC (Parent Token)
// ============================================================================

/**
 * Map ShipBob transaction to our transactions table schema
 */
function mapTransaction(tx: ShipBobTransaction) {
  return {
    transaction_id: tx.transaction_id,
    reference_id: tx.reference_id,
    reference_type: tx.reference_type,
    amount: tx.amount,
    currency_code: tx.currency_code,
    charge_date: tx.charge_date,
    transaction_fee: tx.transaction_fee,
    transaction_type: tx.transaction_type,
    fulfillment_center: tx.fulfillment_center,
    invoiced_status: tx.invoiced_status,
    invoice_id: tx.invoice_id,
    invoice_date: tx.invoice_date,
    tracking_id: tx.additional_details?.TrackingId || null,
    additional_details: tx.additional_details,
    raw_data: tx,
    updated_at: new Date().toISOString(),
  }
}

/**
 * Build a mapping from ShipBob order ID to our client_id
 * This is needed because billing data doesn't include client info
 */
async function buildOrderToClientMap(): Promise<Map<string, string>> {
  const supabase = createAdminClient()

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: shipments, error } = await (supabase as any)
    .from('shipments')
    .select('shipbob_order_id, client_id')

  if (error || !shipments) {
    return new Map()
  }

  const map = new Map<string, string>()
  for (const s of shipments as { shipbob_order_id: string; client_id: string }[]) {
    map.set(s.shipbob_order_id, s.client_id)
  }
  return map
}

/**
 * Sync billing transactions using the parent Jetpack token
 *
 * @param daysBack - How many days of transactions to fetch (default 30)
 */
export async function syncBillingTransactions(
  daysBack: number = 30
): Promise<BillingSyncResult> {
  const result: BillingSyncResult = {
    success: false,
    transactionsFound: 0,
    transactionsInserted: 0,
    transactionsUpdated: 0,
    invoicesFound: 0,
    invoicesInserted: 0,
    errors: [],
  }

  try {
    // Use parent token from env
    const parentToken = process.env.SHIPBOB_API_TOKEN
    if (!parentToken) {
      result.errors.push('SHIPBOB_API_TOKEN (parent token) not configured')
      return result
    }

    const shipbob = new ShipBobClient(parentToken)
    const supabase = createAdminClient()

    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - daysBack)

    // Build order -> client mapping for attribution
    const orderToClient = await buildOrderToClientMap()

    // 1. Fetch and sync invoices
    console.log('Fetching invoices...')
    let cursor: string | undefined
    const allInvoices: { invoice_id: number; invoice_date: string; invoice_type: string; amount: number; currency_code: string }[] = []

    do {
      const invoiceResponse = await shipbob.billing.getInvoices({
        startDate: startDate.toISOString().split('T')[0],
        endDate: endDate.toISOString().split('T')[0],
        pageSize: 100,
        cursor,
      })

      allInvoices.push(...invoiceResponse.items)
      cursor = invoiceResponse.next
    } while (cursor)

    result.invoicesFound = allInvoices.length

    // Insert invoices
    for (const invoice of allInvoices) {
      const invoiceData = {
        shipbob_invoice_id: invoice.invoice_id.toString(),
        invoice_number: invoice.invoice_id.toString(),
        invoice_date: invoice.invoice_date,
        invoice_type: invoice.invoice_type,
        base_amount: invoice.amount,
        currency_code: invoice.currency_code,
        period_start: startDate.toISOString(),
        period_end: endDate.toISOString(),
        raw_data: invoice,
        updated_at: new Date().toISOString(),
      }

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from('invoices_sb')
        .upsert(invoiceData, { onConflict: 'shipbob_invoice_id' })

      if (error) {
        result.errors.push(`Invoice ${invoice.invoice_id}: ${error.message}`)
      } else {
        result.invoicesInserted++
      }
    }

    // 2. Fetch and sync transactions
    // NOTE: ShipBob API quirks:
    // - Query endpoint only returns PENDING (uninvoiced) transactions
    // - Cursor pagination returns duplicates (API bug)
    // - Must fetch per-invoice for historical/invoiced transactions
    // Using page_size: 1000 to maximize single-request capture

    console.log('Fetching pending transactions...')
    const txResponse = await shipbob.billing.queryTransactions({
      start_date: startDate.toISOString().split('T')[0],
      end_date: endDate.toISOString().split('T')[0],
      page_size: 1000, // Max allowed, default is 100
    })

    const pendingTransactions = txResponse.items || []
    console.log(`  Found ${pendingTransactions.length} pending transactions`)

    // Also fetch transactions from recent invoices (for invoiced/historical data)
    console.log('Fetching invoiced transactions...')
    const invoicedTransactions: ShipBobTransaction[] = []
    const seenTxIds = new Set<string>()

    // Mark pending transaction IDs to avoid duplicates
    for (const tx of pendingTransactions) {
      seenTxIds.add(tx.transaction_id)
    }

    // Fetch from non-Payment invoices (Payment invoices don't have line-item transactions)
    // NOTE: ShipBob API only retains transaction details for most recent billing cycle
    // Older invoices will return 0 transactions - this is an API limitation
    const billingInvoices = allInvoices.filter(inv => inv.invoice_type !== 'Payment')
    for (const invoice of billingInvoices) { // Process ALL invoices
      try {
        const invTxs = await shipbob.billing.getTransactionsByInvoice(invoice.invoice_id)
        for (const tx of invTxs) {
          if (!seenTxIds.has(tx.transaction_id)) {
            seenTxIds.add(tx.transaction_id)
            invoicedTransactions.push(tx)
          }
        }
      } catch {
        // Some invoices may not have detailed transactions
        console.log(`  Invoice ${invoice.invoice_id}: no transactions available`)
      }
    }
    console.log(`  Found ${invoicedTransactions.length} invoiced transactions`)

    const transactions = [...pendingTransactions, ...invoicedTransactions]
    result.transactionsFound = transactions.length

    // Insert transactions
    for (const tx of transactions) {
      const txData = mapTransaction(tx)

      // Try to attribute to a client based on reference_id
      const clientId = orderToClient.get(tx.reference_id)
      const insertData = clientId
        ? { ...txData, client_id: clientId }
        : txData

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: existing } = await (supabase as any)
        .from('transactions')
        .select('id')
        .eq('transaction_id', tx.transaction_id)
        .single()

      if (existing) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('transactions')
          .update(insertData)
          .eq('transaction_id', tx.transaction_id)

        if (error) {
          result.errors.push(`Tx ${tx.transaction_id}: ${error.message}`)
        } else {
          result.transactionsUpdated++
        }
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error } = await (supabase as any)
          .from('transactions')
          .insert({
            ...insertData,
            created_at: new Date().toISOString(),
          })

        if (error) {
          result.errors.push(`Tx ${tx.transaction_id}: ${error.message}`)
        } else {
          result.transactionsInserted++
        }
      }
    }

    result.success = result.errors.length === 0
    return result

  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    return result
  }
}

/**
 * Sync billing transactions for a specific client using their shipment IDs
 * This is more accurate than querying all billing data and trying to attribute later
 */
export async function syncClientBilling(
  clientId: string,
  shipmentIds: string[]
): Promise<{ transactionsFound: number; transactionsInserted: number; errors: string[] }> {
  const result = {
    transactionsFound: 0,
    transactionsInserted: 0,
    errors: [] as string[],
  }

  if (shipmentIds.length === 0) {
    return result
  }

  const parentToken = process.env.SHIPBOB_API_TOKEN
  if (!parentToken) {
    result.errors.push('SHIPBOB_API_TOKEN not configured')
    return result
  }

  const shipbob = new ShipBobClient(parentToken)
  const supabase = createAdminClient()

  // Query billing API in batches using reference_ids
  const batchSize = 100
  const allTransactions: ShipBobTransaction[] = []

  for (let i = 0; i < shipmentIds.length; i += batchSize) {
    const batch = shipmentIds.slice(i, i + batchSize)

    try {
      const txResponse = await shipbob.billing.queryTransactions({
        reference_ids: batch,
        page_size: 1000,
      })

      allTransactions.push(...(txResponse.items || []))
    } catch (err) {
      result.errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${err instanceof Error ? err.message : 'Unknown error'}`)
    }
  }

  result.transactionsFound = allTransactions.length

  // Insert transactions with client_id already known
  for (const tx of allTransactions) {
    const txData = {
      ...mapTransaction(tx),
      client_id: clientId,
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (supabase as any)
      .from('transactions')
      .upsert(
        { ...txData, created_at: new Date().toISOString() },
        { onConflict: 'transaction_id' }
      )

    if (error) {
      result.errors.push(`Tx ${tx.transaction_id}: ${error.message}`)
    } else {
      result.transactionsInserted++
    }
  }

  return result
}

/**
 * Full sync: Orders (per brand) + Billing (parent)
 */
export interface FullSyncResult {
  orders: SyncResult[]
  billing: BillingSyncResult
}

export async function syncAll(daysBack: number = 30): Promise<FullSyncResult> {
  // Sync orders first (needed for client attribution)
  const orderResults = await syncAllClients(daysBack)

  // Sync billing per-client using their shipment IDs (more accurate)
  let totalClientTx = 0
  for (const orderResult of orderResults) {
    if (orderResult.shipmentIds.length > 0) {
      const billingResult = await syncClientBilling(orderResult.clientId, orderResult.shipmentIds)
      totalClientTx += billingResult.transactionsInserted
      console.log(`  ${orderResult.clientId}: ${billingResult.transactionsFound} tx found, ${billingResult.transactionsInserted} inserted`)
    }
  }
  console.log(`Total client-attributed transactions: ${totalClientTx}`)

  // Also sync invoices and any remaining transactions (storage, etc.)
  const billingResult = await syncBillingTransactions(daysBack)

  return {
    orders: orderResults,
    billing: billingResult,
  }
}
