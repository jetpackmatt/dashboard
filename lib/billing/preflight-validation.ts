/**
 * Pre-Flight Validation for Invoice Generation
 *
 * Validates that ALL required data is populated before generating invoices.
 * Checks every field that appears in the XLS output to ensure no blank columns.
 */

import { SupabaseClient } from '@supabase/supabase-js'

const PAGE_SIZE = 1000 // Supabase default limit - all queries are paginated to handle >1000 records

export interface ValidationResult {
  passed: boolean
  issues: ValidationIssue[]
  warnings: ValidationWarning[]
  summary: ValidationSummary
}

export interface ValidationSummary {
  // Transaction counts and ShipBob costs
  shippingTransactions: number
  shippingCost: number
  additionalServiceTransactions: number
  additionalServiceCost: number
  storageTransactions: number
  storageCost: number
  returnsTransactions: number
  returnsCost: number
  receivingTransactions: number
  receivingCost: number
  creditsTransactions: number
  creditsCost: number

  // Shipments sheet field completion
  shipments: {
    total: number
    withTrackingId: number
    withBaseCost: number
    withCarrier: number
    withCarrierService: number
    withZone: number
    withWeights: number
    withDimensions: number
    withEventLabeled: number
    withEventCreated: number  // Order created timestamp
    withProductsSold: number
    withCustomerName: number
    withZipCode: number
    withStoreOrderId: number  // From orders table
  }

  // Additional Services sheet field completion
  additionalServices: {
    total: number
    withReferenceId: number
    withFeeType: number
    withTransactionDate: number
  }

  // Returns sheet field completion
  returns: {
    total: number
    withReturnId: number
    withOriginalShipmentId: number
    withTrackingId: number
    withReturnDate: number
    withFcName: number
    withReturnStatus: number  // From returns table
    withReturnType: number    // From returns table
  }

  // Receiving sheet field completion
  receiving: {
    total: number
    withWroId: number
    withFeeType: number
    withTransactionType: number
    withTransactionDate: number
  }

  // Storage sheet field completion
  storage: {
    total: number
    withFcName: number
    withInventoryId: number
    withSku: number
    withLocationType: number
  }

  // Credits sheet field completion
  credits: {
    total: number
    withReferenceId: number
    withTransactionDate: number
    withCreditReason: number
  }
}

export interface ValidationIssue {
  category: string
  severity: 'critical' | 'warning'
  message: string
  count: number
  percentage: number
  sampleIds?: string[]
  details?: Record<string, unknown>[]  // For debugging - additional context about the issue
}

export interface ValidationWarning {
  category: string
  message: string
  count: number
  percentage: number
}

// Thresholds for critical vs warning
// STRICT MODE: ANY missing data is critical and blocks invoice generation
const STRICT_MODE = true

/**
 * Run comprehensive pre-flight validation for invoice generation
 *
 * Checks ALL XLS fields across ALL sheets:
 * - Shipments: tracking_id, base_cost, carrier, carrier_service, zone, weights, dimensions, event_labeled, products_sold, customer_name
 * - Additional Services: order_id, fee_type, transaction_date
 * - Returns: return_id, order_id, tracking_id, return_date, fc_name
 * - Receiving: wro_id, fee_type, transaction_date
 * - Storage: charge_date, fc_name, inventory_id, sku, location_type
 * - Credits: reference_id, transaction_date, credit_reason
 */
