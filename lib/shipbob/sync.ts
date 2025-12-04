/**
 * ShipBob Data Sync Service - Complete Sync
 *
 * Mirrors the logic from scripts/sync-orders-fast.js for production use.
 * Syncs: orders, shipments, order_items, shipment_items, shipment_cartons, transactions
 *
 * Uses the 2025-07 ShipBob API.
 */

import { createAdminClient } from '@/lib/supabase/admin'

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'
const BATCH_SIZE = 500

export interface SyncResult {
  success: boolean
  clientId: string
  clientName: string
  ordersFound: number
  ordersUpserted: number
  shipmentsUpserted: number
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
    } else {
      startDate.setDate(startDate.getDate() - (opts.daysBack || 7))
    }

    // Build FC lookup
    const { data: fcList } = await supabase.from('fulfillment_centers').select('fc_id, name, country')
    const fcLookup: Record<string, { fc_id: number; country: string }> = {}
    for (const fc of fcList || []) {
      fcLookup[fc.name] = { fc_id: fc.fc_id, country: fc.country }
      const shortName = fc.name.split(' ')[0]
      if (!fcLookup[shortName]) fcLookup[shortName] = { fc_id: fc.fc_id, country: fc.country }
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
      const params = new URLSearchParams({
        StartDate: startDate.toISOString(),
        EndDate: endDate.toISOString(),
        Limit: '250',
        Page: page.toString(),
      })

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
      carrier_type: order.carrier?.type || null,
      payment_term: order.carrier?.payment_term || null,
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
        const fcInfo = fcName ? fcLookup[fcName] || fcLookup[fcName?.split(' ')[0]] : null
        const originCountry = fcInfo?.country || 'US'
        const destCountry = order.recipient?.address?.country || 'US'

        let dimWeight: number | null = null
        let billableWeight = actualWeight
        const dimDivisor = getDimDivisor(originCountry, destCountry, actualWeight)
        if (dimDivisor && length > 0 && width > 0 && height > 0) {
          dimWeight = Math.round(((length * width * height) / dimDivisor) * 16)
          billableWeight = Math.max(actualWeight, dimWeight)
        }

        const shippedTimestamp = shipment.actual_fulfillment_date || null
        const deliveredTimestamp = shipment.delivery_date || null
        let transitTimeDays: number | null = null
        if (shippedTimestamp && deliveredTimestamp) {
          const diffMs = new Date(deliveredTimestamp).getTime() - new Date(shippedTimestamp).getTime()
          transitTimeDays = Math.round((diffMs / (1000 * 60 * 60 * 24)) * 10) / 10
        }

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
          label_generation_date: shipment.created_date || null,
          shipped_date: shippedTimestamp,
          delivered_date: deliveredTimestamp,
          transit_time_days: transitTimeDays,
          carrier: shipment.tracking?.carrier || null,
          carrier_service: shipment.ship_option || null,
          ship_option_id: getShipOptionId(shipment.ship_option || null),
          zone_used: shipment.zone?.id || null,
          fc_name: fcName,
          fc_id: fcInfo?.fc_id || null,
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
          last_tracking_update_at: shipment.tracking?.last_update_at || null,
          package_material_type: shipment.package_material_type || null,
          require_signature: shipment.require_signature || false,
          gift_message: shipment.gift_message || null,
          invoice_amount: shipment.invoice?.amount || null,
          invoice_currency_code: shipment.invoice?.currency_code || null,
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
          name: product.name || null,
          quantity: product.quantity || null,
          unit_price: product.unit_price || null,
          gtin: product.gtin || null,
          upc: product.upc || null,
          external_line_id: product.external_line_id || null,
          quantity_unit_of_measure_code: product.quantity_unit_of_measure_code || null,
        })
      }
    }

    const orderItemResult = await batchUpsert(supabase, 'order_items', orderItemRecords, 'order_id,shipbob_product_id')
    result.orderItemsUpserted = orderItemResult.success
    result.errors.push(...orderItemResult.errors)

    // STEP 5: Delete + Insert Shipment Items
    await batchDelete(supabase, 'shipment_items', 'shipment_id', shipmentIds)

    const shipmentItemRecords: Record<string, unknown>[] = []
    for (const order of apiOrders) {
      if (!order.shipments) continue

      for (const shipment of order.shipments) {
        if (!shipment.products || shipment.products.length === 0) continue

        for (const product of shipment.products) {
          const inventories = product.inventory || [{}]

          for (const inv of inventories) {
            shipmentItemRecords.push({
              client_id: clientId,
              merchant_id: merchantId,
              shipment_id: shipment.id.toString(),
              shipbob_product_id: product.id || null,
              sku: product.sku || null,
              reference_id: product.reference_id || null,
              name: product.name || null,
              inventory_id: inv.id || null,
              lot: inv.lot || null,
              expiration_date: inv.expiration_date || null,
              quantity: inv.quantity || product.quantity || null,
              quantity_committed: inv.quantity_committed || null,
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

    // STEP 7: Fetch and Upsert Transactions
    if (parentToken && shipmentIds.length > 0) {
      interface ShipBobTransaction {
        transaction_id: string
        reference_id: string
        reference_type: string
        transaction_fee: string
        amount: number
        charge_date: string
        invoiced_status: boolean
        invoice_id?: number
        fulfillment_center?: string
        additional_details?: Record<string, unknown>
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
        transaction_fee: tx.transaction_fee,
        amount: tx.amount,
        charge_date: tx.charge_date,
        invoiced_status: tx.invoiced_status || false,
        invoice_id: tx.invoice_id || null,
        fulfillment_center: tx.fulfillment_center || null,
        additional_details: tx.additional_details || null,
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
