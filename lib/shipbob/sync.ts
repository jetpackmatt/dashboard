/**
 * ShipBob Data Sync Service - Complete Sync
 *
 * Mirrors the logic from scripts/sync-orders-fast.js for production use.
 * Syncs: orders, shipments, order_items, shipment_items, shipment_cartons, transactions
 *
 * Timeline events (event_created, event_intransit, event_delivered, etc.) are
 * automatically fetched from the Timeline API after shipment upsert.
 *
 * Uses the 2025-07 ShipBob API.
 */

import { createAdminClient } from '@/lib/supabase/admin'
import { ShipBobClient, ShipBobProduct } from './client'
import { ensureFCsExist } from '@/lib/fulfillment-centers'

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'
const BATCH_SIZE = 500
const TIMELINE_DELAY_MS = 500 // Delay between timeline API calls (500ms = max 120/min, leaves room for other crons)

// Map ShipBob timeline log_type_id to database column names
const TIMELINE_EVENT_MAP: Record<number, string> = {
  601: 'event_created',
  602: 'event_picked',
  603: 'event_packed',
  604: 'event_labeled',
  605: 'event_labelvalidated',
  607: 'event_intransit',
  608: 'event_outfordelivery',
  609: 'event_delivered',
  611: 'event_deliveryattemptfailed',
}

export interface SyncResult {
  success: boolean
  clientId: string
  clientName: string
  ordersFound: number
  ordersUpserted: number
  shipmentsUpserted: number
  timelinesUpdated: number    // Shipments with timeline events updated
  orderItemsUpserted: number
  shipmentItemsInserted: number
  cartonsInserted: number
  transactionsUpserted: number
  ordersDeleted: number       // Soft-deleted orders (no longer in ShipBob)
  shipmentsDeleted: number    // Soft-deleted shipments
  ordersRestored: number      // Previously deleted orders that reappeared
  shipmentsRestored: number   // Previously deleted shipments that reappeared
  errors: string[]
  duration: number
}

export interface FullSyncResult {
  success: boolean
  clients: SyncResult[]
  totalOrders: number
  totalShipments: number
  duration: number
  errors: string[]
}

// DIM weight divisors by route
function getDimDivisor(originCountry: string, destCountry: string, actualWeightOz: number): number | null {
  if (originCountry === 'AU' || destCountry === 'AU') return 110
  if (originCountry === 'US' && destCountry === 'US') {
    return actualWeightOz >= 16 ? 166 : null
  }
  return 139
}

// Batch upsert helper
async function batchUpsert(
  supabase: ReturnType<typeof createAdminClient>,
  table: string,
  records: Record<string, unknown>[],
  onConflict: string
): Promise<{ success: number; errors: string[] }> {
  if (records.length === 0) return { success: 0, errors: [] }

  let successCount = 0
  const errors: string[] = []

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)

    const { error } = await supabase
      .from(table)
      .upsert(batch, { onConflict, ignoreDuplicates: false })

    if (error) {
      errors.push(`${table} batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`)
    } else {
      successCount += batch.length
    }
  }

  return { success: successCount, errors }
}

// Batch insert helper
async function batchInsert(
  supabase: ReturnType<typeof createAdminClient>,
  table: string,
  records: Record<string, unknown>[]
): Promise<{ success: number; errors: string[] }> {
  if (records.length === 0) return { success: 0, errors: [] }

  let successCount = 0
  const errors: string[] = []

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)

    const { error } = await supabase.from(table).insert(batch)

    if (error) {
      errors.push(`${table} batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`)
    } else {
      successCount += batch.length
    }
  }

  return { success: successCount, errors }
}

// Batch delete helper
async function batchDelete(
  supabase: ReturnType<typeof createAdminClient>,
  table: string,
  column: string,
  values: string[]
): Promise<void> {
  for (let i = 0; i < values.length; i += BATCH_SIZE) {
    const batch = values.slice(i, i + BATCH_SIZE)
    await supabase.from(table).delete().in(column, batch)
  }
}

// Timeline event type from ShipBob API
interface TimelineEvent {
  log_type_id: number
  timestamp: string
  description?: string
}

// Timeline fetch result with both event columns and full logs
interface TimelineResult {
  eventColumns: Record<string, string>
  eventLogs: TimelineEvent[]
}

/**
 * Fetch timeline events for a shipment from ShipBob API
 * Returns null on error, empty result on 404/empty, or timeline data with full logs
 */