export async function runPreflightValidation(
  supabase: SupabaseClient,
  clientId: string,
  invoiceIds: number[],
  periodStart?: string | null,
  periodEnd?: string | null
): Promise<ValidationResult> {
  const issues: ValidationIssue[] = []
  const warnings: ValidationWarning[] = []

  // ===== 1. Get all SHIPPING transactions (with pagination) =====
  const shippingTransactions: Record<string, unknown>[] = []
  let shippingOffset = 0
  let hasMoreShipping = true

  while (hasMoreShipping) {
    const { data: shippingBatch } = await supabase
      .from('transactions')
      .select('id, reference_id, base_cost, surcharge, tracking_id, cost, taxes')
      .eq('client_id', clientId)
      .eq('fee_type', 'Shipping')
      .eq('reference_type', 'Shipment')
      .in('invoice_id_sb', invoiceIds)
      .is('dispute_status', null) // Exclude disputed/invalid transactions
      .or('is_voided.is.null,is_voided.eq.false') // Exclude voided (duplicate) transactions
      .range(shippingOffset, shippingOffset + PAGE_SIZE - 1)

    if (shippingBatch && shippingBatch.length > 0) {
      shippingTransactions.push(...shippingBatch)
      shippingOffset += shippingBatch.length
      hasMoreShipping = shippingBatch.length === PAGE_SIZE
    } else {
      hasMoreShipping = false
    }
  }
  const shipmentIds = shippingTransactions
    .filter(tx => tx.reference_id)
    .map(tx => tx.reference_id as string)

  // ===== 2. Get shipments table data for XLS fields =====
  let shipmentsData: Record<string, unknown>[] = []
  if (shipmentIds.length > 0) {
    const { data } = await supabase
      .from('shipments')
      .select(`
        shipment_id, tracking_id, carrier, carrier_service, ship_option_id,
        zone_used, actual_weight_oz, dim_weight_oz, billable_weight_oz,
        length, width, height, event_labeled, event_created, fc_name, order_id,
        recipient_name
      `)
      .eq('client_id', clientId)
      .in('shipment_id', shipmentIds.slice(0, 500)) // First batch

    shipmentsData = data || []

    // Fetch remaining batches
    for (let i = 500; i < shipmentIds.length; i += 500) {
      const { data: batch } = await supabase
        .from('shipments')
        .select(`
          shipment_id, tracking_id, carrier, carrier_service, ship_option_id,
          zone_used, actual_weight_oz, dim_weight_oz, billable_weight_oz,
          length, width, height, event_labeled, event_created, fc_name, order_id,
          recipient_name
        `)
        .eq('client_id', clientId)
        .in('shipment_id', shipmentIds.slice(i, i + 500))

      if (batch) shipmentsData.push(...batch)
    }
  }

  // ===== 3. Get shipment_items for Products Sold / Quantity =====
  // IMPORTANT: Supabase caps at 1000 rows regardless of .limit() value!
  // Use batch size of 50 shipments to stay safely under 1000 items (50 × 18 max = 900)
  let shipmentItemsData: Record<string, unknown>[] = []
  if (shipmentIds.length > 0) {
    for (let i = 0; i < shipmentIds.length; i += 50) {
      const { data } = await supabase
        .from('shipment_items')
        .select('shipment_id, name, quantity')
        .eq('client_id', clientId)
        .in('shipment_id', shipmentIds.slice(i, i + 50))
        .limit(1000) // Supabase hard caps at 1000

      if (data) shipmentItemsData.push(...data)
    }
  }

  // Build shipment_items lookup
  const shipmentItemsMap = new Map<string, { hasName: boolean; hasQuantity: boolean }>()
  for (const item of shipmentItemsData) {
    const sid = String(item.shipment_id)
    const existing = shipmentItemsMap.get(sid) || { hasName: false, hasQuantity: false }
    if (item.name) existing.hasName = true
    if (item.quantity !== null && item.quantity !== undefined) existing.hasQuantity = true
    shipmentItemsMap.set(sid, existing)
  }

  // ===== 4. Get orders for customer name, address =====
  const orderIds = [...new Set(shipmentsData.map(s => s.order_id).filter(Boolean))] as string[]
  let ordersData: Record<string, unknown>[] = []
  if (orderIds.length > 0) {
    for (let i = 0; i < orderIds.length; i += 50) {
      const { data } = await supabase
        .from('orders')
        .select('id, customer_name, zip_code, city, state, country, store_order_id, channel_name, order_type')
        .in('id', orderIds.slice(i, i + 50))

      if (data) ordersData.push(...data)
    }
  }

  // ===== 4b. Get order_items as fallback for products_sold =====
  // Fallback cases:
  // 1. shipment_items exist with name but missing quantity -> use order_items.quantity
  // 2. NO shipment_items exist at all -> use order_items for both name and quantity
  const shipmentToOrderMap = new Map(shipmentsData.map(s => [String(s.shipment_id), String(s.order_id)]))

  // Find shipments missing quantity (have name but no quantity)
  const shipmentsMissingQty = [...shipmentItemsMap.entries()]
    .filter(([, v]) => v.hasName && !v.hasQuantity)
    .map(([sid]) => sid)

  // Find shipments with NO shipment_items at all
  const shipmentsWithNoItems = shipmentsData
    .map(s => String(s.shipment_id))
    .filter(sid => !shipmentItemsMap.has(sid))

  // Combine both sets of shipments needing fallback
  const allShipmentsNeedingFallback = [...new Set([...shipmentsMissingQty, ...shipmentsWithNoItems])]

  if (allShipmentsNeedingFallback.length > 0) {
    // Get order_ids for shipments needing fallback
    const orderIdsForFallback = [...new Set(
      allShipmentsNeedingFallback.map(sid => shipmentToOrderMap.get(sid)).filter(Boolean)
    )] as string[]

    // Fetch order_items for these orders
    // Note: order_items has sku (not name), so we use sku as fallback for product name
    let orderItemsData: Record<string, unknown>[] = []
    for (let i = 0; i < orderIdsForFallback.length; i += 50) {
      const { data } = await supabase
        .from('order_items')
        .select('order_id, sku, quantity')
        .in('order_id', orderIdsForFallback.slice(i, i + 50))
        .limit(1000)

      if (data) orderItemsData.push(...data)
    }

    // Build order_id -> { hasName, hasQuantity } lookup
    // Use sku as fallback for name (it's always populated in order_items)
    const orderItemsMap = new Map<string, { hasName: boolean; hasQuantity: boolean }>()
    for (const item of orderItemsData) {
      const oid = String(item.order_id)
      const existing = orderItemsMap.get(oid) || { hasName: false, hasQuantity: false }
      if (item.sku) existing.hasName = true  // SKU serves as product identifier
      if (item.quantity !== null && item.quantity !== undefined) existing.hasQuantity = true
      orderItemsMap.set(oid, existing)
    }

    // Update shipmentItemsMap with fallback from order_items
    for (const sid of allShipmentsNeedingFallback) {
      const orderId = shipmentToOrderMap.get(sid)
      if (orderId) {
        const orderItems = orderItemsMap.get(orderId)
        if (orderItems) {
          const existing = shipmentItemsMap.get(sid) || { hasName: false, hasQuantity: false }
          // Use order_items as fallback for missing fields
          if (orderItems.hasName && !existing.hasName) existing.hasName = true
          if (orderItems.hasQuantity && !existing.hasQuantity) existing.hasQuantity = true
          shipmentItemsMap.set(sid, existing)
        }
      }
    }
  }
  const orderDataMap = new Map(ordersData.map(o => [String(o.id), o]))

  // ===== 5. Get ADDITIONAL SERVICES transactions (with pagination) =====
  // Includes: Per Pick Fee, B2B fees (reference_type='Shipment')
  // Also includes: Inventory Placement Program Fee (reference_type='WRO' but not a receiving fee)
  // Also includes: VAS - Paid Requests (reference_type='TicketNumber')
  const additionalServicesTransactions: Record<string, unknown>[] = []
  const addlIds = new Set<string>()
  let addlOffset = 0
  let hasMoreAddl = true

  // First query: reference_type='Shipment' (Per Pick Fee, B2B fees, etc.)
  while (hasMoreAddl) {
    const { data: addlBatch } = await supabase
      .from('transactions')
      .select('id, reference_id, fee_type, charge_date, cost')
      .eq('client_id', clientId)
      .eq('reference_type', 'Shipment')
      .neq('fee_type', 'Shipping')
      .neq('fee_type', 'Credit')
      .in('invoice_id_sb', invoiceIds)
      .is('dispute_status', null)
      .range(addlOffset, addlOffset + PAGE_SIZE - 1)

    if (addlBatch && addlBatch.length > 0) {
      for (const tx of addlBatch) {
        if (!addlIds.has(tx.id as string)) {
          addlIds.add(tx.id as string)
          additionalServicesTransactions.push(tx)
        }
      }
      addlOffset += addlBatch.length
      hasMoreAddl = addlBatch.length === PAGE_SIZE
    } else {
      hasMoreAddl = false
    }
  }

  // Second query: Inventory Placement Program Fee (reference_type='WRO' but not a receiving fee)
  addlOffset = 0
  hasMoreAddl = true
  while (hasMoreAddl) {
    const { data: addlBatch } = await supabase
      .from('transactions')
      .select('id, reference_id, fee_type, charge_date, cost')
      .eq('client_id', clientId)
      .eq('reference_type', 'WRO')
      .ilike('fee_type', '%Inventory Placement%')
      .in('invoice_id_sb', invoiceIds)
      .is('dispute_status', null)
      .range(addlOffset, addlOffset + PAGE_SIZE - 1)

    if (addlBatch && addlBatch.length > 0) {
      for (const tx of addlBatch) {
        if (!addlIds.has(tx.id as string)) {
          addlIds.add(tx.id as string)
          additionalServicesTransactions.push(tx)
        }
      }
      addlOffset += addlBatch.length
      hasMoreAddl = addlBatch.length === PAGE_SIZE
    } else {
      hasMoreAddl = false
    }
  }

  // Third query: VAS fees (reference_type='TicketNumber') and other misc addl fees
  addlOffset = 0
  hasMoreAddl = true
  while (hasMoreAddl) {
    const { data: addlBatch } = await supabase
      .from('transactions')
      .select('id, reference_id, fee_type, charge_date, cost')
      .eq('client_id', clientId)
      .eq('reference_type', 'TicketNumber')
      .in('invoice_id_sb', invoiceIds)
      .is('dispute_status', null)
      .range(addlOffset, addlOffset + PAGE_SIZE - 1)

    if (addlBatch && addlBatch.length > 0) {
      for (const tx of addlBatch) {
        if (!addlIds.has(tx.id as string)) {
          addlIds.add(tx.id as string)
          additionalServicesTransactions.push(tx)
        }
      }
      addlOffset += addlBatch.length
      hasMoreAddl = addlBatch.length === PAGE_SIZE
    } else {
      hasMoreAddl = false
    }
  }

  // ===== 6. Get STORAGE transactions (with pagination) =====
  // NOTE: Storage transactions may have NULL invoice_id_sb when invoices just closed.
  // We query both by invoice_id AND by date range, then deduplicate.
  const storageTransactions: Record<string, unknown>[] = []
  const storageIds = new Set<string>()
  let storageOffset = 0
  let hasMoreStorage = true

  // First, query by invoice_id_sb (for transactions already linked)
  while (hasMoreStorage) {
    const { data: storageBatch } = await supabase
      .from('transactions')
      .select('id, reference_id, fulfillment_center, additional_details, cost')
      .eq('client_id', clientId)
      .eq('reference_type', 'FC')
      .in('invoice_id_sb', invoiceIds)
      .is('dispute_status', null)
      .range(storageOffset, storageOffset + PAGE_SIZE - 1)

    if (storageBatch && storageBatch.length > 0) {
      for (const tx of storageBatch) {
        if (!storageIds.has(tx.id as string)) {
          storageIds.add(tx.id as string)
          storageTransactions.push(tx)
        }
      }
      storageOffset += storageBatch.length
      hasMoreStorage = storageBatch.length === PAGE_SIZE
    } else {
      hasMoreStorage = false
    }
  }

  // Also query by date range for transactions with NULL invoice_id_sb (recently closed invoices)
  if (periodStart && periodEnd) {
    storageOffset = 0
    hasMoreStorage = true
    while (hasMoreStorage) {
      const { data: storageBatch } = await supabase
        .from('transactions')
        .select('id, reference_id, fulfillment_center, additional_details, cost')
        .eq('client_id', clientId)
        .eq('reference_type', 'FC')
        .is('invoice_id_sb', null)
        .gte('charge_date', periodStart)
        .lte('charge_date', periodEnd)
        .is('dispute_status', null)
        .range(storageOffset, storageOffset + PAGE_SIZE - 1)

      if (storageBatch && storageBatch.length > 0) {
        for (const tx of storageBatch) {
          if (!storageIds.has(tx.id as string)) {
            storageIds.add(tx.id as string)
            storageTransactions.push(tx)
          }
        }
        storageOffset += storageBatch.length
        hasMoreStorage = storageBatch.length === PAGE_SIZE
      } else {
        hasMoreStorage = false
      }
    }
  }

  // ===== 7. Get RETURNS transactions (with pagination) =====
  const returnsTransactions: Record<string, unknown>[] = []
  let returnsOffset = 0
  let hasMoreReturns = true

  while (hasMoreReturns) {
    const { data: returnsBatch } = await supabase
      .from('transactions')
      .select('id, reference_id, tracking_id, fulfillment_center, cost')
      .eq('client_id', clientId)
      .eq('reference_type', 'Return')
      .in('invoice_id_sb', invoiceIds)
      .is('dispute_status', null)
      .range(returnsOffset, returnsOffset + PAGE_SIZE - 1)

    if (returnsBatch && returnsBatch.length > 0) {
      returnsTransactions.push(...returnsBatch)
      returnsOffset += returnsBatch.length
      hasMoreReturns = returnsBatch.length === PAGE_SIZE
    } else {
      hasMoreReturns = false
    }
  }

  const returnIds = returnsTransactions
    .filter(tx => tx.reference_id)
    .map(tx => tx.reference_id as string)

  // Get returns table data (with pagination)
  let returnsData: Record<string, unknown>[] = []
  if (returnIds.length > 0) {
    // Batch by 500 IDs at a time for the .in() query
    for (let i = 0; i < returnIds.length; i += 500) {
      const { data } = await supabase
        .from('returns')
        .select('shipbob_return_id, insert_date, original_shipment_id, tracking_number, status, return_type')
        .in('shipbob_return_id', returnIds.slice(i, i + 500))

      if (data) returnsData.push(...data)
    }
  }
  const returnsDataMap = new Map(returnsData.map(r => [String(r.shipbob_return_id), r]))

  // ===== 8. Get RECEIVING (WRO) transactions (with pagination) =====
  // Only include actual receiving fees - exclude "Inventory Placement Program Fee" which goes to Additional Services
  const receivingTransactions: Record<string, unknown>[] = []
  let receivingOffset = 0
  let hasMoreReceiving = true

  while (hasMoreReceiving) {
    const { data: receivingBatch } = await supabase
      .from('transactions')
      .select('id, reference_id, fee_type, transaction_type, charge_date, cost')
      .eq('client_id', clientId)
      .eq('reference_type', 'WRO')
      .like('fee_type', 'WRO%')  // Only actual WRO fees (WRO Receiving Fee, etc.)
      .in('invoice_id_sb', invoiceIds)
      .is('dispute_status', null)
      .range(receivingOffset, receivingOffset + PAGE_SIZE - 1)

    if (receivingBatch && receivingBatch.length > 0) {
      receivingTransactions.push(...receivingBatch)
      receivingOffset += receivingBatch.length
      hasMoreReceiving = receivingBatch.length === PAGE_SIZE
    } else {
      hasMoreReceiving = false
    }
  }

  // ===== 9. Get CREDITS transactions (with pagination) =====
  const creditsTransactions: Record<string, unknown>[] = []
  let creditsOffset = 0
  let hasMoreCredits = true

  while (hasMoreCredits) {
    const { data: creditsBatch } = await supabase
      .from('transactions')
      .select('id, reference_id, charge_date, additional_details, cost')
      .eq('client_id', clientId)
      .eq('fee_type', 'Credit')
      .in('invoice_id_sb', invoiceIds)
      .is('dispute_status', null)
      .range(creditsOffset, creditsOffset + PAGE_SIZE - 1)

    if (creditsBatch && creditsBatch.length > 0) {
      creditsTransactions.push(...creditsBatch)
      creditsOffset += creditsBatch.length
      hasMoreCredits = creditsBatch.length === PAGE_SIZE
    } else {
      hasMoreCredits = false
    }
  }

  // ===== BUILD SUMMARY =====
  const shipmentsDataMap = new Map(shipmentsData.map(s => [String(s.shipment_id), s]))

  // Calculate total ShipBob costs (before markup)
  // Note: Supabase returns numeric as string, so we parse it
  const parseNum = (val: unknown): number => {
    if (val === null || val === undefined) return 0
    const num = typeof val === 'number' ? val : parseFloat(String(val))
    return isNaN(num) ? 0 : num
  }

  // For shipping: use base_cost + surcharge (SFTP) if available, else cost
  // Helper to sum taxes from JSONB array: [{tax_type, tax_rate, tax_amount}, ...]
  const sumTaxes = (taxes: unknown): number => {
    if (!taxes || !Array.isArray(taxes)) return 0
    return taxes.reduce((sum, t) => sum + (parseFloat(t?.tax_amount) || 0), 0)
  }

  const sumShippingCost = (txs: Record<string, unknown>[]) =>
    txs.reduce((sum, tx) => {
      const baseCost = parseNum(tx.base_cost)
      const surcharge = parseNum(tx.surcharge)
      const taxes = sumTaxes(tx.taxes)
      if (baseCost !== 0 || surcharge !== 0) {
        return sum + baseCost + surcharge + taxes
      }
      // Fallback to cost column (which already includes taxes from API)
      return sum + parseNum(tx.cost)
    }, 0)

  // For everything else: use cost column
  const sumCost = (txs: Record<string, unknown>[]) =>
    txs.reduce((sum, tx) => sum + parseNum(tx.cost), 0)

  const summary: ValidationSummary = {
    shippingTransactions: shippingTransactions.length,
    shippingCost: sumShippingCost(shippingTransactions),
    additionalServiceTransactions: additionalServicesTransactions.length,
    additionalServiceCost: sumCost(additionalServicesTransactions),
    storageTransactions: storageTransactions.length,
    storageCost: sumCost(storageTransactions),
    returnsTransactions: returnsTransactions.length,
    returnsCost: sumCost(returnsTransactions),
    receivingTransactions: receivingTransactions.length,
    receivingCost: sumCost(receivingTransactions),
    creditsTransactions: creditsTransactions.length,
    creditsCost: sumCost(creditsTransactions),

    shipments: {
      total: shipmentsData.length,
      withTrackingId: shipmentsData.filter(s => s.tracking_id).length,
      withBaseCost: shippingTransactions.filter(tx => tx.base_cost !== null).length,
      withCarrier: shipmentsData.filter(s => s.carrier).length,
      withCarrierService: shipmentsData.filter(s => s.carrier_service).length,
      withZone: shipmentsData.filter(s => s.zone_used !== null).length,
      withWeights: shipmentsData.filter(s => s.actual_weight_oz !== null || s.billable_weight_oz !== null).length,
      withDimensions: shipmentsData.filter(s => s.length !== null && s.width !== null && s.height !== null).length,
      withEventLabeled: shipmentsData.filter(s => s.event_labeled).length,
      withEventCreated: shipmentsData.filter(s => s.event_created).length,
      // Products sold: both name and quantity required (quantity falls back to order_items)
      // Exception: B2B orders and manual orders
      withProductsSold: shipmentsData.filter(s => {
        const sid = String(s.shipment_id)
        const items = shipmentItemsMap.get(sid)
        const order = orderDataMap.get(String(s.order_id))
        const o = order as { order_type?: string; store_order_id?: string; channel_name?: string } | undefined

        // B2B orders don't have quantity data - skip validation
        if (o?.order_type === 'B2B') return true

        // Manual orders (no store_order_id and ShipBob Default/N/A/null channel) - skip validation
        const isManualOrder = !o?.store_order_id &&
          (!o?.channel_name || o.channel_name === 'ShipBob Default' || o.channel_name === 'N/A')
        if (isManualOrder) return true

        // Normal orders: require both name and quantity
        return items?.hasName && items?.hasQuantity
      }).length,
      withCustomerName: shipmentsData.filter(s => {
        // Primary: orders.customer_name
        const order = orderDataMap.get(String(s.order_id))
        const customerName = order ? (order as { customer_name?: string }).customer_name : null
        if (customerName && String(customerName).trim()) return true
        // Fallback: shipments.recipient_name (trimmed to catch whitespace-only values like " ")
        const recipientName = (s as { recipient_name?: string }).recipient_name
        return !!(recipientName && String(recipientName).trim())
      }).length,
      // Zip code: required for US, optional for international (many countries don't use them)
      withZipCode: shipmentsData.filter(s => {
        const order = orderDataMap.get(String(s.order_id))
        if (!order) return false
        const o = order as { zip_code?: string; country?: string }
        // Non-US countries may legitimately not have zip codes
        if (o.country && o.country !== 'US') return true
        return !!o.zip_code
      }).length,
      // store_order_id: only required for DTC orders from external channels
      // Manual orders (ShipBob Default, N/A channels) and B2B orders don't have external store IDs
      withStoreOrderId: shipmentsData.filter(s => {
        const order = orderDataMap.get(String(s.order_id))
        if (!order) return false
        const o = order as { store_order_id?: string; channel_name?: string; order_type?: string }
        // B2B orders don't have external store_order_id - this is expected
        if (o.order_type === 'B2B') return true
        // ShipBob Default and N/A channel orders are manually created - no external store ID
        if (o.channel_name === 'ShipBob Default' || o.channel_name === 'N/A' || !o.channel_name) return true
        return !!o.store_order_id
      }).length,
    },

    additionalServices: {
      total: additionalServicesTransactions.length,
      withReferenceId: additionalServicesTransactions.filter(tx => tx.reference_id).length,
      withFeeType: additionalServicesTransactions.filter(tx => tx.fee_type).length,
      withTransactionDate: additionalServicesTransactions.filter(tx => tx.charge_date).length,
    },

    returns: {
      total: returnsTransactions.length,
      withReturnId: returnsTransactions.filter(tx => tx.reference_id).length,
      withOriginalShipmentId: [...returnsDataMap.values()].filter(r => (r as { original_shipment_id?: number }).original_shipment_id).length,
      // tracking_number is in returns table, not transactions
      withTrackingId: [...returnsDataMap.values()].filter(r => (r as { tracking_number?: string }).tracking_number).length,
      withReturnDate: [...returnsDataMap.values()].filter(r => (r as { insert_date?: string }).insert_date).length,
      withFcName: returnsTransactions.filter(tx => tx.fulfillment_center).length,
      withReturnStatus: [...returnsDataMap.values()].filter(r => (r as { status?: string }).status).length,
      withReturnType: [...returnsDataMap.values()].filter(r => (r as { return_type?: string }).return_type).length,
    },

    receiving: {
      total: receivingTransactions.length,
      withWroId: receivingTransactions.filter(tx => tx.reference_id).length,
      withFeeType: receivingTransactions.filter(tx => tx.fee_type).length,
      // transaction_type may be null if fee_type already contains the type info
      withTransactionType: receivingTransactions.filter(tx => tx.transaction_type || tx.fee_type).length,
      withTransactionDate: receivingTransactions.filter(tx => tx.charge_date).length,
    },

    storage: {
      total: storageTransactions.length,
      withFcName: storageTransactions.filter(tx => tx.fulfillment_center).length,
      withInventoryId: storageTransactions.filter(tx => {
        // Try additional_details first, then fall back to parsing reference_id
        // reference_id format: FC_ID-InventoryId-LocationType (e.g., "183-21600394-Pallet")
        const details = tx.additional_details as { InventoryId?: string } | null
        if (details?.InventoryId) return true
        // Parse from reference_id
        const refId = tx.reference_id as string | null
        if (refId) {
          const parts = refId.split('-')
          if (parts.length >= 2 && parts[1]) return true
        }
        return false
      }).length,
      withSku: storageTransactions.filter(tx => {
        // SKU is NOT available from ShipBob transaction API
        // Would need to lookup from inventory table by InventoryId
        // For now, skip this check as it's never populated
        const details = tx.additional_details as { SKU?: string } | null
        return details?.SKU
      }).length,
      withLocationType: storageTransactions.filter(tx => {
        // Try additional_details first, then fall back to parsing reference_id
        // reference_id format: FC_ID-InventoryId-LocationType (e.g., "183-21600394-Pallet")
        const details = tx.additional_details as { LocationType?: string } | null
        if (details?.LocationType) return true
        // Parse from reference_id
        const refId = tx.reference_id as string | null
        if (refId) {
          const parts = refId.split('-')
          if (parts.length >= 3 && parts[2]) return true
        }
        return false
      }).length,
    },

    credits: {
      total: creditsTransactions.length,
      withReferenceId: creditsTransactions.filter(tx => tx.reference_id).length,
      withTransactionDate: creditsTransactions.filter(tx => tx.charge_date).length,
      withCreditReason: creditsTransactions.filter(tx => {
        const details = tx.additional_details as { Comment?: string; CreditReason?: string } | null
        return details?.Comment || details?.CreditReason
      }).length,
    },
  }

  // ===== CHECK FOR ISSUES =====

  // Helper function - categoryLabel is human-readable name for the transaction type
  const checkField = (
    category: string,
    fieldName: string,
    total: number,
    withField: number,
    categoryLabel: string = 'records' // Human-readable label (e.g., "shipments", "returns", "storage")
  ) => {
    if (total === 0) return

    const missing = total - withField
    const pct = Math.round((missing / total) * 100)

    if (missing === 0) return

    // STRICT MODE: ANY missing data is critical and blocks invoice generation
    if (STRICT_MODE) {
      issues.push({
        category,
        severity: 'critical',
        message: `${missing} ${categoryLabel} (${pct}%) missing ${fieldName}`,
        count: missing,
        percentage: pct,
      })
    } else {
      // Non-strict mode: only warn
      warnings.push({
        category,
        message: `${missing} ${categoryLabel} (${pct}%) missing ${fieldName}`,
        count: missing,
        percentage: pct,
      })
    }
  }

  // SHIPMENTS SHEET VALIDATIONS
  const s = summary.shipments
  checkField('SHIPMENTS', 'tracking_id', s.total, s.withTrackingId, 'shipments')
  checkField('SFTP_BREAKDOWN', 'base_cost (SFTP breakdown)', shippingTransactions.length, s.withBaseCost, 'shipments')
  checkField('SHIPMENTS', 'carrier', s.total, s.withCarrier, 'shipments')
  checkField('SHIPMENTS', 'carrier_service', s.total, s.withCarrierService, 'shipments')
  checkField('SHIPMENTS', 'zone_used', s.total, s.withZone, 'shipments')
  checkField('SHIPMENTS', 'weights (actual/billable)', s.total, s.withWeights, 'shipments')
  checkField('SHIPMENTS', 'dimensions (L×W×H)', s.total, s.withDimensions, 'shipments')
  checkField('TIMELINE', 'event_labeled (transaction date)', s.total, s.withEventLabeled, 'shipments')
  checkField('TIMELINE', 'event_created (order created)', s.total, s.withEventCreated, 'shipments')
  checkField('SHIPMENT_ITEMS', 'products_sold & quantity', s.total, s.withProductsSold, 'shipments')
  checkField('ORDERS', 'customer_name', s.total, s.withCustomerName, 'shipments')
  checkField('ORDERS', 'zip_code', s.total, s.withZipCode, 'shipments')
  checkField('ORDERS', 'store_order_id', s.total, s.withStoreOrderId, 'shipments')

  // ORPHANED TRACKING ID CHECK
  // Detects shipping transactions whose tracking_id doesn't match the shipment's current tracking_id
  // This can happen when a label is voided/replaced - the transaction exists but the tracking is no longer valid
  const orphanedTrackingTx = shippingTransactions.filter(tx => {
    // Skip negative-cost transactions (voided label credits carry the old tracking
    // intentionally — they reference the label being refunded, not the current label)
    const cost = typeof tx.cost === 'number' ? tx.cost : parseFloat(String(tx.cost))
    if (cost < 0) return false

    const shipmentId = String(tx.reference_id)
    const shipment = shipmentsDataMap.get(shipmentId)
    if (!shipment) return false // Skip if we can't find the shipment
    const txTracking = tx.tracking_id as string | null
    const shipmentTracking = shipment.tracking_id as string | null
    // Flag if tracking IDs don't match (and both exist)
    return txTracking && shipmentTracking && txTracking !== shipmentTracking
  })

  if (orphanedTrackingTx.length > 0) {
    // This is a critical issue - likely a voided/duplicate charge
    issues.push({
      category: 'ORPHANED_TRACKING',
      severity: 'critical',
      message: `${orphanedTrackingTx.length} shipping transaction(s) have tracking IDs that don't match the shipment's current tracking (possible voided labels still being billed)`,
      count: orphanedTrackingTx.length,
      percentage: Math.round((orphanedTrackingTx.length / shippingTransactions.length) * 100),
      // Include details for debugging
      details: orphanedTrackingTx.slice(0, 5).map(tx => ({
        shipment_id: tx.reference_id,
        tx_tracking: tx.tracking_id,
        shipment_tracking: shipmentsDataMap.get(String(tx.reference_id))?.tracking_id,
      })),
    })
  }

  // RETURNS SHEET VALIDATIONS
  const r = summary.returns
  if (r.total > 0) {
    checkField('RETURNS', 'return_id', r.total, r.withReturnId, 'returns')
    checkField('RETURNS', 'original_shipment_id', r.total, r.withOriginalShipmentId, 'returns')
    checkField('RETURNS', 'tracking_id', r.total, r.withTrackingId, 'returns')
    checkField('RETURNS', 'return_date', r.total, r.withReturnDate, 'returns')
    checkField('RETURNS', 'fc_name', r.total, r.withFcName, 'returns')
    checkField('RETURNS', 'return_status', r.total, r.withReturnStatus, 'returns')
    checkField('RETURNS', 'return_type', r.total, r.withReturnType, 'returns')
  }

  // ADDITIONAL SERVICES SHEET VALIDATIONS
  const as = summary.additionalServices
  if (as.total > 0) {
    checkField('ADDITIONAL_SERVICES', 'reference_id', as.total, as.withReferenceId, 'addl services')
    checkField('ADDITIONAL_SERVICES', 'fee_type', as.total, as.withFeeType, 'addl services')
    checkField('ADDITIONAL_SERVICES', 'transaction_date', as.total, as.withTransactionDate, 'addl services')
  }

  // RECEIVING SHEET VALIDATIONS
  const rec = summary.receiving
  if (rec.total > 0) {
    checkField('RECEIVING', 'wro_id', rec.total, rec.withWroId, 'receiving')
    checkField('RECEIVING', 'fee_type', rec.total, rec.withFeeType, 'receiving')
    checkField('RECEIVING', 'transaction_type', rec.total, rec.withTransactionType, 'receiving')
    checkField('RECEIVING', 'transaction_date', rec.total, rec.withTransactionDate, 'receiving')
  }

  // STORAGE SHEET VALIDATIONS
  const st = summary.storage
  if (st.total > 0) {
    checkField('STORAGE', 'fc_name', st.total, st.withFcName, 'storage')
    checkField('STORAGE', 'inventory_id', st.total, st.withInventoryId, 'storage')
    // SKU is NOT available from ShipBob transaction API - would need inventory table lookup
    // Skipping validation since it's never populated
    checkField('STORAGE', 'location_type', st.total, st.withLocationType, 'storage')
  }

  // CREDITS SHEET VALIDATIONS
  const cr = summary.credits
  if (cr.total > 0) {
    checkField('CREDITS', 'reference_id', cr.total, cr.withReferenceId, 'credits')
    checkField('CREDITS', 'transaction_date', cr.total, cr.withTransactionDate, 'credits')
    checkField('CREDITS', 'credit_reason', cr.total, cr.withCreditReason, 'credits')
  }

  // ===== DATA QUALITY CHECKS =====
  // These catch systemic issues that may not show up in field completeness checks

  // NOTE: Unattributed transaction check is now done ONCE at aggregate level in preflight API
  // (moved out of per-client validation to avoid showing same global issue for all clients)

  // 1. Check for duplicate transactions (same transaction_id appearing twice)
  await checkDuplicateTransactions(supabase, clientId, invoiceIds, issues, warnings)

  // 3. Check for Canadian FC transactions missing tax data
  await checkMissingCanadianTaxes(supabase, clientId, invoiceIds, issues, warnings)

  // 4. Check for unexpected fee amounts (e.g., Per Pick Fee not a multiple of expected rate)
  await checkUnexpectedFeeAmounts(supabase, clientId, invoiceIds, issues, warnings)

  // 5. Invoice ID validation is inherent - we query transactions WHERE invoice_id_sb IN (invoiceIds)
  // so all transactions we bill already have valid invoice IDs from the selected period

  // Determine if validation passed
  // Critical issues block invoice generation
  const hasCriticalIssues = issues.some(i => i.severity === 'critical')

  return {
    passed: !hasCriticalIssues,
    issues,
    warnings,
    summary,
  }
}

