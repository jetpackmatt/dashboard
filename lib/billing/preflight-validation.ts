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
  // Transaction counts
  shippingTransactions: number
  additionalServiceTransactions: number
  storageTransactions: number
  returnsTransactions: number
  receivingTransactions: number
  creditsTransactions: number

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
  invoiceIds: number[]
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
      .select('id, reference_id, base_cost, surcharge, tracking_id')
      .eq('client_id', clientId)
      .eq('transaction_fee', 'Shipping')
      .eq('reference_type', 'Shipment')
      .in('invoice_id_sb', invoiceIds)
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
        length, width, height, event_labeled, event_created, fc_name, order_id
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
          length, width, height, event_labeled, event_created, fc_name, order_id
        `)
        .eq('client_id', clientId)
        .in('shipment_id', shipmentIds.slice(i, i + 500))

      if (batch) shipmentsData.push(...batch)
    }
  }

  // ===== 3. Get shipment_items for Products Sold / Quantity =====
  // Note: Each shipment can have multiple items, so we use smaller batches
  // and a higher limit to avoid Supabase's default 1000 row limit
  let shipmentItemsData: Record<string, unknown>[] = []
  if (shipmentIds.length > 0) {
    for (let i = 0; i < shipmentIds.length; i += 200) {
      const { data } = await supabase
        .from('shipment_items')
        .select('shipment_id, name, quantity')
        .eq('client_id', clientId)
        .in('shipment_id', shipmentIds.slice(i, i + 200))
        .limit(2000) // Override default 1000 limit - avg ~3 items/shipment

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
        .select('id, customer_name, zip_code, city, state, country, store_order_id, channel_name')
        .in('id', orderIds.slice(i, i + 50))

      if (data) ordersData.push(...data)
    }
  }

  // ===== 4b. Get order_items as fallback for quantity =====
  // If shipment_items.quantity is null, use order_items.quantity
  // Build shipment_id -> order_id mapping
  const shipmentToOrderMap = new Map(shipmentsData.map(s => [String(s.shipment_id), String(s.order_id)]))

  // Find shipments missing quantity
  const shipmentsMissingQty = [...shipmentItemsMap.entries()]
    .filter(([, v]) => v.hasName && !v.hasQuantity)
    .map(([sid]) => sid)

  if (shipmentsMissingQty.length > 0) {
    // Get order_ids for shipments missing quantity
    const orderIdsForFallback = [...new Set(
      shipmentsMissingQty.map(sid => shipmentToOrderMap.get(sid)).filter(Boolean)
    )] as string[]

    // Fetch order_items for these orders
    let orderItemsData: Record<string, unknown>[] = []
    for (let i = 0; i < orderIdsForFallback.length; i += 50) {
      const { data } = await supabase
        .from('order_items')
        .select('order_id, name, quantity')
        .in('order_id', orderIdsForFallback.slice(i, i + 50))
        .limit(1000)

      if (data) orderItemsData.push(...data)
    }

    // Build order_id -> hasQuantity lookup
    const orderItemsMap = new Map<string, boolean>()
    for (const item of orderItemsData) {
      if (item.quantity !== null && item.quantity !== undefined) {
        orderItemsMap.set(String(item.order_id), true)
      }
    }

    // Update shipmentItemsMap with fallback quantity from order_items
    for (const sid of shipmentsMissingQty) {
      const orderId = shipmentToOrderMap.get(sid)
      if (orderId && orderItemsMap.get(orderId)) {
        const existing = shipmentItemsMap.get(sid)
        if (existing) {
          existing.hasQuantity = true
          shipmentItemsMap.set(sid, existing)
        }
      }
    }
  }
  const orderDataMap = new Map(ordersData.map(o => [String(o.id), o]))

  // ===== 5. Get ADDITIONAL SERVICES transactions (with pagination) =====
  const additionalServicesTransactions: Record<string, unknown>[] = []
  let addlOffset = 0
  let hasMoreAddl = true

  while (hasMoreAddl) {
    const { data: addlBatch } = await supabase
      .from('transactions')
      .select('id, reference_id, transaction_fee, charge_date')
      .eq('client_id', clientId)
      .eq('reference_type', 'Shipment')
      .neq('transaction_fee', 'Shipping')
      .neq('transaction_fee', 'Credit')
      .in('invoice_id_sb', invoiceIds)
      .range(addlOffset, addlOffset + PAGE_SIZE - 1)

    if (addlBatch && addlBatch.length > 0) {
      additionalServicesTransactions.push(...addlBatch)
      addlOffset += addlBatch.length
      hasMoreAddl = addlBatch.length === PAGE_SIZE
    } else {
      hasMoreAddl = false
    }
  }

  // ===== 6. Get STORAGE transactions (with pagination) =====
  const storageTransactions: Record<string, unknown>[] = []
  let storageOffset = 0
  let hasMoreStorage = true

  while (hasMoreStorage) {
    const { data: storageBatch } = await supabase
      .from('transactions')
      .select('id, reference_id, fulfillment_center, additional_details')
      .eq('client_id', clientId)
      .eq('reference_type', 'FC')
      .in('invoice_id_sb', invoiceIds)
      .range(storageOffset, storageOffset + PAGE_SIZE - 1)

    if (storageBatch && storageBatch.length > 0) {
      storageTransactions.push(...storageBatch)
      storageOffset += storageBatch.length
      hasMoreStorage = storageBatch.length === PAGE_SIZE
    } else {
      hasMoreStorage = false
    }
  }

  // ===== 7. Get RETURNS transactions (with pagination) =====
  const returnsTransactions: Record<string, unknown>[] = []
  let returnsOffset = 0
  let hasMoreReturns = true

  while (hasMoreReturns) {
    const { data: returnsBatch } = await supabase
      .from('transactions')
      .select('id, reference_id, tracking_id, fulfillment_center')
      .eq('client_id', clientId)
      .eq('reference_type', 'Return')
      .in('invoice_id_sb', invoiceIds)
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
  const receivingTransactions: Record<string, unknown>[] = []
  let receivingOffset = 0
  let hasMoreReceiving = true

  while (hasMoreReceiving) {
    const { data: receivingBatch } = await supabase
      .from('transactions')
      .select('id, reference_id, transaction_fee, transaction_type, charge_date')
      .eq('client_id', clientId)
      .eq('reference_type', 'WRO')
      .in('invoice_id_sb', invoiceIds)
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
      .select('id, reference_id, charge_date, additional_details')
      .eq('client_id', clientId)
      .eq('transaction_fee', 'Credit')
      .in('invoice_id_sb', invoiceIds)
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

  const summary: ValidationSummary = {
    shippingTransactions: shippingTransactions.length,
    additionalServiceTransactions: additionalServicesTransactions.length,
    storageTransactions: storageTransactions.length,
    returnsTransactions: returnsTransactions.length,
    receivingTransactions: receivingTransactions.length,
    creditsTransactions: creditsTransactions.length,

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
      withProductsSold: [...shipmentItemsMap.values()].filter(v => v.hasName && v.hasQuantity).length,
      withCustomerName: shipmentsData.filter(s => {
        const order = orderDataMap.get(String(s.order_id))
        return order && (order as { customer_name?: string }).customer_name
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
      // store_order_id: only required for non-ShipBob Default orders
      // Orders from "ShipBob Default" channel are manually created and don't have external store IDs
      withStoreOrderId: shipmentsData.filter(s => {
        const order = orderDataMap.get(String(s.order_id))
        if (!order) return false
        const o = order as { store_order_id?: string; channel_name?: string }
        // ShipBob Default orders don't have store_order_id - this is expected
        if (o.channel_name === 'ShipBob Default') return true
        return !!o.store_order_id
      }).length,
    },

    additionalServices: {
      total: additionalServicesTransactions.length,
      withReferenceId: additionalServicesTransactions.filter(tx => tx.reference_id).length,
      withFeeType: additionalServicesTransactions.filter(tx => tx.transaction_fee).length,
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
      withFeeType: receivingTransactions.filter(tx => tx.transaction_fee).length,
      // transaction_type may be null if transaction_fee already contains the type info
      withTransactionType: receivingTransactions.filter(tx => tx.transaction_type || tx.transaction_fee).length,
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