async function fetchShipmentTimeline(
  shipmentId: string,
  token: string
): Promise<TimelineResult | null> {
  try {
    const res = await fetch(`${SHIPBOB_API_BASE}/shipment/${shipmentId}/timeline`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (res.status === 429) {
      // Rate limited - return null to skip this one
      console.log(`[Timeline] Rate limited on shipment ${shipmentId}`)
      return null
    }

    if (res.status === 404) {
      // Shipment not found in API (Processing/Exception status) - return empty
      return { eventColumns: {}, eventLogs: [] }
    }

    if (!res.ok) {
      return null
    }

    const timeline: TimelineEvent[] = await res.json()
    if (!timeline || timeline.length === 0) {
      return { eventColumns: {}, eventLogs: [] }
    }

    // Map timeline events to database columns
    const eventColumns: Record<string, string> = {}
    for (const event of timeline) {
      const col = TIMELINE_EVENT_MAP[event.log_type_id]
      if (col && event.timestamp) {
        eventColumns[col] = event.timestamp
      }
    }

    return { eventColumns, eventLogs: timeline }
  } catch (e) {
    console.error(`[Timeline] Error fetching shipment ${shipmentId}:`, e)
    return null
  }
}

/**
 * Fetch and update timeline events for recently synced shipments
 * Fetches for shipments that haven't been delivered yet (event_delivered is null)
 * This ensures we capture all in-progress events: picked, packed, labeled, intransit, etc.
 * Also stores the full event_logs JSONB for complete timeline history.
 */
async function syncShipmentTimelines(
  supabase: ReturnType<typeof createAdminClient>,
  shipmentIds: string[],
  token: string
): Promise<{ updated: number; skipped: number; errors: number }> {
  const result = { updated: 0, skipped: 0, errors: 0 }

  if (shipmentIds.length === 0) return result

  // Get shipments that need timeline updates:
  // 1. Not yet delivered (in-progress tracking)
  // 2. OR have partial timeline data (event_labeled exists but event_created is null)
  // This ensures we catch any shipments that had incomplete timeline fetches
  // Process in batches of 100 to avoid query size limits
  const needsTimeline: Array<{ id: string; shipment_id: string }> = []

  for (let i = 0; i < shipmentIds.length; i += 100) {
    const batch = shipmentIds.slice(i, i + 100)

    // First: get shipments not yet delivered
    const { data: undelivered } = await supabase
      .from('shipments')
      .select('id, shipment_id')
      .in('shipment_id', batch)
      .is('event_delivered', null)

    if (undelivered) {
      needsTimeline.push(...undelivered)
    }

    // Second: get shipments with partial timeline (event_labeled but no event_created)
    // These were previously missed and need backfill
    const undeliveredIds = new Set((undelivered || []).map((s: { id: string; shipment_id: string }) => s.shipment_id))
    const { data: partial } = await supabase
      .from('shipments')
      .select('id, shipment_id')
      .in('shipment_id', batch)
      .not('event_labeled', 'is', null)
      .is('event_created', null)

    if (partial) {
      // Only add if not already in undelivered list
      for (const ship of partial) {
        if (!undeliveredIds.has(ship.shipment_id)) {
          needsTimeline.push(ship)
        }
      }
    }
  }

  if (needsTimeline.length === 0) {
    result.skipped = shipmentIds.length
    return result
  }

  console.log(`[Timeline] Fetching timeline for ${needsTimeline.length} shipments...`)

  // Fetch timeline for each shipment with rate limiting
  for (const ship of needsTimeline) {
    const timelineResult = await fetchShipmentTimeline(ship.shipment_id, token)

    if (timelineResult === null) {
      result.errors++
    } else if (Object.keys(timelineResult.eventColumns).length > 0 || timelineResult.eventLogs.length > 0) {
      // Build update object with event columns and full event_logs JSONB
      const updateData: Record<string, unknown> = {
        ...timelineResult.eventColumns,
      }

      // Store full timeline as event_logs JSONB
      if (timelineResult.eventLogs.length > 0) {
        updateData.event_logs = timelineResult.eventLogs
      }

      // Calculate transit_time_days when we have both intransit and delivered timestamps
      const intransitDate = timelineResult.eventColumns.event_intransit as string | undefined
      const deliveredDate = timelineResult.eventColumns.event_delivered as string | undefined
      if (intransitDate && deliveredDate) {
        const intransit = new Date(intransitDate).getTime()
        const delivered = new Date(deliveredDate).getTime()
        const transitMs = delivered - intransit
        const transitDays = Math.round((transitMs / (1000 * 60 * 60 * 24)) * 10) / 10 // Round to 1 decimal
        if (transitDays >= 0) {
          updateData.transit_time_days = transitDays
        }
      }

      // Update the shipment with timeline data
      const { error } = await supabase
        .from('shipments')
        .update(updateData)
        .eq('id', ship.id)

      if (error) {
        result.errors++
      } else {
        result.updated++
      }
    } else {
      // Empty timeline (404 or no events yet) - skip for now, will retry until delivered
      result.skipped++
    }

    // Delay between API calls to avoid rate limits
    await new Promise((r) => setTimeout(r, TIMELINE_DELAY_MS))
  }

  console.log(`[Timeline] Complete: ${result.updated} updated, ${result.skipped} skipped, ${result.errors} errors`)
  return result
}

export interface SyncOptions {
  daysBack?: number
  minutesBack?: number
  skipReconciliation?: boolean // Skip soft-delete reconciliation for quick syncs
}

/**
 * Sync a single client's data
 */
export async function syncClient(
  clientId: string,
  clientName: string,
  token: string,
  merchantId: string,
  options: SyncOptions | number = 7 // number for backward compat (daysBack)
): Promise<SyncResult> {
  const startTime = Date.now()
  const result: SyncResult = {
    success: false,
    clientId,
    clientName,
    ordersFound: 0,
    ordersUpserted: 0,
    shipmentsUpserted: 0,
    timelinesUpdated: 0,
    orderItemsUpserted: 0,
    shipmentItemsInserted: 0,
    cartonsInserted: 0,
    transactionsUpserted: 0,
    ordersDeleted: 0,
    shipmentsDeleted: 0,
    ordersRestored: 0,
    shipmentsRestored: 0,
    errors: [],
    duration: 0,
  }

  // Handle backward compat: number = daysBack
  const opts: SyncOptions = typeof options === 'number'
    ? { daysBack: options }
    : options

  const supabase = createAdminClient()
  const parentToken = process.env.SHIPBOB_API_TOKEN

  try {
    // Calculate date range
    const endDate = new Date()
    const startDate = new Date()

    if (opts.minutesBack) {
      startDate.setMinutes(startDate.getMinutes() - opts.minutesBack)
      console.log(`[Sync] Using LastUpdateStartDate filter (catches modified orders since ${startDate.toISOString()})`)
    } else {
      startDate.setDate(startDate.getDate() - (opts.daysBack || 7))
      console.log(`[Sync] Using StartDate filter (catches orders created since ${startDate.toISOString()})`)
    }

    // Helper to extract origin country from FC name
    // FC names like "Twin Lakes (WI)", "Ontario 6 (CA)", "Feltham (UK)"
    const getOriginCountry = (fcName: string | null): string => {
      if (!fcName) return 'US'
      const match = fcName.match(/\(([A-Z]{2})\)$/)
      if (!match) return 'US'
      const code = match[1]
      // Canadian provinces
      if (['ON', 'BC', 'AB', 'QC', 'MB', 'SK', 'NS', 'NB', 'PE', 'NL', 'YT', 'NT', 'NU'].includes(code)) return 'CA'
      // UK
      if (code === 'UK') return 'GB'
      // Australian states
      if (['NSW', 'VIC', 'QLD', 'WA', 'SA', 'TAS', 'ACT', 'NT'].includes(code)) return 'AU'
      // Default to US (most state codes like WI, PA, CA, TX are US)
      return 'US'
    }

    // Build ship_option_id lookup
    const methodsRes = await fetch(`${SHIPBOB_API_BASE}/shipping-method`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    const methods = await methodsRes.json()
    const shipOptionLookup: Record<string, number> = {}
    for (const method of methods) {
      const name = method.service_level?.name?.trim()
      const id = method.service_level?.id
      if (name && id) {
        shipOptionLookup[name] = id
        shipOptionLookup[name.toLowerCase().replace(/\s+/g, '')] = id
      }
    }
    const manualMappings: Record<string, number> = { Ground: 3, '1 Day': 8, '2 Day': 9 }
    const getShipOptionId = (shipOption: string | null): number | null => {
      if (!shipOption) return null
      if (shipOptionLookup[shipOption]) return shipOptionLookup[shipOption]
      const normalized = shipOption.toLowerCase().replace(/\s+/g, '')
      if (shipOptionLookup[normalized]) return shipOptionLookup[normalized]
      return manualMappings[shipOption] || null
    }

    // Build channel_id -> application_name lookup from Channels API
    const channelLookup: Record<number, string> = {}
    try {
      const channelsRes = await fetch(`${SHIPBOB_API_BASE}/channel`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (channelsRes.ok) {
        const channelsData = await channelsRes.json()
        // 2025-07 API returns { items: [...] }, extract the array
        const channels = Array.isArray(channelsData) ? channelsData : (channelsData.items || [])
        for (const ch of channels) {
          if (ch.id && ch.application_name) {
            channelLookup[ch.id] = ch.application_name
          }
        }
        console.log(`[Sync] Built channel lookup with ${Object.keys(channelLookup).length} channels`)
      } else {
        console.warn(`[Sync] Channels API returned ${channelsRes.status}: ${channelsRes.statusText}`)
      }
    } catch (e) {
      console.warn('[Sync] Could not fetch channels for application_name lookup:', e)
    }

    // STEP 1: Fetch all orders from API
    interface ShipBobOrder {
      id: number
      order_number?: string
      status?: string
      created_date?: string
      purchase_date?: string
      reference_id?: string
      shipping_method?: string
      type?: string
      gift_message?: string
      tags?: string[]
      channel?: { id?: number; name?: string }
      carrier?: { type?: string; payment_term?: string }
      financials?: { total_price?: number }
      recipient?: {
        name?: string
        email?: string
        phone_number?: string
        address?: {
          address1?: string
          address2?: string
          company_name?: string
          city?: string
          state?: string
          zip_code?: string
          country?: string
        }
      }
      products?: Array<{
        id?: number
        sku?: string
        reference_id?: string
        name?: string
        quantity?: number
        unit_price?: number
        gtin?: string
        upc?: string
        external_line_id?: string
        quantity_unit_of_measure_code?: string
      }>
      shipments?: Array<{
        id: number
        status?: string
        status_details?: string[]
        created_date?: string
        actual_fulfillment_date?: string
        delivery_date?: string
        estimated_fulfillment_date?: string
        estimated_fulfillment_date_status?: string
        last_update_at?: string
        ship_option?: string
        insurance_value?: number
        package_material_type?: string
        require_signature?: boolean
        gift_message?: string
        location?: { name?: string }
        zone?: { id?: number }
        measurements?: {
          length_in?: number
          width_in?: number
          depth_in?: number
          total_weight_oz?: number
        }
        tracking?: {
          tracking_number?: string
          tracking_url?: string
          carrier?: string
          last_update_at?: string
          bol?: string
          pro_number?: string
          scac?: string
        }
        recipient?: {
          name?: string
          full_name?: string
          email?: string
          phone_number?: string
        }
        invoice?: {
          amount?: number
          currency_code?: string
        }
        products?: Array<{
          id?: number
          sku?: string
          reference_id?: string
          name?: string
          quantity?: number
          is_dangerous_goods?: boolean
          inventory?: Array<{
            id?: number
            lot?: string
            expiration_date?: string
            quantity?: number
            quantity_committed?: number
            serial_numbers?: string[]
          }>
        }>
        parent_cartons?: Array<{
          id?: number
          barcode?: string
          type?: string
          parent_carton_barcode?: string
          measurements?: {
            length_in?: number
            width_in?: number
            depth_in?: number
            weight_oz?: number
          }
          products?: unknown[]
        }>
      }>
    }

    const apiOrders: ShipBobOrder[] = []
    let page = 1
    let totalPages: number | null = null

    while (true) {
      // For per-minute syncs (minutesBack), use LastUpdateStartDate to catch MODIFIED orders
      // For daily/weekly syncs (daysBack), use StartDate to catch NEW orders for reconciliation
      const params = new URLSearchParams({
        Limit: '250',
        Page: page.toString(),
      })

      if (opts.minutesBack) {
        // LastUpdateStartDate catches orders modified since the given time
        // This includes new orders (created = modified) AND updates to existing orders
        params.set('LastUpdateStartDate', startDate.toISOString())
        params.set('LastUpdateEndDate', endDate.toISOString())
      } else {
        // StartDate filters by creation date - used for full syncs and reconciliation
        params.set('StartDate', startDate.toISOString())
        params.set('EndDate', endDate.toISOString())
      }

      const response = await fetch(`${SHIPBOB_API_BASE}/order?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      })

      if (totalPages === null) {
        totalPages = parseInt(response.headers.get('total-pages') || '0') || null
      }

      const orders = await response.json()

      if (!Array.isArray(orders) || orders.length === 0) break
      apiOrders.push(...orders)

      if (totalPages && page >= totalPages) break
      if (!totalPages && orders.length < 250) break
      page++
    }

    result.ordersFound = apiOrders.length

    if (apiOrders.length === 0) {
      result.success = true
      result.duration = Date.now() - startTime
      return result
    }

    // STEP 2: Upsert Orders
    const now = new Date().toISOString()
    const orderRecords = apiOrders.map((order) => ({
      client_id: clientId,
      merchant_id: merchantId,
      shipbob_order_id: order.id.toString(),
      store_order_id: order.order_number || null,
      customer_name: order.recipient?.name || null,
      order_import_date: order.created_date || null,
      status: order.status || null,
      address1: order.recipient?.address?.address1 || null,
      address2: order.recipient?.address?.address2 || null,
      company_name: order.recipient?.address?.company_name || null,
      customer_email: order.recipient?.email || null,
      customer_phone: order.recipient?.phone_number || null,
      zip_code: order.recipient?.address?.zip_code || null,
      city: order.recipient?.address?.city || null,
      state: order.recipient?.address?.state || null,
      country: order.recipient?.address?.country || null,
      total_shipments: order.shipments?.length || 0,
      order_type: order.type || null,
      channel_id: order.channel?.id || null,
      channel_name: order.channel?.name || null,
      application_name: order.channel?.id ? channelLookup[order.channel.id] || null : null,
      reference_id: order.reference_id || null,
      shipping_method: order.shipping_method || null,
      purchase_date: order.purchase_date || null,
      total_price: order.financials?.total_price || null,
      gift_message: order.gift_message || null,
      tags: order.tags || null,
      updated_at: now,
      // Soft delete support: mark as verified and restore if previously deleted
      last_verified_at: now,
      deleted_at: null,
    }))

    const orderResult = await batchUpsert(supabase, 'orders', orderRecords, 'client_id,shipbob_order_id')
    result.ordersUpserted = orderResult.success
    result.errors.push(...orderResult.errors)

    // Build order ID map
    const shipbobOrderIds = apiOrders.map((o) => o.id.toString())
    const orderIdMap: Record<string, string> = {}

    for (let i = 0; i < shipbobOrderIds.length; i += 1000) {
      const batch = shipbobOrderIds.slice(i, i + 1000)
      const { data: orderRows } = await supabase
        .from('orders')
        .select('id, shipbob_order_id')
        .eq('client_id', clientId)
        .in('shipbob_order_id', batch)

      for (const row of orderRows || []) {
        orderIdMap[row.shipbob_order_id] = row.id
      }
    }

    // STEP 3: Upsert Shipments
    const shipmentRecords: Record<string, unknown>[] = []
    const shipmentIds: string[] = []

    for (const order of apiOrders) {
      if (!order.shipments || order.shipments.length === 0) continue

      const orderId = orderIdMap[order.id.toString()]
      if (!orderId) continue

      for (const shipment of order.shipments) {
        const length = shipment.measurements?.length_in || 0
        const width = shipment.measurements?.width_in || 0
        const height = shipment.measurements?.depth_in || 0
        const actualWeight = shipment.measurements?.total_weight_oz || 0

        const fcName = shipment.location?.name || null
        const originCountry = getOriginCountry(fcName)
        const destCountry = order.recipient?.address?.country || 'US'

        let dimWeight: number | null = null
        let billableWeight = actualWeight
        const dimDivisor = getDimDivisor(originCountry, destCountry, actualWeight)
        if (dimDivisor && length > 0 && width > 0 && height > 0) {
          dimWeight = Math.round(((length * width * height) / dimDivisor) * 16)
          billableWeight = Math.max(actualWeight, dimWeight)
        }

        // Timeline event columns (event_created, event_intransit, event_delivered, etc.)
        // are populated after shipment upsert via the Timeline API (STEP 3b)
        shipmentRecords.push({
          client_id: clientId,
          merchant_id: merchantId,
          order_id: orderId,
          shipment_id: shipment.id.toString(),
          shipbob_order_id: order.id.toString(),
          tracking_id: shipment.tracking?.tracking_number || null,
          tracking_url: shipment.tracking?.tracking_url || null,
          status: shipment.status || null,
          recipient_name: shipment.recipient?.name || shipment.recipient?.full_name || null,
          recipient_email: shipment.recipient?.email || null,
          recipient_phone: shipment.recipient?.phone_number || null,
          created_at: shipment.created_date || null,
          // Timeline event columns (event_created, event_intransit, event_delivered, etc.) populated in STEP 3b
          carrier: shipment.tracking?.carrier || null,
          carrier_service: shipment.ship_option || null,
          ship_option_id: getShipOptionId(shipment.ship_option || null),
          zone_used: shipment.zone?.id || null,
          fc_name: fcName,
          actual_weight_oz: actualWeight || null,
          dim_weight_oz: dimWeight,
          billable_weight_oz: billableWeight || null,
          length: length || null,
          width: width || null,
          height: height || null,
          insurance_value: shipment.insurance_value || null,
          estimated_fulfillment_date: shipment.estimated_fulfillment_date || null,
          estimated_fulfillment_date_status: shipment.estimated_fulfillment_date_status || null,
          last_update_at: shipment.last_update_at || null,
          package_material_type: shipment.package_material_type || null,
          require_signature: shipment.require_signature || false,
          gift_message: shipment.gift_message || null,
          // Removed: invoice_amount, invoice_currency_code - API returns undefined, billing comes from transactions table
          tracking_bol: shipment.tracking?.bol || null,
          tracking_pro_number: shipment.tracking?.pro_number || null,
          tracking_scac: shipment.tracking?.scac || null,
          origin_country: originCountry,
          destination_country: destCountry,
          status_details: shipment.status_details || null,
          order_type: order.type || null,
          application_name: order.channel?.id ? channelLookup[order.channel.id] || null : null,
          updated_at: now,
          // Soft delete support: mark as verified and restore if previously deleted
          last_verified_at: now,
          deleted_at: null,
        })

        shipmentIds.push(shipment.id.toString())
      }
    }

    const shipmentResult = await batchUpsert(supabase, 'shipments', shipmentRecords, 'shipment_id')
    result.shipmentsUpserted = shipmentResult.success
    result.errors.push(...shipmentResult.errors)

    // STEP 3b: Fetch and update timeline events for newly synced shipments
    // This populates event_created, event_intransit, event_delivered, etc.
    if (shipmentIds.length > 0) {
      const timelineResult = await syncShipmentTimelines(supabase, shipmentIds, token)
      result.timelinesUpdated = timelineResult.updated
      if (timelineResult.errors > 0) {
        result.errors.push(`Timeline: ${timelineResult.errors} errors`)
      }
    }

    // STEP 4: Upsert Order Items
    const orderItemRecords: Record<string, unknown>[] = []
    for (const order of apiOrders) {
      if (!order.products || order.products.length === 0) continue
      const orderId = orderIdMap[order.id.toString()]
      if (!orderId) continue

      for (const product of order.products) {
        orderItemRecords.push({
          client_id: clientId,
          merchant_id: merchantId,
          order_id: orderId,
          shipbob_product_id: product.id || null,
          sku: product.sku || null,
          reference_id: product.reference_id || null,
          quantity: product.quantity || null,
          unit_price: product.unit_price || null,
          upc: product.upc || null,
          external_line_id: product.external_line_id || null,
        })
      }
    }

    const orderItemResult = await batchUpsert(supabase, 'order_items', orderItemRecords, 'order_id,shipbob_product_id')
    result.orderItemsUpserted = orderItemResult.success
    result.errors.push(...orderItemResult.errors)

    // STEP 5: Delete + Insert Shipment Items
    // NOTE: ShipBob API quirk - order.products has quantity but no name,
    // shipment.products has name but no quantity. We merge both sources.
    await batchDelete(supabase, 'shipment_items', 'shipment_id', shipmentIds)

    const shipmentItemRecords: Record<string, unknown>[] = []
    for (const order of apiOrders) {
      if (!order.shipments) continue

      // Build lookups of order.products by product ID and SKU to get quantity
      // (shipment.products doesn't include quantity in the API response)
      const orderProductQuantitiesById: Record<number, number> = {}
      const orderProductQuantitiesBySku: Record<string, number> = {}
      for (const p of order.products || []) {
        if (p.quantity) {
          if (p.id) orderProductQuantitiesById[p.id] = p.quantity
          if (p.sku) orderProductQuantitiesBySku[p.sku] = p.quantity
        }
      }

      for (const shipment of order.shipments) {
        if (!shipment.products || shipment.products.length === 0) continue

        for (const product of shipment.products) {
          const inventories = product.inventory || [{}]
          // Get quantity from order.products lookup (since shipment.products doesn't have it)
          // Priority: product ID match > SKU match
          const orderQuantityById = product.id ? orderProductQuantitiesById[product.id] : null
          const orderQuantityBySku = product.sku ? orderProductQuantitiesBySku[product.sku] : null
          const orderQuantity = orderQuantityById ?? orderQuantityBySku

          for (const inv of inventories) {
            shipmentItemRecords.push({
              client_id: clientId,
              merchant_id: merchantId,
              shipment_id: shipment.id.toString(),
              shipbob_product_id: product.id || null,
              sku: product.sku || null,
              reference_id: product.reference_id || null,
              name: product.name || null,
              lot: inv.lot || null,
              expiration_date: inv.expiration_date || null,
              // Priority: inventory quantity > order product quantity > shipment product quantity
              quantity: inv.quantity || orderQuantity || product.quantity || null,
              is_dangerous_goods: product.is_dangerous_goods || false,
              serial_numbers: inv.serial_numbers ? JSON.stringify(inv.serial_numbers) : null,
            })
          }
        }
      }
    }

    const shipmentItemResult = await batchInsert(supabase, 'shipment_items', shipmentItemRecords)
    result.shipmentItemsInserted = shipmentItemResult.success
    result.errors.push(...shipmentItemResult.errors)

    // STEP 5b: Backfill missing quantities from order_items (database fallback)
    // This handles cases where API didn't provide quantity but order_items has it
    if (shipmentIds.length > 0) {
      // Find shipment_items with NULL quantity for these shipments
      const { data: missingQtyItems } = await supabase
        .from('shipment_items')
        .select('id, shipment_id, shipbob_product_id')
        .in('shipment_id', shipmentIds)
        .is('quantity', null)
        .not('shipbob_product_id', 'is', null)

      if (missingQtyItems && missingQtyItems.length > 0) {
        // Get order_ids for these shipments
        const { data: shipmentOrders } = await supabase
          .from('shipments')
          .select('shipment_id, order_id')
          .in('shipment_id', shipmentIds)

        const shipmentToOrderId: Record<string, string> = {}
        for (const s of shipmentOrders || []) {
          shipmentToOrderId[s.shipment_id] = s.order_id
        }

        // Get order_items quantities for matching product IDs
        const orderIds = [...new Set(Object.values(shipmentToOrderId))]
        const productIds = [...new Set(missingQtyItems.map((i: { id: string; shipment_id: string; shipbob_product_id: number }) => i.shipbob_product_id))]

        const { data: orderItemsQty } = await supabase
          .from('order_items')
          .select('order_id, shipbob_product_id, quantity')
          .in('order_id', orderIds)
          .in('shipbob_product_id', productIds)
          .not('quantity', 'is', null)

        // Build lookup: order_id + product_id -> quantity
        const qtyLookup: Record<string, number> = {}
        for (const oi of orderItemsQty || []) {
          qtyLookup[`${oi.order_id}:${oi.shipbob_product_id}`] = oi.quantity
        }

        // Update items that have a matching quantity
        type MissingQtyItem = { id: string; shipment_id: string; shipbob_product_id: number }
        const updates = missingQtyItems
          .map((item: MissingQtyItem) => {
            const orderId = shipmentToOrderId[item.shipment_id]
            const qty = qtyLookup[`${orderId}:${item.shipbob_product_id}`]
            return qty !== undefined ? { id: item.id, quantity: qty } : null
          })
          .filter((u: { id: string; quantity: number } | null): u is { id: string; quantity: number } => u !== null)

        if (updates.length > 0) {
          // Batch update in chunks
          for (let i = 0; i < updates.length; i += 50) {
            const chunk = updates.slice(i, i + 50)
            for (const upd of chunk) {
              await supabase
                .from('shipment_items')
                .update({ quantity: upd.quantity })
                .eq('id', upd.id)
            }
          }
        }
      }
    }

    // STEP 5c: Create shipment_items from order_items for shipments with NO items
    // This handles archived shipments where ShipBob API returns no products data
    if (shipmentIds.length > 0) {
      // Find shipments that have zero items
      const { data: itemCounts } = await supabase
        .from('shipment_items')
        .select('shipment_id')
        .in('shipment_id', shipmentIds)

      const shipmentsWithItems = new Set((itemCounts || []).map((i: { shipment_id: string }) => i.shipment_id))
      const shipmentsWithoutItems = shipmentIds.filter(id => !shipmentsWithItems.has(id))

      if (shipmentsWithoutItems.length > 0) {
        // Get order_ids for shipments without items
        const { data: shipmentOrders } = await supabase
          .from('shipments')
          .select('shipment_id, order_id')
          .in('shipment_id', shipmentsWithoutItems)

        const shipmentToOrderId: Record<string, string> = {}
        for (const s of shipmentOrders || []) {
          if (s.order_id) shipmentToOrderId[s.shipment_id] = s.order_id
        }

        const orderIds = [...new Set(Object.values(shipmentToOrderId))]
        if (orderIds.length > 0) {
          // Get order_items for these orders
          const { data: orderItems } = await supabase
            .from('order_items')
            .select('order_id, sku, quantity, shipbob_product_id, name')
            .in('order_id', orderIds)

          // Build order_id -> items lookup
          const orderItemsLookup: Record<string, Array<{sku: string | null, quantity: number | null, shipbob_product_id: number | null, name: string | null}>> = {}
          for (const oi of orderItems || []) {
            if (!orderItemsLookup[oi.order_id]) orderItemsLookup[oi.order_id] = []
            orderItemsLookup[oi.order_id].push({
              sku: oi.sku,
              quantity: oi.quantity,
              shipbob_product_id: oi.shipbob_product_id,
              name: oi.name
            })
          }

          // Create shipment_items from order_items
          const newItemRecords: Record<string, unknown>[] = []
          for (const shipmentId of shipmentsWithoutItems) {
            const orderId = shipmentToOrderId[shipmentId]
            const items = orderId ? orderItemsLookup[orderId] : null
            if (!items || items.length === 0) continue

            for (const item of items) {
              // Use SKU as name if name is missing
              const itemName = item.name || item.sku || 'Unknown Product'
              newItemRecords.push({
                client_id: clientId,
                merchant_id: merchantId,
                shipment_id: shipmentId,
                shipbob_product_id: item.shipbob_product_id,
                sku: item.sku,
                name: itemName,
                quantity: item.quantity,
              })
            }
          }

          if (newItemRecords.length > 0) {
            const fallbackResult = await batchInsert(supabase, 'shipment_items', newItemRecords)
            result.errors.push(...fallbackResult.errors)
          }
        }
      }
    }

    // STEP 6: Delete + Insert Cartons
    await batchDelete(supabase, 'shipment_cartons', 'shipment_id', shipmentIds)

    const cartonRecords: Record<string, unknown>[] = []
    for (const order of apiOrders) {
      if (!order.shipments) continue

      for (const shipment of order.shipments) {
        if (!shipment.parent_cartons || shipment.parent_cartons.length === 0) continue

        for (const carton of shipment.parent_cartons) {
          cartonRecords.push({
            client_id: clientId,
            merchant_id: merchantId,
            shipment_id: shipment.id.toString(),
            carton_id: carton.id || null,
            barcode: carton.barcode || null,
            carton_type: carton.type || null,
            parent_barcode: carton.parent_carton_barcode || null,
            length_in: carton.measurements?.length_in || null,
            width_in: carton.measurements?.width_in || null,
            depth_in: carton.measurements?.depth_in || null,
            weight_oz: carton.measurements?.weight_oz || null,
            contents: carton.products ? JSON.stringify(carton.products) : null,
          })
        }
      }
    }

    const cartonResult = await batchInsert(supabase, 'shipment_cartons', cartonRecords)
    result.cartonsInserted = cartonResult.success
    result.errors.push(...cartonResult.errors)

    // STEP 7: Fetch and Upsert Transactions (for this client's shipments only)
    // NOTE: Full transaction sync (including storage, returns, etc.) is handled separately
    // by syncAllTransactions(). This section only syncs shipment-linked transactions.
    if (parentToken && shipmentIds.length > 0) {
      interface ShipBobTransaction {
        transaction_id: string
        reference_id: string
        reference_type: string
        transaction_type: string
        transaction_fee: string  // API returns transaction_fee, we map to fee_type
        amount: number
        charge_date: string
        invoice_date?: string
        invoiced_status: boolean
        invoice_id?: number
        fulfillment_center?: string
        additional_details?: Record<string, unknown>
        taxes?: Array<{ tax_type?: string; tax_rate?: number; tax_amount?: number }>
      }

      const apiTransactions: ShipBobTransaction[] = []
      for (let i = 0; i < shipmentIds.length; i += 100) {
        const batch = shipmentIds.slice(i, i + 100)
        try {
          const response = await fetch(`${SHIPBOB_API_BASE}/transactions:query`, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${parentToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ reference_ids: batch, page_size: 1000 }),
          })
          const data = await response.json()
          apiTransactions.push(...(data.items || []))
        } catch (e) {
          result.errors.push(`Transaction batch error: ${e instanceof Error ? e.message : 'Unknown'}`)
        }
      }

      const txRecords = apiTransactions.map((tx) => ({
        transaction_id: tx.transaction_id,
        client_id: clientId,
        merchant_id: merchantId,
        reference_id: tx.reference_id,
        reference_type: tx.reference_type,
        transaction_type: tx.transaction_type || null,
        fee_type: tx.transaction_fee,
        // For WRO Receiving Fee, API 'amount' includes taxes - subtract to get pre-tax cost
        // For other fee types (Shipping, Per Pick, Storage), API 'amount' is already pre-tax
        // Taxes are stored separately in the 'taxes' column for all transactions
        cost: (tx.reference_type === 'WRO' && tx.transaction_fee?.includes('Receiving'))
          ? tx.amount - (tx.taxes || []).reduce((sum, t) => sum + (t.tax_amount || 0), 0)
          : tx.amount,
        charge_date: tx.charge_date,
        invoice_date_sb: tx.invoice_date || null,
        invoiced_status_sb: tx.invoiced_status || false,
        invoice_id_sb: tx.invoice_id || null,
        fulfillment_center: tx.fulfillment_center || null,
        additional_details: tx.additional_details || null,
        // Extract tracking_id from additional_details.TrackingId
        tracking_id: (tx.additional_details as Record<string, unknown>)?.TrackingId as string || null,
        // Capture taxes (GST/HST for Canadian FCs)
        taxes: tx.taxes && tx.taxes.length > 0 ? tx.taxes : null,
        created_at: new Date().toISOString(),
      }))

      const txResult = await batchUpsert(supabase, 'transactions', txRecords, 'transaction_id')
      result.transactionsUpserted = txResult.success
      result.errors.push(...txResult.errors)
    }

    // STEP 8: Reconcile - Find and soft-delete orders/shipments that weren't in the API response
    // Skip for quick syncs (minutesBack) - run daily with full sync instead
    if (!opts.skipReconciliation && !opts.minutesBack) {
      // This handles the case where orders/shipments were deleted from ShipBob
      const apiOrderIdSet = new Set(apiOrders.map((o) => o.id.toString()))
      const apiShipmentIdSet = new Set(shipmentIds)

      // Find orders in our DB within the sync date range that weren't in the API response
      // These are candidates for soft-deletion
      const { data: staleOrders } = await supabase
        .from('orders')
        .select('id, shipbob_order_id')
        .eq('client_id', clientId)
        .is('deleted_at', null) // Only check active records
        .gte('order_import_date', startDate.toISOString())
        .lte('order_import_date', endDate.toISOString())

      // Find orders that weren't in the API response
      const potentiallyDeletedOrders = (staleOrders || []).filter(
        (order: { id: string; shipbob_order_id: string }) => !apiOrderIdSet.has(order.shipbob_order_id)
      )

      // Verify each potentially-deleted order by checking the API
      let ordersDeleted = 0
      for (const order of potentiallyDeletedOrders) {
        try {
          const checkRes = await fetch(`${SHIPBOB_API_BASE}/order/${order.shipbob_order_id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })

          if (checkRes.status === 404) {
            // Order is truly deleted from ShipBob - soft delete it
            await supabase
              .from('orders')
              .update({ deleted_at: now })
              .eq('id', order.id)

            // Also soft-delete all related shipments
            await supabase
              .from('shipments')
              .update({ deleted_at: now })
              .eq('order_id', order.id)
              .is('deleted_at', null)

            ordersDeleted++
            console.log(`[Sync] Soft-deleted order ${order.shipbob_order_id} (not found in ShipBob)`)
          }
          // If not 404, the order still exists - it's just outside our date range filter
        } catch (e) {
          // Network error - skip this order (don't delete if we can't verify)
          console.warn(`[Sync] Could not verify order ${order.shipbob_order_id}:`, e)
        }
      }
      result.ordersDeleted = ordersDeleted

      // Find shipments in our DB that weren't in the API response
      const { data: staleShipments } = await supabase
        .from('shipments')
        .select('id, shipment_id, order_id')
        .eq('client_id', clientId)
        .is('deleted_at', null) // Only check active records

      // Filter to shipments whose orders were in the sync but shipment wasn't
      const potentiallyDeletedShipments = (staleShipments || []).filter(
        (shipment: { id: string; shipment_id: string; order_id: string }) => {
          // Only check if the parent order was in the API response
          const parentOrderId = Object.entries(orderIdMap).find(
            ([, dbId]) => dbId === shipment.order_id
          )?.[0]
          if (!parentOrderId) return false // Parent order not in this sync

          // If parent was synced but this shipment wasn't in response, it may be deleted
          return !apiShipmentIdSet.has(shipment.shipment_id)
        }
      )

      // Verify each potentially-deleted shipment by checking the API
      let shipmentsDeleted = 0
      for (const shipment of potentiallyDeletedShipments) {
        try {
          const checkRes = await fetch(`${SHIPBOB_API_BASE}/shipment/${shipment.shipment_id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })

          if (checkRes.status === 404) {
            // Shipment is truly deleted from ShipBob - soft delete it
            await supabase
              .from('shipments')
              .update({ deleted_at: now })
              .eq('id', shipment.id)

            shipmentsDeleted++
            console.log(`[Sync] Soft-deleted shipment ${shipment.shipment_id} (not found in ShipBob)`)
          }
        } catch (e) {
          console.warn(`[Sync] Could not verify shipment ${shipment.shipment_id}:`, e)
        }
      }
      result.shipmentsDeleted = shipmentsDeleted
    }

    result.success = result.errors.length === 0
    result.duration = Date.now() - startTime
    return result
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    result.duration = Date.now() - startTime
    return result
  }
}

/**
 * Sync a single client by ID only (looks up client details from database)
 * Convenience wrapper for the admin API endpoint
 */
export async function syncClientById(
  clientId: string,
  daysBack: number = 30
): Promise<SyncResult> {
  const supabase = createAdminClient()

  // Look up client details
  const { data: client, error } = await supabase
    .from('clients')
    .select('id, name, shipbob_channel_id')
    .eq('id', clientId)
    .single()

  if (error || !client) {
    return {
      success: false,
      clientId,
      clientName: 'Unknown',
      ordersFound: 0,
      ordersUpserted: 0,
      shipmentsUpserted: 0,
      timelinesUpdated: 0,
      orderItemsUpserted: 0,
      shipmentItemsInserted: 0,
      cartonsInserted: 0,
      transactionsUpserted: 0,
      ordersDeleted: 0,
      shipmentsDeleted: 0,
      ordersRestored: 0,
      shipmentsRestored: 0,
      errors: [error?.message || 'Client not found'],
      duration: 0,
    }
  }

  // Use parent token (client-specific tokens not yet implemented)
  const token = process.env.SHIPBOB_API_TOKEN
  if (!token) {
    return {
      success: false,
      clientId,
      clientName: client.name,
      ordersFound: 0,
      ordersUpserted: 0,
      shipmentsUpserted: 0,
      timelinesUpdated: 0,
      orderItemsUpserted: 0,
      shipmentItemsInserted: 0,
      cartonsInserted: 0,
      transactionsUpserted: 0,
      ordersDeleted: 0,
      shipmentsDeleted: 0,
      ordersRestored: 0,
      shipmentsRestored: 0,
      errors: ['SHIPBOB_API_TOKEN not configured'],
      duration: 0,
    }
  }

  return syncClient(
    client.id,
    client.name,
    token,
    client.shipbob_channel_id?.toString() || '',
    daysBack
  )
}

/**
 * Sync all active clients
 */
export async function syncAll(options: SyncOptions | number = 7): Promise<FullSyncResult> {
  const startTime = Date.now()
  const supabase = createAdminClient()

  // Handle backward compat: number = daysBack
  const opts: SyncOptions = typeof options === 'number'
    ? { daysBack: options }
    : options

  const result: FullSyncResult = {
    success: false,
    clients: [],
    totalOrders: 0,
    totalShipments: 0,
    duration: 0,
    errors: [],
  }

  try {
    // Get all active clients with their tokens
    const { data: clients, error } = await supabase
      .from('clients')
      .select(
        `
        id,
        company_name,
        merchant_id,
        client_api_credentials (
          api_token,
          provider
        )
      `
      )
      .eq('is_active', true)

    if (error || !clients) {
      result.errors.push('Failed to fetch clients')
      result.duration = Date.now() - startTime
      return result
    }

    // Sync each client
    for (const client of clients) {
      const shipbobCred = (
        client.client_api_credentials as Array<{ api_token: string; provider: string }>
      )?.find((c) => c.provider === 'shipbob')

      if (!shipbobCred?.api_token) {
        console.log(`[Sync] Skipping ${client.company_name}: no ShipBob token`)
        continue
      }

      const syncMode = opts.minutesBack ? `${opts.minutesBack}min` : `${opts.daysBack || 7}d`
      console.log(`[Sync] Syncing ${client.company_name} (${syncMode})...`)

      const clientResult = await syncClient(
        client.id,
        client.company_name,
        shipbobCred.api_token,
        client.merchant_id || '',
        opts
      )

      result.clients.push(clientResult)
      result.totalOrders += clientResult.ordersFound
      result.totalShipments += clientResult.shipmentsUpserted

      console.log(
        `[Sync] ${client.company_name}: ${clientResult.ordersFound} orders, ${clientResult.shipmentsUpserted} shipments`
      )

      if (clientResult.errors.length > 0) {
        result.errors.push(...clientResult.errors.map((e) => `${client.company_name}: ${e}`))
      }
    }

    result.success = result.errors.length === 0
    result.duration = Date.now() - startTime
    return result
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    result.duration = Date.now() - startTime
    return result
  }
}

/**
 * Transaction Sync Result
 */
export interface TransactionSyncResult {
  success: boolean
  transactionsFetched: number
  transactionsUpserted: number
  attributed: number
  unattributed: number
  errors: string[]
  duration: number
}

/**
 * Sync ALL transactions by date range (not just shipment-linked)
 * This captures storage, returns, receiving, credits, etc.
 * Uses the parent API token.
 */
export async function syncAllTransactions(
  startDate: Date,
  endDate: Date
): Promise<TransactionSyncResult> {
  const startTime = Date.now()
  const result: TransactionSyncResult = {
    success: false,
    transactionsFetched: 0,
    transactionsUpserted: 0,
    attributed: 0,
    unattributed: 0,
    errors: [],
    duration: 0,
  }

  const parentToken = process.env.SHIPBOB_API_TOKEN
  if (!parentToken) {
    result.errors.push('SHIPBOB_API_TOKEN not configured')
    result.duration = Date.now() - startTime
    return result
  }

  const supabase = createAdminClient()

  try {
    // Get the "Jetpack" system client for parent-level transactions
    // This client holds: ACH payments, CC processing fees, disputed charges, credits
    console.log('[TransactionSync] Looking up Jetpack system client...')
    const { data: jetpackClient } = await supabase
      .from('clients')
      .select('id')
      .eq('company_name', 'Jetpack')
      .single()

    const jetpackClientId = jetpackClient?.id || null
    console.log(`[TransactionSync] Jetpack system client: ${jetpackClientId}`)

    // Build client_id -> client_info lookup for merchant_id population and name matching
    console.log('[TransactionSync] Building client info lookup...')
    const clientInfoLookup: Record<string, { merchant_id: string | null; company_name: string | null }> = {}
    const { data: clientsData } = await supabase
      .from('clients')
      .select('id, merchant_id, company_name')

    for (const c of clientsData || []) {
      clientInfoLookup[c.id] = { merchant_id: c.merchant_id || null, company_name: c.company_name || null }
    }
    console.log(`[TransactionSync] Client info lookup: ${Object.keys(clientInfoLookup).length} clients`)

    // Build lowercase company_name -> client_id lookup for TicketNumber attribution
    // Sort by name length descending so longer (more specific) names match first
    const clientNameLookup: Array<[string, string]> = []
    for (const c of clientsData || []) {
      if (c.company_name) {
        const name = c.company_name.toLowerCase()
        // Skip generic names that would cause false matches
        if (name === 'jetpack' || name === 'jetpack demo') continue
        clientNameLookup.push([name, c.id])
        // Also store without common suffixes
        const simplified = name.replace(/\s+(shaving|health|life)$/i, '')
        if (simplified !== name) clientNameLookup.push([simplified, c.id])
      }
    }
    // Sort by length descending - longer names match first (more specific)
    clientNameLookup.sort((a, b) => b[0].length - a[0].length)

    // Build shipment_id -> client_id lookup from database
    console.log('[TransactionSync] Building client lookup from shipments...')
    const clientLookup: Record<string, string> = {}
    let lastId: string | null = null
    const pageSize = 1000

    while (true) {
      let query = supabase
        .from('shipments')
        .select('id, shipment_id, client_id')
        .order('id', { ascending: true })
        .limit(pageSize)

      if (lastId) {
        query = query.gt('id', lastId)
      }

      const { data, error } = await query

      if (error) {
        console.error('[TransactionSync] Error fetching shipments:', error.message)
        break
      }

      if (!data || data.length === 0) break

      for (const s of data) {
        clientLookup[s.shipment_id] = s.client_id
        lastId = s.id
      }

      if (data.length < pageSize) break
    }
    console.log(`[TransactionSync] Built lookup with ${Object.keys(clientLookup).length} shipments`)

    // Build return_id -> client_id lookup from returns table
    console.log('[TransactionSync] Building returns lookup...')
    const returnLookup: Record<string, string> = {}
    let returnLastId: string | null = null

    while (true) {
      let query = supabase
        .from('returns')
        .select('id, shipbob_return_id, client_id')
        .order('id', { ascending: true })
        .limit(pageSize)

      if (returnLastId) {
        query = query.gt('id', returnLastId)
      }

      const { data, error } = await query

      if (error) {
        console.error('[TransactionSync] Error fetching returns:', error.message)
        break
      }

      if (!data || data.length === 0) break

      for (const r of data) {
        if (r.shipbob_return_id && r.client_id) {
          returnLookup[r.shipbob_return_id.toString()] = r.client_id
        }
        returnLastId = r.id
      }

      if (data.length < pageSize) break
    }
    console.log(`[TransactionSync] Built returns lookup with ${Object.keys(returnLookup).length} returns`)

    // Build inventory_id -> client_id lookup from products.variants
    // FC (Storage) transactions use this to attribute by inventory ID
    console.log('[TransactionSync] Building inventory lookup from products...')
    const inventoryLookup: Record<string, string> = {}
    let productLastId: string | null = null

    while (true) {
      let query = supabase
        .from('products')
        .select('id, client_id, variants')
        .order('id', { ascending: true })
        .limit(pageSize)

      if (productLastId) {
        query = query.gt('id', productLastId)
      }

      const { data, error } = await query

      if (error) {
        console.error('[TransactionSync] Error fetching products:', error.message)
        break
      }

      if (!data || data.length === 0) break

      for (const p of data) {
        if (p.client_id && Array.isArray(p.variants)) {
          // Extract inventory_id from each variant's inventory object
          for (const variant of p.variants) {
            const invId = variant?.inventory?.inventory_id
            if (invId) {
              inventoryLookup[String(invId)] = p.client_id
            }
          }
        }
        productLastId = p.id
      }

      if (data.length < pageSize) break
    }
    console.log(`[TransactionSync] Built inventory lookup with ${Object.keys(inventoryLookup).length} inventory IDs`)

    // Build WRO lookup from receiving_orders table
    console.log('[TransactionSync] Building WRO lookup from receiving_orders...')
    const wroLookup: Record<string, { client_id: string; merchant_id: string | null }> = {}
    let wroLastId: string | null = null

    while (true) {
      let query = supabase
        .from('receiving_orders')
        .select('id, shipbob_receiving_id, client_id, merchant_id')
        .order('id', { ascending: true })
        .limit(pageSize)

      if (wroLastId) {
        query = query.gt('id', wroLastId)
      }

      const { data, error } = await query

      if (error) {
        console.error('[TransactionSync] Error fetching receiving_orders:', error.message)
        break
      }

      if (!data || data.length === 0) break

      for (const wro of data) {
        if (wro.shipbob_receiving_id && wro.client_id) {
          wroLookup[String(wro.shipbob_receiving_id)] = {
            client_id: wro.client_id,
            merchant_id: wro.merchant_id || null,
          }
        }
        wroLastId = wro.id
      }

      if (data.length < pageSize) break
    }
    console.log(`[TransactionSync] Built WRO lookup with ${Object.keys(wroLookup).length} WROs`)

    // Build order_id -> client_id lookup from orders table
    // Used for Return transactions that reference an order in additional_details.Comment
    console.log('[TransactionSync] Building orders lookup from orders...')
    const orderLookup: Record<string, string> = {}
    let orderLastId: string | null = null

    while (true) {
      let query = supabase
        .from('orders')
        .select('id, shipbob_order_id, client_id')
        .order('id', { ascending: true })
        .limit(pageSize)

      if (orderLastId) {
        query = query.gt('id', orderLastId)
      }

      const { data, error } = await query

      if (error) {
        console.error('[TransactionSync] Error fetching orders:', error.message)
        break
      }

      if (!data || data.length === 0) break

      for (const o of data) {
        if (o.shipbob_order_id && o.client_id) {
          orderLookup[o.shipbob_order_id.toString()] = o.client_id
        }
        orderLastId = o.id
      }

      if (data.length < pageSize) break
    }
    console.log(`[TransactionSync] Built orders lookup with ${Object.keys(orderLookup).length} orders`)

    // Fetch ALL transactions by date range
    console.log(`[TransactionSync] Fetching transactions from ${startDate.toISOString()} to ${endDate.toISOString()}...`)

    interface ShipBobTransaction {
      transaction_id: string
      reference_id: string
      reference_type: string
      transaction_type: string
      transaction_fee: string
      amount: number
      charge_date: string
      invoice_date?: string
      invoiced_status: boolean
      invoice_id?: number
      fulfillment_center?: string
      additional_details?: Record<string, unknown>
      taxes?: Array<{ tax_type?: string; tax_rate?: number; tax_amount?: number }>
    }

    const transactions: ShipBobTransaction[] = []
    let cursor: string | null = null
    let page = 0

    do {
      page++
      let url = `${SHIPBOB_API_BASE}/transactions:query`
      if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${parentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from_date: startDate.toISOString(),
          to_date: endDate.toISOString(),
          page_size: 1000,
        }),
      })

      if (!response.ok) {
        if (response.status === 429) {
          // Rate limited - wait and retry
          console.log('[TransactionSync] Rate limited, waiting 60s...')
          await new Promise((r) => setTimeout(r, 60000))
          continue
        }
        throw new Error(`API error: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      transactions.push(...(data.items || []))
      cursor = data.next

      console.log(`[TransactionSync] Page ${page}: ${transactions.length} total transactions`)
    } while (cursor)

    result.transactionsFetched = transactions.length
    console.log(`[TransactionSync] Fetched ${transactions.length} transactions`)

    if (transactions.length === 0) {
      result.success = true
      result.duration = Date.now() - startTime
      return result
    }

    // Transform to DB records with client attribution
    const now = new Date().toISOString()

    const txRecords = transactions.map((tx) => {
      // Try to attribute client based on reference_type
      let clientId: string | null = null

      // Strategy 1: Shipment - direct lookup
      if (tx.reference_type === 'Shipment') {
        clientId = clientLookup[tx.reference_id] || null
      }

      // Strategy 2: FC (Storage) - lookup by inventory ID from products.variants
      // reference_id format: {FC_ID}-{InventoryId}-{LocationType}
      // Also check additional_details.InventoryId as backup
      else if (tx.reference_type === 'FC') {
        const parts = tx.reference_id.split('-')
        let invId: string | null = null
        if (parts.length >= 2) {
          invId = parts[1] // Middle part is InventoryId
        }
        if (!invId && tx.additional_details?.InventoryId) {
          invId = String(tx.additional_details.InventoryId)
        }
        if (invId) {
          clientId = inventoryLookup[invId] || null
        }
      }

      // Strategy 3: Return - lookup via returns table, then order reference
      else if (tx.reference_type === 'Return') {
        // 3a: Direct lookup in returns table
        clientId = returnLookup[tx.reference_id] || null

        // 3b: Fallback - Parse order ID from additional_details.Comment
        // Format: "Return to sender fee for Order 307909309"
        if (!clientId && tx.additional_details) {
          const comment = (tx.additional_details as { Comment?: string }).Comment
          if (comment) {
            const match = comment.match(/Order\s+(\d+)/i)
            if (match) {
              const orderId = match[1]
              clientId = orderLookup[orderId] || null
            }
          }
        }
      }

      // Strategy 4: Default - route by transaction_fee
      else if (tx.reference_type === 'Default') {
        const fee = tx.transaction_fee
        if (fee === 'Payment' && jetpackClientId) {
          // ACH payments go to Jetpack system client
          clientId = jetpackClientId
        } else if (fee === 'Credit Card Processing Fee' && jetpackClientId) {
          // CC processing fee is a parent-level cost to Jetpack
          clientId = jetpackClientId
        } else if (fee === 'Credit') {
          // Credits - try shipment lookup first, then return, then WRO
          clientId = clientLookup[tx.reference_id] || null
          if (!clientId) {
            // Fallback: check if reference_id is a return ID
            clientId = returnLookup[tx.reference_id] || null
          }
          if (!clientId) {
            // Fallback: check if reference_id is a WRO ID
            const wroInfo = wroLookup[tx.reference_id]
            if (wroInfo) {
              clientId = wroInfo.client_id
            }
          }
        }
        // Warehousing Fee and other Default fees left unattributed if no direct match
      }

      // Strategy 5: TicketNumber - parse client name from additional_details.Comment
      else if (tx.reference_type === 'TicketNumber') {
        // Try to extract client name from comment
        // Example: "COPS-179733 Jetpack/Eli Health wants images..."
        const comment = (tx.additional_details as { Comment?: string })?.Comment?.toLowerCase() || ''

        if (comment) {
          // Try each client name to see if it appears in the comment
          // clientNameLookup is sorted by length descending, so longer (more specific) names match first
          for (const [nameLower, cId] of clientNameLookup) {
            if (comment.includes(nameLower)) {
              clientId = cId
              break
            }
          }

          // If not found, try common patterns like "Jetpack/ClientName"
          if (!clientId) {
            // Look for patterns like "jetpack/eli health" or "jetpack/henson"
            const slashMatch = comment.match(/jetpack\/(\w+(?:\s+\w+)?)/i)
            if (slashMatch) {
              const afterSlash = slashMatch[1].toLowerCase()
              for (const [nameLower, cId] of clientNameLookup) {
                if (nameLower.includes(afterSlash) || afterSlash.includes(nameLower.split(' ')[0])) {
                  clientId = cId
                  break
                }
              }
            }
          }
        }
      }

      // Strategy 6: WRO/URO - lookup via receiving_orders table
      else if (tx.reference_type === 'WRO' || tx.reference_type === 'URO') {
        const wroInfo = wroLookup[tx.reference_id]
        if (wroInfo) {
          clientId = wroInfo.client_id
        }
      }

      if (clientId) {
        result.attributed++
      } else {
        result.unattributed++
      }

      // Look up merchant_id from client if attributed
      let merchantId: string | null = null
      if (clientId) {
        const clientInfo = clientInfoLookup[clientId]
        merchantId = clientInfo?.merchant_id || null
      }

      // Build the base record (without client_id/merchant_id)
      // IMPORTANT: Only include client_id/merchant_id if they're NOT null.
      // This prevents the upsert from overwriting existing attributed values with null
      // when re-syncing transactions that we can't attribute (e.g., due to incomplete lookups).
      const baseRecord: Record<string, unknown> = {
        transaction_id: tx.transaction_id,
        reference_id: tx.reference_id,
        reference_type: tx.reference_type,
        transaction_type: tx.transaction_type || null,
        fee_type: tx.transaction_fee,
        // For WRO Receiving Fee, API 'amount' includes taxes - subtract to get pre-tax cost
        // For other fee types (Shipping, Per Pick, Storage), API 'amount' is already pre-tax
        // Taxes are stored separately in the 'taxes' column for all transactions
        cost: (tx.reference_type === 'WRO' && tx.transaction_fee?.includes('Receiving'))
          ? tx.amount - (tx.taxes || []).reduce((sum, t) => sum + (t.tax_amount || 0), 0)
          : tx.amount,
        charge_date: tx.charge_date,
        invoice_date_sb: tx.invoice_date || null,
        invoiced_status_sb: tx.invoiced_status || false,
        invoice_id_sb: tx.invoice_id || null,
        fulfillment_center: tx.fulfillment_center || null,
        additional_details: tx.additional_details || null,
        // Extract tracking_id from additional_details.TrackingId
        tracking_id: (tx.additional_details as Record<string, unknown>)?.TrackingId as string || null,
        // Capture taxes (GST/HST for Canadian FCs)
        taxes: tx.taxes && tx.taxes.length > 0 ? tx.taxes : null,
        updated_at: now,
      }

      // Only include client_id and merchant_id if we successfully attributed
      // This prevents overwriting existing values with null on re-sync
      if (clientId) {
        baseRecord.client_id = clientId
        baseRecord.merchant_id = merchantId
      }

      return baseRecord
    })

    // Auto-register any new fulfillment centers
    const fcNames = txRecords
      .map(r => r.fulfillment_center as string | null)
      .filter((fc): fc is string => !!fc)
    if (fcNames.length > 0) {
      await ensureFCsExist(supabase, fcNames)
    }

    // Batch upsert
    console.log('[TransactionSync] Upserting transactions...')
    const txResult = await batchUpsert(supabase, 'transactions', txRecords, 'transaction_id')
    result.transactionsUpserted = txResult.success
    result.errors.push(...txResult.errors)

    console.log(
      `[TransactionSync] Initial pass: ${result.transactionsUpserted} upserted, ${result.attributed} attributed, ${result.unattributed} unattributed`
    )

    // ==========================================
    // SECOND PASS: Database-join attribution fix
    // ==========================================
    // For Shipment transactions that couldn't be attributed via in-memory lookup,
    // query the database to find matching shipments and copy their client_id.
    // This handles race conditions where the clientLookup was incomplete.
    // Uses direct database join which is always accurate.

    console.log('[TransactionSync] Running database-join attribution fix for unattributed Shipment transactions...')

    // Find unattributed Shipment transactions that have matching shipments with client_id
    const FIX_BATCH_SIZE = 500
    let fixLastId: string | null = null
    let totalFixed = 0

    while (true) {
      // Get batch of unattributed Shipment transactions
      let query = supabase
        .from('transactions')
        .select('id, transaction_id, reference_id')
        .eq('reference_type', 'Shipment')
        .is('client_id', null)
        .order('id', { ascending: true })
        .limit(FIX_BATCH_SIZE)

      if (fixLastId) {
        query = query.gt('id', fixLastId)
      }

      const { data: unattributedTxs, error: fetchError } = await query

      if (fetchError) {
        result.errors.push(`Attribution fix fetch error: ${fetchError.message}`)
        break
      }

      if (!unattributedTxs || unattributedTxs.length === 0) {
        break
      }

      // Get shipment info for these reference_ids
      const referenceIds = unattributedTxs.map((t: { id: string; transaction_id: string; reference_id: string }) => t.reference_id)
      const { data: shipments, error: shipError } = await supabase
        .from('shipments')
        .select('shipment_id, client_id')
        .in('shipment_id', referenceIds)
        .not('client_id', 'is', null)

      if (shipError) {
        result.errors.push(`Attribution fix shipment fetch error: ${shipError.message}`)
        break
      }

      // Build lookup: shipment_id -> client_id
      const shipmentClientMap: Record<string, string> = {}
      for (const s of shipments || []) {
        if (s.client_id) {
          shipmentClientMap[s.shipment_id] = s.client_id
        }
      }

      // Update each transaction that has a matching shipment
      for (const tx of unattributedTxs) {
        const clientId = shipmentClientMap[tx.reference_id]
        if (clientId) {
          // Look up merchant_id for this client
          const merchantId = clientInfoLookup[clientId]?.merchant_id || null

          const { error: updateError } = await supabase
            .from('transactions')
            .update({
              client_id: clientId,
              merchant_id: merchantId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', tx.id)

          if (updateError) {
            result.errors.push(`Attribution fix update failed: ${updateError.message}`)
          } else {
            totalFixed++
            result.attributed++
            result.unattributed--
          }
        }
        fixLastId = tx.id
      }

      if (unattributedTxs.length < FIX_BATCH_SIZE) break
    }

    if (totalFixed > 0) {
      console.log(`[TransactionSync] Attribution fix: Fixed ${totalFixed} transactions via database join`)
    }

    // ==========================================
    // THIRD PASS: Backfill tracking_id from shipments
    // ==========================================
    // For Shipment transactions without tracking_id (e.g., Per Pick Fee),
    // look up the tracking_id from the shipments table.
    // The API only provides TrackingId in additional_details for Shipping fee type,
    // but other Shipment-linked fees (Per Pick Fee, B2B fees, etc.) need lookup.

    console.log('[TransactionSync] Backfilling tracking_id for Shipment transactions without it...')

    let trackingFixLastId: string | null = null
    let totalTrackingFixed = 0

    while (true) {
      // Get batch of Shipment transactions without tracking_id
      let trackingQuery = supabase
        .from('transactions')
        .select('id, reference_id')
        .eq('reference_type', 'Shipment')
        .is('tracking_id', null)
        .order('id', { ascending: true })
        .limit(FIX_BATCH_SIZE)

      if (trackingFixLastId) {
        trackingQuery = trackingQuery.gt('id', trackingFixLastId)
      }

      const { data: noTrackingTxs, error: trackingFetchError } = await trackingQuery

      if (trackingFetchError) {
        result.errors.push(`Tracking backfill fetch error: ${trackingFetchError.message}`)
        break
      }

      if (!noTrackingTxs || noTrackingTxs.length === 0) {
        break
      }

      // Get tracking_id from shipments for these reference_ids
      const shipmentIds = [...new Set(noTrackingTxs.map((t: { id: string; reference_id: string }) => t.reference_id))]
      const { data: shipmentsWithTracking, error: trackingShipError } = await supabase
        .from('shipments')
        .select('shipment_id, tracking_id')
        .in('shipment_id', shipmentIds)
        .not('tracking_id', 'is', null)

      if (trackingShipError) {
        result.errors.push(`Tracking backfill shipment fetch error: ${trackingShipError.message}`)
        break
      }

      // Build lookup: shipment_id -> tracking_id
      const trackingLookup: Record<string, string> = {}
      for (const s of shipmentsWithTracking || []) {
        if (s.tracking_id) {
          trackingLookup[s.shipment_id] = s.tracking_id
        }
      }

      // Update each transaction that has a matching shipment with tracking
      for (const tx of noTrackingTxs) {
        const trackingId = trackingLookup[tx.reference_id]
        if (trackingId) {
          const { error: updateError } = await supabase
            .from('transactions')
            .update({
              tracking_id: trackingId,
              updated_at: new Date().toISOString(),
            })
            .eq('id', tx.id)

          if (!updateError) {
            totalTrackingFixed++
          }
        }
        trackingFixLastId = tx.id
      }

      if (noTrackingTxs.length < FIX_BATCH_SIZE) break
    }

    if (totalTrackingFixed > 0) {
      console.log(`[TransactionSync] Tracking backfill: Fixed ${totalTrackingFixed} transactions from shipments table`)
    }

    console.log(
      `[TransactionSync] Final: ${result.transactionsUpserted} upserted, ${result.attributed} attributed, ${result.unattributed} unattributed`
    )

    result.success = result.errors.length === 0
    result.duration = Date.now() - startTime
    return result
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : 'Unknown error')
    result.duration = Date.now() - startTime
    return result
  }
}

/**
 * Timeline Sync Result
 */
export interface TimelineSyncResult {
  success: boolean
  totalShipments: number
  updated: number
  skipped: number
  errors: string[]
  duration: number
}

/**
 * Sync timeline events for ALL undelivered shipments across all clients.
 * This should be called at the per-minute level to catch timeline updates
 * for shipments that weren't recently modified in the Orders API.
 *
 * Filters to shipments where:
 * - event_delivered IS NULL (not yet delivered)
 * - deleted_at IS NULL (not soft-deleted)
 * - status NOT IN ('Processing', 'Exception', 'Cancelled') (has tracking activity)
 *
 * @param batchSize - Number of shipments to process per run (default 100)
 * @param maxAgeHours - Only process shipments created within this many hours (default 336 = 14 days)
 */
export async function syncAllUndeliveredTimelines(
  batchSize: number = 100,
  maxAgeHours: number = 336
): Promise<TimelineSyncResult> {
  const startTime = Date.now()
  const supabase = createAdminClient()
  const result: TimelineSyncResult = {
    success: false,
    totalShipments: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    duration: 0,
  }

  try {
    // Get all clients with their tokens
    const { data: clients } = await supabase
      .from('clients')
      .select('id, company_name, client_api_credentials(api_token, provider)')
      .eq('is_active', true)

    const clientTokens: Record<string, string> = {}
    for (const c of clients || []) {
      const creds = c.client_api_credentials as Array<{ api_token: string; provider: string }> | null
      const token = creds?.find(cred => cred.provider === 'shipbob')?.api_token
      if (token) {
        clientTokens[c.id] = token
      }
    }

    if (Object.keys(clientTokens).length === 0) {
      result.errors.push('No clients with ShipBob tokens found')
      result.duration = Date.now() - startTime
      return result
    }

    // Calculate cutoff dates for tiered check frequency
    const now = new Date()
    const cutoffDate = new Date(now)
    cutoffDate.setHours(cutoffDate.getHours() - maxAgeHours)

    // Tiered check windows based on shipment age:
    // - Fresh (0-3 days): Check every 15 minutes - actively moving through carrier network
    // - Older (3+ days): Check every 2 hours - likely delivered or stuck
    const freshCutoff = new Date(now)
    freshCutoff.setDate(freshCutoff.getDate() - 3) // 3 days ago

    const freshCheckWindow = new Date(now)
    freshCheckWindow.setMinutes(freshCheckWindow.getMinutes() - 15) // 15 min ago

    const olderCheckWindow = new Date(now)
    olderCheckWindow.setHours(olderCheckWindow.getHours() - 2) // 2 hours ago

    // Per-client capacity split: 70% fresh, 30% older
    // Each client gets their own batchSize (default 100) to maximize their rate limit budget
    const freshLimitPerClient = Math.floor(batchSize * 0.7)  // 70 per client
    const olderLimitPerClient = batchSize - freshLimitPerClient  // 30 per client

    // Query shipments PER CLIENT in parallel - each client has their own 150 req/min rate limit
    const clientIds = Object.keys(clientTokens)
    console.log(`[TimelineSync] Querying shipments for ${clientIds.length} clients (${batchSize} max each)...`)

    // Fetch shipments for all clients in parallel
    const clientShipmentResults = await Promise.all(
      clientIds.map(async (clientId) => {
        // Query fresh shipments for this client
        const { data: freshShipments, error: freshError } = await supabase
          .from('shipments')
          .select('id, shipment_id, client_id, status')
          .eq('client_id', clientId)
          .is('event_delivered', null)
          .is('deleted_at', null)
          .neq('status', 'Cancelled')
          .gte('created_at', freshCutoff.toISOString())
          .or(`timeline_checked_at.is.null,timeline_checked_at.lt.${freshCheckWindow.toISOString()}`)
          .order('timeline_checked_at', { ascending: true, nullsFirst: true })
          .limit(freshLimitPerClient)

        const freshCount = freshShipments?.length || 0
        const actualOlderLimit = olderLimitPerClient + (freshLimitPerClient - freshCount)

        // Query older shipments for this client
        const { data: olderShipments, error: olderError } = await supabase
          .from('shipments')
          .select('id, shipment_id, client_id, status')
          .eq('client_id', clientId)
          .is('event_delivered', null)
          .is('deleted_at', null)
          .neq('status', 'Cancelled')
          .gte('created_at', cutoffDate.toISOString())
          .lt('created_at', freshCutoff.toISOString())
          .or(`timeline_checked_at.is.null,timeline_checked_at.lt.${olderCheckWindow.toISOString()}`)
          .order('timeline_checked_at', { ascending: true, nullsFirst: true })
          .limit(actualOlderLimit)

        const errors: string[] = []
        if (freshError) errors.push(`Fresh query error for ${clientId}: ${freshError.message}`)
        if (olderError) errors.push(`Older query error for ${clientId}: ${olderError.message}`)

        return {
          clientId,
          shipments: [...(freshShipments || []), ...(olderShipments || [])],
          freshCount,
          olderCount: olderShipments?.length || 0,
          errors,
        }
      })
    )

    // Aggregate results and build shipments by client map
    const shipmentsByClient: Record<string, Array<{ id: string; shipment_id: string; client_id: string; status: string }>> = {}
    let totalFresh = 0
    let totalOlder = 0

    for (const cr of clientShipmentResults) {
      shipmentsByClient[cr.clientId] = cr.shipments
      totalFresh += cr.freshCount
      totalOlder += cr.olderCount
      result.errors.push(...cr.errors)
    }

    const totalShipments = totalFresh + totalOlder
    result.totalShipments = totalShipments

    console.log(`[TimelineSync] Found ${totalFresh} fresh (0-3d) + ${totalOlder} older (3-14d) across ${clientIds.length} clients`)

    if (totalShipments === 0) {
      console.log('[TimelineSync] No undelivered shipments to update')
      result.success = true
      result.duration = Date.now() - startTime
      return result
    }

    console.log(`[TimelineSync] Processing ${totalShipments} shipments across ${clientIds.length} clients in parallel...`)

    // Process each client's shipments in parallel (each client has own rate limit)
    const clientResults = await Promise.all(
      clientIds.map(async (clientId) => {
        const clientShipments = shipmentsByClient[clientId]
        const token = clientTokens[clientId]
        const clientResult = { updated: 0, skipped: 0, errors: [] as string[] }

        if (!token) {
          clientResult.skipped = clientShipments.length
          return clientResult
        }

        for (const ship of clientShipments) {
          const timelineResult = await fetchShipmentTimeline(ship.shipment_id, token)

          if (timelineResult === null) {
            // API error - count but don't fail
            clientResult.errors.push(`API error for shipment ${ship.shipment_id}`)
          } else if (Object.keys(timelineResult.eventColumns).length > 0 || timelineResult.eventLogs.length > 0) {
            // Build update object with event columns and full event_logs JSONB
            const updateData: Record<string, unknown> = {
              ...timelineResult.eventColumns,
            }

            // Store full timeline as event_logs JSONB
            if (timelineResult.eventLogs.length > 0) {
              updateData.event_logs = timelineResult.eventLogs
            }

            // Calculate transit_time_days when we have both intransit and delivered timestamps
            const intransitDate = timelineResult.eventColumns.event_intransit as string | undefined
            const deliveredDate = timelineResult.eventColumns.event_delivered as string | undefined
            if (intransitDate && deliveredDate) {
              const intransit = new Date(intransitDate).getTime()
              const delivered = new Date(deliveredDate).getTime()
              const transitMs = delivered - intransit
              const transitDays = Math.round((transitMs / (1000 * 60 * 60 * 24)) * 10) / 10 // Round to 1 decimal
              if (transitDays >= 0) {
                updateData.transit_time_days = transitDays
              }
            }

            // If timeline shows Labeled but our status is still pre-label, fetch full shipment for status/tracking
            const preLabelStatuses = ['None', 'Processing', 'Pending', 'OnHold', 'Exception']
            const hasLabeledEvent = timelineResult.eventColumns.event_labeled != null
            if (hasLabeledEvent && preLabelStatuses.includes(ship.status)) {
              try {
                const shipRes = await fetch(`https://api.shipbob.com/1.0/shipment/${ship.shipment_id}`, {
                  headers: { Authorization: `Bearer ${token}` },
                })
                if (shipRes.ok) {
                  const shipData = await shipRes.json()
                  updateData.status = shipData.status
                  updateData.status_details = shipData.status_details || null
                  if (shipData.tracking) {
                    updateData.tracking_id = shipData.tracking.tracking_number || null
                    updateData.tracking_url = shipData.tracking.tracking_url || null
                    updateData.carrier = shipData.tracking.carrier || null
                  }
                }
                // Extra delay after full shipment fetch
                await new Promise((r) => setTimeout(r, TIMELINE_DELAY_MS))
              } catch {
                // Ignore errors - we'll still update timeline data
              }
            }

            // Update the shipment with timeline data + mark as checked
            updateData.timeline_checked_at = new Date().toISOString()
            const { error } = await supabase
              .from('shipments')
              .update(updateData)
              .eq('id', ship.id)

            if (error) {
              clientResult.errors.push(`Update error for ${ship.shipment_id}: ${error.message}`)
            } else {
              clientResult.updated++
            }
          } else {
            // Empty timeline (404 or no events yet) - still mark as checked
            await supabase
              .from('shipments')
              .update({ timeline_checked_at: new Date().toISOString() })
              .eq('id', ship.id)
            clientResult.skipped++
          }

          // Delay between API calls to avoid rate limits (per client)
          await new Promise((r) => setTimeout(r, TIMELINE_DELAY_MS))
        }

        return clientResult
      })
    )

    // Aggregate results from all clients
    for (const cr of clientResults) {
      result.updated += cr.updated
      result.skipped += cr.skipped
      result.errors.push(...cr.errors)
    }

    console.log(`[TimelineSync] Complete: ${result.updated} updated, ${result.skipped} skipped, ${result.errors.length} errors`)
    result.success = result.errors.length < result.totalShipments // Allow some errors
    result.duration = Date.now() - startTime
    return result
  } catch (e) {
    result.errors.push(`Fatal error: ${e instanceof Error ? e.message : 'Unknown'}`)
    result.duration = Date.now() - startTime
    return result
  }
}

// Legacy exports for backward compatibility
export type { SyncResult as BillingSyncResult }
export async function syncAllClients(daysBack: number = 30) {
  const result = await syncAll(daysBack)
  return result.clients.map((c) => ({
    success: c.success,
    clientId: c.clientId,
    ordersFound: c.ordersFound,
    ordersInserted: c.ordersUpserted,
    ordersUpdated: 0,
    shipmentIds: [],
    errors: c.errors,
  }))
}

export async function syncBillingTransactions() {
  return {
    success: true,
    transactionsFound: 0,
    transactionsInserted: 0,
    transactionsUpdated: 0,
    invoicesFound: 0,
    invoicesInserted: 0,
    errors: [],
  }
}

/**
 * Sync returns from ShipBob API
 *
 * Strategy: Find return IDs from transactions table that are missing from returns table,
 * then fetch each from the API. This ensures we have return data for all billed returns.
 */
export interface ReturnsSyncResult {
  success: boolean
  synced: number
  skipped: number
  errors: string[]
  duration: number
}

export async function syncReturns(): Promise<ReturnsSyncResult> {
  const startTime = Date.now()
  const supabase = createAdminClient()
  const result: ReturnsSyncResult = {
    success: false,
    synced: 0,
    skipped: 0,
    errors: [],
    duration: 0,
  }

  try {
    // Get all clients with their tokens and merchant_ids
    const { data: clients } = await supabase
      .from('clients')
      .select('id, company_name, merchant_id, client_api_credentials(api_token, provider)')
      .eq('is_active', true)

    const clientLookup: Record<string, { token: string; merchantId: string | null; name: string }> = {}
    for (const c of clients || []) {
      const creds = c.client_api_credentials as Array<{ api_token: string; provider: string }> | null
      const token = creds?.find(cred => cred.provider === 'shipbob')?.api_token
      if (token) {
        clientLookup[c.id] = { token, merchantId: c.merchant_id, name: c.company_name }
      }
    }

    // ==========================================
    // PROACTIVE SYNC: Fetch recent returns for ALL clients
    // ==========================================
    // This ensures returns are in the database BEFORE transactions reference them,
    // solving the chicken-and-egg problem where transactions can't be attributed
    // because the return doesn't exist in our returns table yet.
    //
    // This is O(clients) API calls, not O(clients * unattributed_returns).

    console.log(`[ReturnsSync] Proactive sync: Fetching recent returns for ${Object.keys(clientLookup).length} clients`)

    for (const [clientId, client] of Object.entries(clientLookup)) {
      try {
        // Fetch recent returns for this client (last 60 days, paginated)
        let cursor: string | null = null
        let totalFetched = 0
        const returnRecords: Array<Record<string, unknown>> = []

        do {
          let url = `https://api.shipbob.com/2025-07/return?Limit=250`
          if (cursor) url += `&cursor=${cursor}`

          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${client.token}` }
          })

          if (!res.ok) {
            if (res.status !== 404) {
              console.log(`[ReturnsSync] ${client.name}: API error ${res.status}`)
            }
            break
          }

          const data = await res.json()
          const returns = data.items || []
          if (returns.length === 0) break

          for (const ret of returns) {
            returnRecords.push({
              client_id: clientId,
              merchant_id: client.merchantId,
              shipbob_return_id: ret.id,
              reference_id: ret.reference_id || null,
              status: ret.status || null,
              return_type: ret.return_type || null,
              tracking_number: ret.tracking_number || null,
              shipment_tracking_number: ret.tracking_number || null,
              original_shipment_id: ret.original_shipment_id || null,
              store_order_id: ret.store_order_id || null,
              invoice_amount: ret.invoice_amount || null,
              invoice_currency: 'USD',
              fc_id: ret.fulfillment_center?.id || null,
              fc_name: ret.fulfillment_center?.name || null,
              channel_id: ret.channel?.id || null,
              channel_name: ret.channel?.name || null,
              insert_date: ret.insert_date || null,
              awaiting_arrival_date: ret.status === 'AwaitingArrival' ? ret.insert_date : null,
              arrived_date: ret.arrived_date || null,
              processing_date: ret.processing_date || null,
              completed_date: ret.completed_date || null,
              cancelled_date: ret.cancelled_date || null,
              status_history: ret.status_history || null,
              inventory: ret.inventory || null,
              synced_at: new Date().toISOString(),
            })
          }

          totalFetched += returns.length

          // Extract cursor from next URL if present
          if (data.next) {
            const nextUrl = new URL(data.next)
            cursor = nextUrl.searchParams.get('cursor')
          } else {
            cursor = null
          }

          // Limit to ~500 returns per client per run to avoid rate limits
          if (totalFetched >= 500) break

        } while (cursor)

        if (returnRecords.length > 0) {
          // Batch upsert
          const { error } = await supabase
            .from('returns')
            .upsert(returnRecords, { onConflict: 'shipbob_return_id' })

          if (error) {
            result.errors.push(`${client.name}: Upsert error - ${error.message}`)
          } else {
            result.synced += returnRecords.length
            console.log(`[ReturnsSync] ${client.name}: synced ${returnRecords.length} returns`)
          }
        }

        await new Promise(r => setTimeout(r, 100)) // Small delay between clients

      } catch (e) {
        result.errors.push(`${client.name}: ${e instanceof Error ? e.message : 'Unknown error'}`)
      }
    }

    // ==========================================
    // TRANSACTION-BASED SYNC: Fetch specific missing returns
    // ==========================================
    // For transactions that reference returns not caught by proactive sync
    // (older returns or ones created between syncs), fetch them individually.

    // Get return IDs from transactions that have client_id attributed
    const { data: returnTxs } = await supabase
      .from('transactions')
      .select('reference_id, client_id')
      .eq('reference_type', 'Return')
      .not('client_id', 'is', null)

    // Group by client
    const returnsByClient: Record<string, Set<number>> = {}
    for (const tx of returnTxs || []) {
      const clientId = tx.client_id
      if (!clientId || !clientLookup[clientId]) continue
      if (!returnsByClient[clientId]) returnsByClient[clientId] = new Set()
      const returnId = Number(tx.reference_id)
      if (returnId > 0) returnsByClient[clientId].add(returnId)
    }

    // Process each client - only fetch returns missing from proactive sync
    for (const [clientId, returnIds] of Object.entries(returnsByClient)) {
      const client = clientLookup[clientId]
      const returnIdArray = Array.from(returnIds)

      // Get existing returns
      const { data: existing } = await supabase
        .from('returns')
        .select('shipbob_return_id')
        .eq('client_id', clientId)
        .in('shipbob_return_id', returnIdArray.slice(0, 1000))

      const existingIds = new Set(existing?.map((r: { shipbob_return_id: number }) => r.shipbob_return_id) || [])

      // Filter to only missing
      const toSync = returnIdArray.filter(id => !existingIds.has(id))
      result.skipped += existingIds.size

      if (toSync.length === 0) continue

      console.log(`[ReturnsSync] ${client.name}: fetching ${toSync.length} specific missing returns`)

      // Fetch and upsert each missing return
      const records: Array<Record<string, unknown>> = []
      for (const returnId of toSync) {
        try {
          const res = await fetch(`https://api.shipbob.com/1.0/return/${returnId}`, {
            headers: { Authorization: `Bearer ${client.token}` }
          })
          if (!res.ok) {
            result.errors.push(`Failed to fetch return ${returnId}: ${res.status}`)
            continue
          }
          const returnData = await res.json()
          records.push({
            client_id: clientId,
            merchant_id: client.merchantId,
            shipbob_return_id: returnData.id,
            reference_id: returnData.reference_id || null,
            status: returnData.status || null,
            return_type: returnData.return_type || null,
            tracking_number: returnData.tracking_number || null,
            shipment_tracking_number: returnData.tracking_number || null,
            original_shipment_id: returnData.original_shipment_id || null,
            store_order_id: returnData.store_order_id || null,
            invoice_amount: returnData.invoice_amount || null,
            invoice_currency: 'USD',
            fc_id: returnData.fulfillment_center?.id || null,
            fc_name: returnData.fulfillment_center?.name || null,
            channel_id: returnData.channel?.id || null,
            channel_name: returnData.channel?.name || null,
            insert_date: returnData.insert_date || null,
            awaiting_arrival_date: returnData.status === 'AwaitingArrival' ? returnData.insert_date : null,
            arrived_date: returnData.arrived_date || null,
            processing_date: returnData.processing_date || null,
            completed_date: returnData.completed_date || null,
            cancelled_date: returnData.cancelled_date || null,
            status_history: returnData.status_history || null,
            inventory: returnData.inventory || null,
            synced_at: new Date().toISOString(),
          })
        } catch (e) {
          result.errors.push(`Error fetching return ${returnId}: ${e instanceof Error ? e.message : 'Unknown'}`)
        }

        // Small delay to be nice to API
        await new Promise(r => setTimeout(r, 100))
      }

      // Upsert all records
      if (records.length > 0) {
        const { error } = await supabase
          .from('returns')
          .upsert(records, { onConflict: 'shipbob_return_id' })

        if (error) {
          result.errors.push(`Upsert error for ${client.name}: ${error.message}`)
        } else {
          result.synced += records.length
        }
      }
    }

    // ==========================================
    // ATTRIBUTION FIX: Update unattributed transactions from returns table
    // ==========================================
    // Now that we have a complete returns table from proactive sync,
    // update any unattributed Return transactions using the returns table lookup.
    // This is O(1) per transaction (database lookup), not O(clients) API calls.

    const { data: unattributedTxs } = await supabase
      .from('transactions')
      .select('transaction_id, reference_id')
      .eq('reference_type', 'Return')
      .is('client_id', null)

    if (unattributedTxs && unattributedTxs.length > 0) {
      console.log(`[ReturnsSync] Found ${unattributedTxs.length} unattributed return transactions, checking returns table...`)

      // Get return IDs
      const returnIds = unattributedTxs
        .map((tx: { reference_id: string }) => Number(tx.reference_id))
        .filter((id: number) => id > 0)

      // Look up client_id from returns table
      const { data: returns } = await supabase
        .from('returns')
        .select('shipbob_return_id, client_id, merchant_id')
        .in('shipbob_return_id', returnIds.slice(0, 1000))

      // Build lookup
      const returnClientMap: Record<number, { client_id: string; merchant_id: string | null }> = {}
      for (const ret of returns || []) {
        if (ret.client_id) {
          returnClientMap[ret.shipbob_return_id] = {
            client_id: ret.client_id,
            merchant_id: ret.merchant_id,
          }
        }
      }

      // Update transactions
      let attributed = 0
      for (const tx of unattributedTxs) {
        const returnId = Number(tx.reference_id)
        const returnInfo = returnClientMap[returnId]

        if (returnInfo) {
          const { error } = await supabase
            .from('transactions')
            .update({ client_id: returnInfo.client_id, merchant_id: returnInfo.merchant_id })
            .eq('transaction_id', tx.transaction_id)

          if (!error) {
            attributed++
          }
        }
      }

      if (attributed > 0) {
        console.log(`[ReturnsSync] Attributed ${attributed} return transactions from returns table`)
      }

      const stillUnattributed = unattributedTxs.length - attributed
      if (stillUnattributed > 0) {
        console.log(`[ReturnsSync] ${stillUnattributed} return transactions still unattributed (returns not in table yet, will be caught by invoice-based attribution)`)
      }
    }

    result.success = result.errors.length === 0
    result.duration = Date.now() - startTime
    return result
  } catch (e) {
    result.errors.push(`Fatal error: ${e instanceof Error ? e.message : 'Unknown'}`)
    result.duration = Date.now() - startTime
    return result
  }
}

/**
 * Receiving Orders (WRO) Sync Result
 */
export interface ReceivingSyncResult {
  success: boolean
  wrosFetched: number
  wrosUpserted: number
  errors: string[]
  duration: number
}

/**
 * ShipBob WRO API response types (2025-07)
 */
interface ShipBobWRO {
  id: number
  purchase_order_number?: string
  status?: string
  package_type?: string
  box_packaging_type?: string
  box_labels_uri?: string
  expected_arrival_date?: string
  insert_date?: string
  last_updated_date?: string
  fulfillment_center?: {
    id?: number
    name?: string
    timezone?: string
    address?: {
      address1?: string
      city?: string
      state?: string
      country?: string
      zip_code?: string
    }
  }
  status_history?: Array<{
    id: number
    status: string
    timestamp: string
  }>
  inventory_quantities?: Array<{
    inventory_id?: number
    name?: string
    expected_quantity?: number
    received_quantity?: number
    stowed_quantity?: number
  }>
}

/**
 * Sync Warehouse Receiving Orders (WROs) for all clients
 *
 * Uses the 2025-07 /receiving endpoint with InsertStartDate/InsertEndDate
 * for incremental sync. Captures status_history timeline for receiving analytics.
 *
 * @param minutesBack - How far back to look for new/updated WROs (default 60)
 */
export async function syncReceivingOrders(minutesBack: number = 60): Promise<ReceivingSyncResult> {
  const startTime = Date.now()
  const supabase = createAdminClient()
  const result: ReceivingSyncResult = {
    success: false,
    wrosFetched: 0,
    wrosUpserted: 0,
    errors: [],
    duration: 0,
  }

  try {
    // Get all clients with their tokens
    const { data: clients } = await supabase
      .from('clients')
      .select('id, company_name, merchant_id, client_api_credentials(api_token, provider)')
      .eq('is_active', true)

    if (!clients || clients.length === 0) {
      result.errors.push('No active clients found')
      result.duration = Date.now() - startTime
      return result
    }

    // Calculate date range - use LastUpdateStartDate to catch status changes, not just new WROs
    const endDate = new Date()
    const startDate = new Date()
    startDate.setMinutes(startDate.getMinutes() - minutesBack)

    console.log(`[ReceivingSync] Fetching updated WROs from ${startDate.toISOString()} to ${endDate.toISOString()}`)

    // Process each client
    for (const client of clients) {
      const creds = client.client_api_credentials as Array<{ api_token: string; provider: string }> | null
      const token = creds?.find(c => c.provider === 'shipbob')?.api_token

      if (!token) {
        console.log(`[ReceivingSync] Skipping ${client.company_name}: no ShipBob token`)
        continue
      }

      try {
        // Fetch WROs from API with LastUpdate date filter to catch status changes
        const params = new URLSearchParams({
          LastUpdateStartDate: startDate.toISOString(),
          LastUpdateEndDate: endDate.toISOString(),
          Limit: '100',
        })

        const res = await fetch(`${SHIPBOB_API_BASE}/receiving?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!res.ok) {
          if (res.status === 429) {
            console.log(`[ReceivingSync] Rate limited for ${client.company_name}`)
            result.errors.push(`${client.company_name}: Rate limited`)
            continue
          }
          result.errors.push(`${client.company_name}: API error ${res.status}`)
          continue
        }

        const wros: ShipBobWRO[] = await res.json()
        result.wrosFetched += wros.length

        if (wros.length === 0) continue

        console.log(`[ReceivingSync] ${client.company_name}: found ${wros.length} WROs`)

        // Map to database records
        const now = new Date().toISOString()
        const records = wros.map(wro => ({
          client_id: client.id,
          merchant_id: client.merchant_id || null,
          shipbob_receiving_id: wro.id,
          purchase_order_number: wro.purchase_order_number || null,
          status: wro.status || null,
          package_type: wro.package_type || null,
          box_packaging_type: wro.box_packaging_type || null,
          box_labels_uri: wro.box_labels_uri || null,
          expected_arrival_date: wro.expected_arrival_date || null,
          insert_date: wro.insert_date || null,
          last_updated_date: wro.last_updated_date || null,
          fc_id: wro.fulfillment_center?.id || null,
          fc_name: wro.fulfillment_center?.name || null,
          fc_timezone: wro.fulfillment_center?.timezone || null,
          fc_address: wro.fulfillment_center?.address?.address1 || null,
          fc_city: wro.fulfillment_center?.address?.city || null,
          fc_state: wro.fulfillment_center?.address?.state || null,
          fc_country: wro.fulfillment_center?.address?.country || null,
          fc_zip: wro.fulfillment_center?.address?.zip_code || null,
          status_history: wro.status_history || null,
          inventory_quantities: wro.inventory_quantities || null,
          synced_at: now,
        }))

        // Upsert records
        const { error } = await supabase
          .from('receiving_orders')
          .upsert(records, { onConflict: 'shipbob_receiving_id' })

        if (error) {
          result.errors.push(`${client.company_name}: Upsert error - ${error.message}`)
        } else {
          result.wrosUpserted += records.length
        }
      } catch (e) {
        result.errors.push(`${client.company_name}: ${e instanceof Error ? e.message : 'Unknown error'}`)
      }

      // Small delay between clients to avoid rate limits
      await new Promise(r => setTimeout(r, 100))
    }

    console.log(`[ReceivingSync] Complete: ${result.wrosUpserted} WROs upserted, ${result.errors.length} errors`)
    result.success = result.errors.length === 0
    result.duration = Date.now() - startTime
    return result
  } catch (e) {
    result.errors.push(`Fatal error: ${e instanceof Error ? e.message : 'Unknown'}`)
    result.duration = Date.now() - startTime
    return result
  }
}

// ============================================================================
// Fee Types Sync
// ============================================================================

export interface FeeTypesSyncResult {
  success: boolean
  feeTypesFetched: number
  feeTypesUpserted: number
  errors: string[]
}

/**
 * Categorize fee types into the 6 billing categories matching UI tabs:
 * - Shipments: Shipping, pick/pack, fulfillment, surcharges
 * - Additional Services: B2B, VAS, ITO, WMS, kitting, admin, taxes
 * - Returns: Return processing fees
 * - Receiving: WRO, inbound, freight
 * - Storage: Storage, warehousing
 * - Credits: Credits, refunds
 */
function categorizeFeeType(feeType: string): string {
  const ft = feeType.toLowerCase()

  // Credits - credits, refunds
  if (ft.includes('credit') || ft.includes('refund')) return 'Credits'

  // Returns - return processing
  if (ft.includes('return')) return 'Returns'

  // Storage - storage, warehousing
  if (ft.includes('storage') || ft.includes('warehousing')) return 'Storage'

  // Receiving - WRO, inbound, freight, receiving
  if (ft.includes('wro') || ft.includes('receiving') || ft.includes('freight') || ft.includes('inbound')) return 'Receiving'

  // Shipments - shipping, pick/pack, fulfillment core, surcharges, carrier fees
  if (
    ft === 'shipping' ||
    ft.includes('shipping') ||
    ft.includes('pick') ||
    ft.includes('pack') ||
    ft.includes('surcharge') ||
    ft.includes('correction') ||
    ft.includes('residential') ||
    ft.includes('carrier') ||
    ft.includes('delivery') ||
    ft.includes('handling')
  ) return 'Shipments'

  // Additional Services - everything else (B2B, VAS, ITO, WMS, admin, taxes, kitting, etc.)
  return 'Additional Services'
}

/**
 * Sync all fee types from ShipBob /transaction-fees endpoint
 * Uses parent token (billing API access)
 *
 * IMPORTANT: Only INSERTS new fee types. Never updates existing records.
 * This preserves manually-set categories in fee_type_categories table.
 */
export async function syncFeeTypes(): Promise<FeeTypesSyncResult> {
  const result: FeeTypesSyncResult = {
    success: false,
    feeTypesFetched: 0,
    feeTypesUpserted: 0,
    errors: [],
  }

  const supabase = createAdminClient()
  const token = process.env.SHIPBOB_API_TOKEN

  if (!token) {
    result.errors.push('SHIPBOB_API_TOKEN not configured')
    return result
  }

  try {
    console.log('[FeeTypesSync] Fetching fee types from ShipBob...')

    const res = await fetch(`${SHIPBOB_API_BASE}/transaction-fees`, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!res.ok) {
      result.errors.push(`API error: ${res.status} ${res.statusText}`)
      return result
    }

    const data = await res.json()
    const feeList: string[] = data.fee_list || []
    result.feeTypesFetched = feeList.length

    console.log(`[FeeTypesSync] Found ${feeList.length} fee types from API`)

    if (feeList.length === 0) {
      result.success = true
      return result
    }

    // Get existing fee types from database
    const { data: existing } = await supabase
      .from('fee_type_categories')
      .select('fee_type')

    const existingSet = new Set((existing || []).map((r: { fee_type: string }) => r.fee_type))

    // Filter to only NEW fee types (not in database)
    const newFeeTypes = feeList.filter(ft => !existingSet.has(ft))

    if (newFeeTypes.length === 0) {
      console.log('[FeeTypesSync] No new fee types to add')
      result.success = true
      return result
    }

    console.log(`[FeeTypesSync] Found ${newFeeTypes.length} NEW fee types to add`)

    // Build records for new fee types only
    const now = new Date().toISOString()
    const records = newFeeTypes.map(feeType => ({
      fee_type: feeType,
      category: categorizeFeeType(feeType), // Auto-categorize new ones
      display_name: feeType,
      description: null,
      is_active: true,
      source: 'shipbob',
      synced_at: now,
    }))

    // INSERT only (not upsert) - never overwrite existing
    const { error } = await supabase
      .from('fee_type_categories')
      .insert(records)

    if (error) {
      result.errors.push(`Insert error: ${error.message}`)
      return result
    }

    result.feeTypesUpserted = records.length
    result.success = true
    console.log(`[FeeTypesSync] Inserted ${records.length} new fee types`)

    return result
  } catch (e) {
    result.errors.push(`Fatal error: ${e instanceof Error ? e.message : 'Unknown'}`)
    return result
  }
}

// ============================================================================
// Products Sync
// ============================================================================

export interface ProductsSyncResult {
  success: boolean
  duration: number
  clientsProcessed: number
  productsUpserted: number
  storageTransactionsAttributed: number
  errors: string[]
  clients: Array<{
    clientName: string
    productsFound: number
    productsUpserted: number
    errors: string[]
  }>
}

/**
 * Sync all products from ShipBob for all clients
 * Uses child tokens (per-client API access)
 *
 * This sync is important for:
 * 1. Attribution: Map inventory_id → client_id for storage transactions
 * 2. XLS Export: Lookup SKU from inventory_id for billing sheets
 *
 * After syncing products, also re-attributes any unattributed storage transactions.
 */
export async function syncProducts(): Promise<ProductsSyncResult> {
  const startTime = Date.now()
  const result: ProductsSyncResult = {
    success: false,
    duration: 0,
    clientsProcessed: 0,
    productsUpserted: 0,
    storageTransactionsAttributed: 0,
    errors: [],
    clients: [],
  }

  console.log('[ProductsSync] Starting products sync...')

  try {
    const supabase = createAdminClient()

    // Get all active clients with their tokens
    const { data: clients, error: clientsError } = await supabase
      .from('clients')
      .select('id, company_name, merchant_id, client_api_credentials(api_token, provider)')
      .eq('is_active', true)

    if (clientsError) {
      result.errors.push(`Failed to fetch clients: ${clientsError.message}`)
      result.duration = Date.now() - startTime
      return result
    }

    if (!clients || clients.length === 0) {
      console.log('[ProductsSync] No active clients found')
      result.success = true
      result.duration = Date.now() - startTime
      return result
    }

    console.log(`[ProductsSync] Processing ${clients.length} clients...`)

    // Process each client
    for (const client of clients) {
      const creds = client.client_api_credentials as Array<{ api_token: string; provider: string }> | null
      const token = creds?.find(c => c.provider === 'shipbob')?.api_token

      if (!token) {
        console.log(`[ProductsSync] Skipping ${client.company_name}: no ShipBob token`)
        continue
      }

      const clientResult = {
        clientName: client.company_name,
        productsFound: 0,
        productsUpserted: 0,
        errors: [] as string[],
      }

      try {
        // Create client with this token
        const shipbob = new ShipBobClient(token)

        // Fetch all products for this client
        const products = await shipbob.products.getAllProducts()
        clientResult.productsFound = products.length

        if (products.length === 0) {
          console.log(`[ProductsSync] ${client.company_name}: No products found`)
          result.clients.push(clientResult)
          result.clientsProcessed++
          continue
        }

        console.log(`[ProductsSync] ${client.company_name}: Found ${products.length} products`)

        // Build upsert records
        const now = new Date().toISOString()
        const records = products.map((p: ShipBobProduct) => ({
          client_id: client.id,
          merchant_id: client.merchant_id || null,
          shipbob_product_id: p.id,
          name: p.name || '',
          type: p.type || null,
          taxonomy: p.taxonomy?.name || null,
          variants: p.variants || null,
          created_on: p.created_date || null,
          updated_on: null, // API doesn't always have this at product level
          synced_at: now,
        }))

        // Upsert in batches of 100
        // Note: unique constraint is on (client_id, shipbob_product_id)
        const batchSize = 100
        for (let i = 0; i < records.length; i += batchSize) {
          const batch = records.slice(i, i + batchSize)
          const { error: upsertError } = await supabase
            .from('products')
            .upsert(batch, { onConflict: 'client_id,shipbob_product_id' })

          if (upsertError) {
            clientResult.errors.push(`Upsert batch ${i / batchSize + 1}: ${upsertError.message}`)
          } else {
            clientResult.productsUpserted += batch.length
          }
        }

        result.productsUpserted += clientResult.productsUpserted
        console.log(`[ProductsSync] ${client.company_name}: Upserted ${clientResult.productsUpserted} products`)

      } catch (e) {
        clientResult.errors.push(e instanceof Error ? e.message : 'Unknown error')
        result.errors.push(`${client.company_name}: ${e instanceof Error ? e.message : 'Unknown'}`)
      }

      result.clients.push(clientResult)
      result.clientsProcessed++

      // Small delay between clients to avoid rate limits
      await new Promise(r => setTimeout(r, 100))
    }

    // After syncing products, re-attribute unattributed storage transactions
    const attributionResult = await attributeStorageTransactions()
    result.storageTransactionsAttributed = attributionResult.attributed

    if (attributionResult.errors.length > 0) {
      result.errors.push(...attributionResult.errors)
    }

    result.success = result.errors.length === 0
    result.duration = Date.now() - startTime
    console.log(`[ProductsSync] Complete: ${result.productsUpserted} products, ${result.storageTransactionsAttributed} storage txns attributed`)

    return result
  } catch (e) {
    result.errors.push(`Fatal error: ${e instanceof Error ? e.message : 'Unknown'}`)
    result.duration = Date.now() - startTime
    return result
  }
}

/**
 * Re-attribute storage transactions that don't have a client_id
 * Uses the products table to map inventory_id → client_id
 */
async function attributeStorageTransactions(): Promise<{ attributed: number; errors: string[] }> {
  const result = { attributed: 0, errors: [] as string[] }

  try {
    const supabase = createAdminClient()

    // Build inventory_id → client_id lookup from products.variants
    console.log('[ProductsSync] Building inventory lookup from products...')

    const { data: products, error: productsError } = await supabase
      .from('products')
      .select('client_id, variants')
      .not('variants', 'is', null)

    if (productsError) {
      result.errors.push(`Failed to fetch products: ${productsError.message}`)
      return result
    }

    // Build lookup map
    const inventoryLookup: Record<string, string> = {}
    for (const p of products || []) {
      if (p.client_id && Array.isArray(p.variants)) {
        for (const variant of p.variants) {
          const invId = variant?.inventory?.inventory_id
          if (invId) {
            inventoryLookup[String(invId)] = p.client_id
          }
        }
      }
    }

    const inventoryCount = Object.keys(inventoryLookup).length
    console.log(`[ProductsSync] Built lookup with ${inventoryCount} inventory IDs`)

    if (inventoryCount === 0) {
      console.log('[ProductsSync] No inventory mappings found, skipping attribution')
      return result
    }

    // Find unattributed storage transactions (FC reference_type with no client_id)
    const { data: unattributed, error: fetchError } = await supabase
      .from('transactions')
      .select('transaction_id, reference_id, additional_details')
      .eq('reference_type', 'FC')
      .is('client_id', null)
      .limit(1000)

    if (fetchError) {
      result.errors.push(`Failed to fetch unattributed: ${fetchError.message}`)
      return result
    }

    if (!unattributed || unattributed.length === 0) {
      console.log('[ProductsSync] No unattributed storage transactions found')
      return result
    }

    console.log(`[ProductsSync] Found ${unattributed.length} unattributed storage transactions`)

    // Attribute each transaction
    const updates: Array<{ transaction_id: string; client_id: string }> = []
    for (const tx of unattributed) {
      // Extract inventory_id from reference_id (format: FC-InventoryId-LocationType) or additional_details
      let inventoryId: string | null = null

      if (tx.reference_id) {
        const parts = tx.reference_id.split('-')
        if (parts.length >= 2) {
          inventoryId = parts[1]
        }
      }

      // Fallback to additional_details.InventoryId
      if (!inventoryId && tx.additional_details?.InventoryId) {
        inventoryId = String(tx.additional_details.InventoryId)
      }

      if (inventoryId && inventoryLookup[inventoryId]) {
        updates.push({
          transaction_id: tx.transaction_id,
          client_id: inventoryLookup[inventoryId],
        })
      }
    }

    console.log(`[ProductsSync] Matched ${updates.length} transactions to clients`)

    // Update in batches
    const batchSize = 100
    for (let i = 0; i < updates.length; i += batchSize) {
      const batch = updates.slice(i, i + batchSize)

      for (const update of batch) {
        const { error: updateError } = await supabase
          .from('transactions')
          .update({ client_id: update.client_id })
          .eq('transaction_id', update.transaction_id)

        if (updateError) {
          result.errors.push(`Update ${update.transaction_id}: ${updateError.message}`)
        } else {
          result.attributed++
        }
      }
    }

    console.log(`[ProductsSync] Attributed ${result.attributed} storage transactions`)
    return result
  } catch (e) {
    result.errors.push(`Attribution error: ${e instanceof Error ? e.message : 'Unknown'}`)
    return result
  }
}