/**
 * Format validation result for logging
 */
export function formatValidationResult(result: ValidationResult): string {
  const lines: string[] = []
  const s = result.summary

  lines.push('╔══════════════════════════════════════════════════════════════╗')
  lines.push(`║  PRE-FLIGHT VALIDATION: ${result.passed ? '✅ PASSED' : '❌ BLOCKED'}                       ║`)
  lines.push('╠══════════════════════════════════════════════════════════════╣')

  lines.push('║ TRANSACTION COUNTS:                                          ║')
  lines.push(`║   Shipping: ${String(s.shippingTransactions).padEnd(6)} | Add\'l Svc: ${String(s.additionalServiceTransactions).padEnd(6)} | Storage: ${String(s.storageTransactions).padEnd(5)}║`)
  lines.push(`║   Returns: ${String(s.returnsTransactions).padEnd(7)} | Receiving: ${String(s.receivingTransactions).padEnd(6)} | Credits: ${String(s.creditsTransactions).padEnd(5)}║`)

  if (s.shipments.total > 0) {
    lines.push('╠══════════════════════════════════════════════════════════════╣')
    lines.push('║ SHIPMENTS SHEET FIELDS:                                      ║')
    lines.push(`║   Tracking ID:    ${formatPct(s.shipments.withTrackingId, s.shipments.total).padEnd(20)} Event Labeled: ${formatPct(s.shipments.withEventLabeled, s.shipments.total).padEnd(8)}║`)
    lines.push(`║   Base Cost:      ${formatPct(s.shipments.withBaseCost, s.shippingTransactions).padEnd(20)} Event Created: ${formatPct(s.shipments.withEventCreated, s.shipments.total).padEnd(8)}║`)
    lines.push(`║   Carrier:        ${formatPct(s.shipments.withCarrier, s.shipments.total).padEnd(20)} Products Sold: ${formatPct(s.shipments.withProductsSold, s.shipments.total).padEnd(8)}║`)
    lines.push(`║   Carrier Svc:    ${formatPct(s.shipments.withCarrierService, s.shipments.total).padEnd(20)} Customer Name: ${formatPct(s.shipments.withCustomerName, s.shipments.total).padEnd(8)}║`)
    lines.push(`║   Zone:           ${formatPct(s.shipments.withZone, s.shipments.total).padEnd(20)} Zip Code:      ${formatPct(s.shipments.withZipCode, s.shipments.total).padEnd(8)}║`)
    lines.push(`║   Weights:        ${formatPct(s.shipments.withWeights, s.shipments.total).padEnd(20)} Store Order:   ${formatPct(s.shipments.withStoreOrderId, s.shipments.total).padEnd(8)}║`)
    lines.push(`║   Dimensions:     ${formatPct(s.shipments.withDimensions, s.shipments.total).padEnd(20)}                        ║`)
  }

  if (s.returns.total > 0) {
    lines.push('╠══════════════════════════════════════════════════════════════╣')
    lines.push('║ RETURNS SHEET FIELDS:                                        ║')
    lines.push(`║   Return ID: ${formatPct(s.returns.withReturnId, s.returns.total).padEnd(15)} Return Date: ${formatPct(s.returns.withReturnDate, s.returns.total).padEnd(12)}║`)
    lines.push(`║   Orig Shipment: ${formatPct(s.returns.withOriginalShipmentId, s.returns.total).padEnd(11)} FC Name:     ${formatPct(s.returns.withFcName, s.returns.total).padEnd(12)}║`)
    lines.push(`║   Tracking ID:   ${formatPct(s.returns.withTrackingId, s.returns.total).padEnd(11)} Status:      ${formatPct(s.returns.withReturnStatus, s.returns.total).padEnd(12)}║`)
    lines.push(`║   Return Type:   ${formatPct(s.returns.withReturnType, s.returns.total).padEnd(11)}                         ║`)
  }

  if (s.additionalServices.total > 0) {
    lines.push('╠══════════════════════════════════════════════════════════════╣')
    lines.push('║ ADDITIONAL SERVICES SHEET FIELDS:                            ║')
    lines.push(`║   Reference ID: ${formatPct(s.additionalServices.withReferenceId, s.additionalServices.total).padEnd(18)} Fee Type:    ${formatPct(s.additionalServices.withFeeType, s.additionalServices.total).padEnd(10)}║`)
    lines.push(`║   Tx Date:      ${formatPct(s.additionalServices.withTransactionDate, s.additionalServices.total).padEnd(18)}                        ║`)
  }

  if (s.receiving.total > 0) {
    lines.push('╠══════════════════════════════════════════════════════════════╣')
    lines.push('║ RECEIVING SHEET FIELDS:                                      ║')
    lines.push(`║   WRO ID:       ${formatPct(s.receiving.withWroId, s.receiving.total).padEnd(15)} Fee Type:     ${formatPct(s.receiving.withFeeType, s.receiving.total).padEnd(10)}║`)
    lines.push(`║   Tx Type:      ${formatPct(s.receiving.withTransactionType, s.receiving.total).padEnd(15)} Tx Date:      ${formatPct(s.receiving.withTransactionDate, s.receiving.total).padEnd(10)}║`)
  }

  if (s.storage.total > 0) {
    lines.push('╠══════════════════════════════════════════════════════════════╣')
    lines.push('║ STORAGE SHEET FIELDS:                                        ║')
    lines.push(`║   FC Name:      ${formatPct(s.storage.withFcName, s.storage.total).padEnd(15)} Inventory ID: ${formatPct(s.storage.withInventoryId, s.storage.total).padEnd(10)}║`)
    lines.push(`║   SKU:          ${formatPct(s.storage.withSku, s.storage.total).padEnd(15)} Location Type: ${formatPct(s.storage.withLocationType, s.storage.total).padEnd(9)}║`)
  }

  if (s.credits.total > 0) {
    lines.push('╠══════════════════════════════════════════════════════════════╣')
    lines.push('║ CREDITS SHEET FIELDS:                                        ║')
    lines.push(`║   Reference ID: ${formatPct(s.credits.withReferenceId, s.credits.total).padEnd(15)} Tx Date:      ${formatPct(s.credits.withTransactionDate, s.credits.total).padEnd(10)}║`)
    lines.push(`║   Credit Reason: ${formatPct(s.credits.withCreditReason, s.credits.total).padEnd(15)}                       ║`)
  }

  if (result.issues.length > 0) {
    lines.push('╠══════════════════════════════════════════════════════════════╣')
    lines.push('║ ⚠️  ISSUES:                                                   ║')
    for (const issue of result.issues) {
      const icon = issue.severity === 'critical' ? '🚨' : '⚠️'
      const line = `${icon} [${issue.category}] ${issue.message}`
      lines.push(`║   ${line.padEnd(58)}║`)
    }
  }

  if (result.warnings.length > 0) {
    lines.push('╠══════════════════════════════════════════════════════════════╣')
    lines.push('║ ℹ️  WARNINGS:                                                 ║')
    for (const warning of result.warnings.slice(0, 5)) {
      const line = `[${warning.category}] ${warning.message}`
      lines.push(`║   ${line.padEnd(58)}║`)
    }
    if (result.warnings.length > 5) {
      lines.push(`║   ... and ${result.warnings.length - 5} more warnings                                  ║`)
    }
  }

  lines.push('╚══════════════════════════════════════════════════════════════╝')

  return lines.join('\n')
}

function formatPct(count: number, total: number): string {
  if (total === 0) return '0/0 (0%)'
  const pct = Math.round((count / total) * 100)
  return `${count}/${total} (${pct}%)`
}

// ===== DATA QUALITY CHECK HELPER FUNCTIONS =====

/**
 * Unattributed transaction details for UI display
 */
export interface UnattributedTransaction {
  transaction_id: string
  reference_id: string | null
  reference_type: string | null
  fee_type: string | null
  cost: number | null
  charge_date: string | null
  additional_details: Record<string, unknown> | null
}

/**
 * Get all unattributed transactions for the given invoice IDs
 * Returns full details for UI display and action
 */
export async function getUnattributedTransactions(
  supabase: SupabaseClient,
  invoiceIds: number[]
): Promise<UnattributedTransaction[]> {
  const { data, error } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, reference_type, fee_type, cost, charge_date, additional_details')
    .is('client_id', null)
    .is('dispute_status', null) // Exclude already disputed
    .in('invoice_id_sb', invoiceIds)
    .order('cost', { ascending: false }) // Highest cost first
    .limit(100)

  if (error) {
    console.error('Error fetching unattributed transactions:', error)
    return []
  }

  return (data || []) as UnattributedTransaction[]
}

/**
 * Check for transactions that are missing client_id attribution (GLOBAL check)
 * ALL transaction types should be attributed to a client
 * This runs ONCE at the aggregate level, not per-client
 */
export async function checkUnattributedTransactions(
  supabase: SupabaseClient,
  invoiceIds: number[]
): Promise<ValidationIssue | null> {
  // Query for ALL transactions with NULL client_id (any reference_type)
  const { data, error } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, reference_type, fee_type')
    .is('client_id', null)
    .is('dispute_status', null) // Exclude already disputed
    .in('invoice_id_sb', invoiceIds)
    .limit(200) // Sample for issue reporting

  if (error) {
    console.error('Error checking unattributed transactions:', error)
    return null
  }

  if (data && data.length > 0) {
    // Group by reference_type for better reporting
    const byType: Record<string, { count: number; samples: string[] }> = {}
    for (const tx of data) {
      const refType = tx.reference_type || 'Unknown'
      if (!byType[refType]) {
        byType[refType] = { count: 0, samples: [] }
      }
      byType[refType].count++
      if (byType[refType].samples.length < 3) {
        byType[refType].samples.push(tx.reference_id as string)
      }
    }

    // Build detailed message
    const typeBreakdown = Object.entries(byType)
      .map(([type, info]) => `${type}: ${info.count}`)
      .join(', ')

    // This is a critical issue - all transactions should have attribution
    return {
      category: 'DATA_QUALITY',
      severity: 'critical',
      message: `${data.length}+ transactions missing client_id attribution (${typeBreakdown})`,
      count: data.length,
      percentage: 0, // Can't calculate without total
      sampleIds: data.slice(0, 5).map(tx => `${tx.reference_type}:${tx.reference_id}`),
    }
  }
  return null
}

/**
 * Check for duplicate transactions (same transaction_id appearing multiple times)
 * This can cause double-billing if not caught
 */
async function checkDuplicateTransactions(
  supabase: SupabaseClient,
  clientId: string,
  invoiceIds: number[],
  issues: ValidationIssue[],
  warnings: ValidationWarning[]
): Promise<void> {
  // Query all transaction_ids for this client's invoices
  const { data: transactions, error } = await supabase
    .from('transactions')
    .select('transaction_id')
    .eq('client_id', clientId)
    .in('invoice_id_sb', invoiceIds)

  if (error) {
    warnings.push({
      category: 'DATA_QUALITY',
      message: `Duplicate transaction check failed: ${error.message}`,
      count: 0,
      percentage: 0,
    })
    return
  }

  // Find duplicates by counting occurrences
  const idCounts = new Map<string, number>()
  for (const tx of transactions || []) {
    const count = idCounts.get(tx.transaction_id) || 0
    idCounts.set(tx.transaction_id, count + 1)
  }

  const duplicates = Array.from(idCounts.entries())
    .filter(([, count]) => count > 1)
    .map(([id]) => id)

  if (duplicates.length > 0) {
    issues.push({
      category: 'DATA_QUALITY',
      severity: 'critical',
      message: `${duplicates.length} duplicate transactions detected`,
      count: duplicates.length,
      percentage: 0,
      sampleIds: duplicates.slice(0, 5),
    })
  }
}

/**
 * Check for Canadian FC transactions missing tax data
 * Brampton (Ontario) FC transactions should have 13% GST
 */
async function checkMissingCanadianTaxes(
  supabase: SupabaseClient,
  clientId: string,
  invoiceIds: number[],
  issues: ValidationIssue[],
  warnings: ValidationWarning[]
): Promise<void> {
  // Query for Canadian FC transactions without taxes
  // Brampton (Ontario province) transactions should have taxes calculated
  // NOTE: "Ontario 6 (CA)" is in California, NOT Canada! CA = California state abbreviation
  // Only match Brampton for now - it's our only Canadian FC
  const { data, error } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, fee_type, fulfillment_center, taxes, cost')
    .eq('client_id', clientId)
    .in('invoice_id_sb', invoiceIds)
    .ilike('fulfillment_center', '%brampton%')
    .is('dispute_status', null)

  if (error) {
    console.error('Error checking Canadian taxes:', error)
    return
  }

  if (!data) return

  // Check which Canadian FC transactions are missing taxes
  // Note: Invoice generator now calculates these at generation time for Storage
  // But Per Pick Fee still has API inconsistencies
  const missingTaxes = data.filter(tx => {
    // Skip if already has taxes
    if (tx.taxes && Array.isArray(tx.taxes) && tx.taxes.length > 0) return false

    // For Per Pick Fee, the API is inconsistent - sometimes taxes are embedded in cost
    // This is a known issue (Issue #5 from Dec 23)
    if (tx.fee_type === 'Per Pick Fee') {
      // Check if cost is a multiple of $0.25 (correct) or $0.28/$0.57 etc (GST embedded)
      const cost = Math.abs(parseFloat(String(tx.cost)))
      const isCleanMultiple = Math.abs(cost % 0.25) < 0.01 || Math.abs(cost % 0.26) < 0.01
      if (!isCleanMultiple) {
        return true // GST likely embedded in cost - flag for review
      }
    }

    return false
  })

  if (missingTaxes.length > 0) {
    // Per Pick Fee tax inconsistency is a warning, not critical
    // Storage taxes are now calculated at invoice generation time
    warnings.push({
      category: 'TAX_DATA',
      message: `${missingTaxes.length} Canadian Per Pick Fee transactions may have GST embedded in cost`,
      count: missingTaxes.length,
      percentage: Math.round((missingTaxes.length / data.length) * 100),
    })
  }
}

/**
 * Check for unexpected fee amounts that don't match expected rates
 * e.g., Per Pick Fee should be multiples of $0.26 (USA) or $0.25 (Canada)
 */
async function checkUnexpectedFeeAmounts(
  supabase: SupabaseClient,
  clientId: string,
  invoiceIds: number[],
  issues: ValidationIssue[],
  warnings: ValidationWarning[]
): Promise<void> {
  // Query Per Pick Fee transactions
  const { data, error } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id, cost, fulfillment_center')
    .eq('client_id', clientId)
    .eq('fee_type', 'Per Pick Fee')
    .in('invoice_id_sb', invoiceIds)
    .is('dispute_status', null)

  if (error) {
    console.error('Error checking fee amounts:', error)
    return
  }

  if (!data || data.length === 0) return

  // Expected rates:
  // USA: $0.26 per pick
  // Canada (Brampton): $0.25 per pick (but may have GST issues)
  const unexpectedAmounts: Array<{ id: string; cost: number; fc: string }> = []

  for (const tx of data) {
    const cost = Math.abs(parseFloat(String(tx.cost)))
    const fc = tx.fulfillment_center || ''
    // Note: "Ontario 6 (CA)" is in California (CA = California, not Canada!)
    // Only Brampton is Canadian. Canadian FCs would have country indicator like (ON) or specific Canadian names
    const isCanadian = /brampton/i.test(fc)

    // Check if it's a valid multiple
    const usaRate = 0.26
    const canadaRate = 0.25

    let isValid = false

    if (isCanadian) {
      // Canada: should be multiple of $0.25 (no tax) OR (N × $0.25 × 1.13) rounded (with HST)
      // HST amounts: $0.28 (1 pick), $0.57 (2 picks), $0.85 (3 picks), etc.
      // Check if it's a clean multiple of base rate (handle floating point precision)
      const remainder = cost % canadaRate
      const cleanMultiple = Math.abs(remainder) < 0.01 || Math.abs(remainder - canadaRate) < 0.01
      // Check if dividing by 1.13 gives a clean multiple of base rate (HST case)
      // Use 0.02 tolerance to account for different rounding methods (ShipBob may round differently)
      const impliedPicks = Math.round(cost / (canadaRate * 1.13))
      const expectedHstCost = Math.round(impliedPicks * canadaRate * 1.13 * 100) / 100
      const hstMultiple = impliedPicks > 0 && Math.abs(cost - expectedHstCost) < 0.02
      isValid = cleanMultiple || hstMultiple
    } else {
      // USA: should be multiple of $0.26
      // Handle floating point: remainder could be ~0 or ~usaRate due to precision
      const remainder = cost % usaRate
      isValid = Math.abs(remainder) < 0.01 || Math.abs(remainder - usaRate) < 0.01
    }

    if (!isValid && cost > 0.01) {
      unexpectedAmounts.push({
        id: tx.reference_id as string,
        cost,
        fc,
      })
    }
  }

  if (unexpectedAmounts.length > 0) {
    // Warn about unexpected amounts - could indicate data issues or rate changes
    warnings.push({
      category: 'FEE_AMOUNTS',
      message: `${unexpectedAmounts.length} Per Pick Fees with unexpected amounts (not multiples of expected rates)`,
      count: unexpectedAmounts.length,
      percentage: Math.round((unexpectedAmounts.length / data.length) * 100),
    })
  }
}

/**
 * Check that all transactions being billed have invoice_id_sb matching this week's invoices
 * This ensures we're only billing transactions that appear on the selected ShipBob invoices
 */
async function checkTransactionsHaveValidInvoiceIds(
  supabase: SupabaseClient,
  clientId: string,
  invoiceIds: number[],
  issues: ValidationIssue[],
  warnings: ValidationWarning[]
): Promise<void> {
  // This check is inherently satisfied by how we query transactions -
  // we only fetch transactions WHERE invoice_id_sb IN (invoiceIds)
  // So all transactions we're billing already have valid invoice IDs.
  //
  // The real check would be: are there transactions for this client that
  // have NULL invoice_id_sb? Those would be orphaned/unattributed.
  const { data: nullInvoiceTransactions, error } = await supabase
    .from('transactions')
    .select('transaction_id, fee_type')
    .eq('client_id', clientId)
    .is('invoice_id_sb', null)
    .is('dispute_status', null)
    .limit(10)

  if (error) {
    console.error('Error checking for null invoice transactions:', error)
    return
  }

  if (nullInvoiceTransactions && nullInvoiceTransactions.length > 0) {
    warnings.push({
      category: 'DATA_QUALITY',
      message: `${nullInvoiceTransactions.length}+ transactions have no invoice_id_sb (not linked to any ShipBob invoice)`,
      count: nullInvoiceTransactions.length,
      percentage: 0,
    })
  }
}
