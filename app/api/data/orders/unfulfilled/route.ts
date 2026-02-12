import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/data/orders/unfulfilled
 * Returns shipments that have NOT yet been assigned fees (shipped_date IS NULL)
 * This includes: Processing (Awaiting Pick), Exception (Out of Stock), etc.
 * Excludes: Cancelled shipments
 */
export async function GET(request: NextRequest) {
  // CRITICAL SECURITY: Verify user has access to requested client
  const searchParams = request.nextUrl.searchParams
  let clientId: string | null
  try {
    const access = await verifyClientAccess(searchParams.get('clientId'))
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const statusFilter = searchParams.get('status') // comma-separated list of statuses
  const searchQuery = searchParams.get('search')?.trim() || '' // search across multiple fields

  // Sort params (defaults: created_at desc)
  const sortField = searchParams.get('sortField') || 'created_at'
  const sortDirection = searchParams.get('sortDirection') || 'desc'
  const sortAscending = sortDirection === 'asc'

  // Export mode - includes extra fields for invoice-format export
  const isExport = searchParams.get('export') === 'true'

  // Date range filtering (ISO date strings, e.g., '2025-01-01')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  try {
    // Check if we need date filtering (requires JOIN with orders)
    const hasDateFilter = startDate || endDate

    // Build select fields - use !inner JOIN when date filter is present
    const selectFields = hasDateFilter
      ? `
        id,
        shipment_id,
        shipbob_order_id,
        order_id,
        status,
        estimated_fulfillment_date,
        estimated_fulfillment_date_status,
        status_details,
        event_labeled,
        event_picked,
        event_packed,
        created_at,
        recipient_name,
        carrier_service,
        fc_name,
        client_id,
        orders!inner(
          id,
          store_order_id,
          customer_name,
          order_import_date,
          order_type,
          channel_name,
          application_name,
          total_shipments,
          country,
          shipping_method
        )
      `
      : `
        id,
        shipment_id,
        shipbob_order_id,
        order_id,
        status,
        estimated_fulfillment_date,
        estimated_fulfillment_date_status,
        status_details,
        event_labeled,
        event_picked,
        event_packed,
        created_at,
        recipient_name,
        carrier_service,
        fc_name,
        client_id
      `

    // Query shipments that haven't been shipped yet (no label generated)
    // These are shipments where event_labeled IS NULL and status is not Cancelled
    let query = supabase
      .from('shipments')
      .select(selectFields, { count: 'exact' })
      .is('event_labeled', null) // Not shipped yet
      .neq('status', 'Cancelled') // Exclude cancelled
      .is('deleted_at', null) // Exclude soft-deleted records

    // Apply date range filter at database level (on joined orders table)
    if (startDate) {
      query = query.gte('orders.order_import_date', startDate)
    }
    if (endDate) {
      query = query.lte('orders.order_import_date', `${endDate}T23:59:59.999Z`)
    }

    // Only filter by client_id if not viewing all brands
    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    // Status filtering is done client-side after deriving statuses
    // This ensures accurate filtering since derived status uses event timestamps
    // which can't be easily expressed in Supabase .or() queries
    // (e.g., "Picked" = event_picked IS NOT NULL AND event_packed IS NULL)
    const statusFilterValues = statusFilter
      ? statusFilter.split(',').map(s => s.trim().toLowerCase())
      : null

    // Apply search filter - hybrid approach:
    // - Full-text search (GIN indexed) for name-like searches
    // - ILIKE for ID/tracking searches (substring matching)
    // - Pre-resolve store_order_id from orders table (can't filter joined columns in .or())
    let needsClientSideSearch = false
    let useFullTextSearch = false
    if (searchQuery) {
      const searchTerm = searchQuery.trim()
      // Detect if search looks like an ID (contains digits or is alphanumeric without spaces)
      const looksLikeId = /\d/.test(searchTerm) || (/^[a-zA-Z0-9]+$/.test(searchTerm) && searchTerm.length > 3)

      if (looksLikeId) {
        // Pre-resolve store_order_id → shipbob_order_id from orders table
        // This lets us search by Shopify/store order numbers even though they're on a joined table
        let storeOrderIds: string[] = []
        const storeOrderQuery = supabase
          .from('orders')
          .select('shipbob_order_id')
          .ilike('store_order_id', `%${searchTerm}%`)
          .limit(100)
        if (clientId) {
          storeOrderQuery.eq('client_id', clientId)
        }
        const { data: storeOrderMatches } = await storeOrderQuery
        if (storeOrderMatches && storeOrderMatches.length > 0) {
          storeOrderIds = storeOrderMatches.map((o: any) => o.shipbob_order_id).filter(Boolean)
        }

        // Use ILIKE for ID searches - supports partial matching
        const searchPattern = `%${searchTerm}%`
        let orFilter = `recipient_name.ilike.${searchPattern},shipbob_order_id.ilike.${searchPattern},shipment_id.ilike.${searchPattern}`

        // Add store_order_id matches via their shipbob_order_ids
        if (storeOrderIds.length > 0) {
          orFilter += `,shipbob_order_id.in.(${storeOrderIds.join(',')})`
        }

        query = query.or(orFilter)
      } else {
        // Use full-text search for name searches (GIN indexed, very fast)
        query = query.textSearch('search_vector', searchTerm, {
          type: 'websearch',
          config: 'english'
        })
        useFullTextSearch = true
      }
    }

    // Order by creation date (most recent first)
    // When status filter is applied, fetch ALL records for client-side filtering
    // (because derived status uses event timestamps that can't be queried directly)
    // Without status filter, use pagination for efficiency
    let shipmentsData: any[] | null = null
    let shipmentsError: any = null
    let count: number | null = null

    if (statusFilterValues) {
      // Fetch all records for client-side status filtering (up to 1000 limit)
      // Note: Unfulfilled shipments are typically <1000, so this is safe
      const result = await query
        .order(sortField, { ascending: sortAscending })
        .limit(1000)
      shipmentsData = result.data
      shipmentsError = result.error
      count = result.count
    } else {
      // Normal pagination
      const result = await query
        .order(sortField, { ascending: sortAscending })
        .range(offset, offset + limit - 1)
      shipmentsData = result.data
      shipmentsError = result.error
      count = result.count
    }

    // If full-text search failed (column doesn't exist), retry with client-side filtering
    if (shipmentsError && useFullTextSearch && shipmentsError.message.includes('search_vector')) {
      console.log('Full-text search column not found, will filter client-side')
      needsClientSideSearch = true

      // Rebuild query without textSearch
      let fallbackQuery = supabase
        .from('shipments')
        .select(selectFields, { count: 'exact' })
        .is('event_labeled', null)
        .neq('status', 'Cancelled')
        .is('deleted_at', null)

      if (startDate) fallbackQuery = fallbackQuery.gte('orders.order_import_date', startDate)
      if (endDate) fallbackQuery = fallbackQuery.lte('orders.order_import_date', `${endDate}T23:59:59.999Z`)
      if (clientId) fallbackQuery = fallbackQuery.eq('client_id', clientId)

      if (statusFilterValues) {
        const fallbackResult = await fallbackQuery
          .order(sortField, { ascending: sortAscending })
          .limit(1000)
        shipmentsData = fallbackResult.data
        shipmentsError = fallbackResult.error
        count = fallbackResult.count
      } else {
        const fallbackResult = await fallbackQuery
          .order(sortField, { ascending: sortAscending })
          .range(offset, offset + limit - 1)
        shipmentsData = fallbackResult.data
        shipmentsError = fallbackResult.error
        count = fallbackResult.count
      }
    }

    if (shipmentsError) {
      console.error('Error fetching unfulfilled shipments:', shipmentsError)
      return NextResponse.json({ error: shipmentsError.message }, { status: 500 })
    }

    // Get order details for these shipments (for customer name, store order ID)
    // Skip if we already have orders from the JOIN (when hasDateFilter is true)
    let ordersMap: Record<string, any> = {}

    if (!hasDateFilter) {
      // Fetch orders separately when not using JOIN
      const orderIds = [...new Set((shipmentsData || []).map((s: any) => s.order_id).filter(Boolean))]

      if (orderIds.length > 0) {
        const { data: ordersData } = await supabase
          .from('orders')
          .select(`
            id,
            store_order_id,
            customer_name,
            order_import_date,
            order_type,
            channel_name,
            application_name,
            total_shipments,
            country,
            shipping_method
          `)
          .in('id', orderIds)

        if (ordersData) {
          ordersMap = ordersData.reduce((acc: Record<string, any>, order: any) => {
            acc[order.id] = order
            return acc
          }, {})
        }
      }
    }

    // Get item counts for each shipment
    const shipmentIds = (shipmentsData || []).map((s: any) => s.shipment_id)
    let itemCounts: Record<string, number> = {}

    if (shipmentIds.length > 0) {
      const { data: itemData } = await supabase
        .from('shipment_items')
        .select('shipment_id')
        .in('shipment_id', shipmentIds)

      if (itemData) {
        itemCounts = itemData.reduce((acc: Record<string, number>, item: any) => {
          acc[item.shipment_id] = (acc[item.shipment_id] || 0) + 1
          return acc
        }, {})
      }
    }

    // Export: look up client merchant_id and company_name + products sold
    let clientInfoMap: Record<string, { merchantId: string; merchantName: string }> = {}
    let productsSoldMap: Record<string, string> = {}
    if (isExport) {
      const { data: clients } = await supabase.from('clients').select('id, merchant_id, company_name')
      if (clients) {
        for (const c of clients as any[]) {
          clientInfoMap[c.id] = { merchantId: c.merchant_id?.toString() || '', merchantName: c.company_name || '' }
        }
      }
      // Also fetch item names for products_sold
      if (shipmentIds.length > 0) {
        const { data: itemsData } = await supabase
          .from('shipment_items')
          .select('shipment_id, name, quantity')
          .in('shipment_id', shipmentIds)
        if (itemsData) {
          const itemsByShipment: Record<string, { name: string; qty: number }[]> = {}
          for (const item of itemsData as any[]) {
            if (!item.shipment_id) continue
            if (!itemsByShipment[item.shipment_id]) itemsByShipment[item.shipment_id] = []
            itemsByShipment[item.shipment_id].push({ name: item.name || '', qty: item.quantity || 1 })
          }
          for (const [sid, items] of Object.entries(itemsByShipment)) {
            productsSoldMap[sid] = items.map(i => `${i.name}(${i.qty})`).join(' ; ')
          }
        }
      }
    }

    // Map to response format with granular statuses
    const shipments = (shipmentsData || []).map((shipment: any) => {
      // Get order data from JOIN (when hasDateFilter) or from separate fetch
      const order = hasDateFilter ? (shipment.orders || {}) : (ordersMap[shipment.order_id] || {})
      const derivedStatus = deriveGranularStatus(shipment)

      // Compute age in days (from order date to now)
      const orderDateStr = order.order_import_date || shipment.created_at
      let age: number | null = null
      if (orderDateStr) {
        const orderDate = new Date(orderDateStr)
        const now = new Date()
        const msElapsed = now.getTime() - orderDate.getTime()
        age = parseFloat((msElapsed / (1000 * 60 * 60 * 24)).toFixed(1))
      }

      return {
        id: shipment.id,
        orderId: shipment.shipbob_order_id || '',
        shipmentId: shipment.shipment_id?.toString() || '',
        storeOrderId: order.store_order_id || '',
        customerName: shipment.recipient_name || order.customer_name || 'Unknown',
        status: derivedStatus,
        rawStatus: shipment.status, // Raw DB status for category-based filtering
        orderDate: orderDateStr,
        slaDate: shipment.estimated_fulfillment_date,
        itemCount: itemCounts[shipment.shipment_id] || 1,
        orderType: order.order_type || 'DTC',
        channelName: order.application_name || order.channel_name || '',
        carrierService: shipment.carrier_service || '',
        fcName: shipment.fc_name || '',
        // Optional columns
        totalShipments: order.total_shipments || 1,
        destCountry: order.country || '',
        shipOption: order.shipping_method || '',
        // Computed field for export
        age: age,
        // Client identification (for admin badge)
        clientId: shipment.client_id || null,
        // Export-only fields (invoice format - most blank for unfulfilled)
        ...(isExport ? {
          merchantId: clientInfoMap[shipment.client_id]?.merchantId || '',
          merchantName: clientInfoMap[shipment.client_id]?.merchantName || '',
          transactionDate: '',
          transactionType: '',
          trackingId: '',
          baseCharge: null,
          surchargeAmount: null,
          charge: null,
          insuranceCharge: null,
          productsSold: productsSoldMap[shipment.shipment_id] || '',
          qty: itemCounts[shipment.shipment_id] || 1,
          shipOptionId: '',
          carrier: '',
          carrier_service: '',
          zone: '',
          actualWeightOz: '',
          dimWeightOz: '',
          billableWeightOz: '',
          lengthIn: '',
          widthIn: '',
          heightIn: '',
          zipCode: '',
          city: '',
          state: '',
          labelCreated: '',
          deliveredDate: '',
          transitTimeDays: '',
        } : {}),
      }
    })

    // Apply status filter client-side (after deriving statuses)
    // This ensures accurate filtering since derived status uses event timestamps
    // which can't be easily expressed in Supabase .or() queries
    //
    // "On Hold" and "Exception" are parent categories — the derived status may be
    // more specific (e.g., "Manual Hold", "Out of Stock", "Address Issue").
    // Map filter values to their raw DB status so we catch all sub-statuses.
    const CATEGORY_TO_RAW: Record<string, string> = {
      'on hold': 'OnHold',
      'exception': 'Exception',
    }

    let filteredShipments = shipments
    if (statusFilterValues && statusFilterValues.length > 0) {
      filteredShipments = filteredShipments.filter((s: any) => {
        const derivedStatusLower = s.status.toLowerCase()
        return statusFilterValues.some(filterStatus => {
          // Handle "awaiting pick (late)" matching "awaiting pick" filter
          if (filterStatus === 'awaiting pick' && derivedStatusLower.startsWith('awaiting pick')) {
            return true
          }
          // Category filters: match by raw DB status (catches all sub-statuses)
          if (CATEGORY_TO_RAW[filterStatus] && s.rawStatus === CATEGORY_TO_RAW[filterStatus]) {
            return true
          }
          return derivedStatusLower === filterStatus
        })
      })
    }

    // Apply search filter client-side ONLY if full-text search was unavailable
    // (when migration hasn't been run yet)
    if (searchQuery && needsClientSideSearch) {
      const searchLower = searchQuery.toLowerCase()
      filteredShipments = filteredShipments.filter((s: any) =>
        s.customerName?.toLowerCase().includes(searchLower) ||
        s.orderId?.toLowerCase().includes(searchLower) ||
        s.storeOrderId?.toLowerCase().includes(searchLower)
      )
    }

    return NextResponse.json({
      data: filteredShipments,
      // Note: count from DB query may not match filtered count when using client-side status filter
      // Return the actual filtered count for accuracy
      totalCount: statusFilterValues ? filteredShipments.length : (count || 0),
      hasMore: statusFilterValues ? false : (offset + limit) < (count || 0),
    })
  } catch (err) {
    console.error('Unfulfilled orders API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

/**
 * Helper to convert PascalCase/camelCase to human-readable format
 * e.g., "InvalidAddress" → "Invalid Address", "OnHold" → "On Hold"
 */
function formatPascalCase(str: string): string {
  if (!str) return str
  return str
    .replace(/([a-z])([A-Z])/g, '$1 $2')  // Add space before capitals
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')  // Handle consecutive caps
    .trim()
}

/**
 * Derive a granular, human-readable status from shipment fields
 *
 * ShipBob Processing Status Hierarchy:
 * - Import Review
 * - Processing: Awaiting Pick → Pick In-Progress → Picked → Packed → Labelled
 * - Exception statuses: Out of Stock, Address Issue, On Hold (with reason)
 */
function deriveGranularStatus(shipment: any): string {
  const status = shipment.status
  const efdStatus = shipment.estimated_fulfillment_date_status
  const statusDetails = shipment.status_details

  // Check OnHold/Exception FIRST - these override any prior fulfillment progress
  // (a shipment can be picked then put on hold afterward)
  if (status === 'OnHold') {
    if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
      const detailName = statusDetails[0]?.name
      if (detailName) {
        if (detailName === 'Manual') {
          return 'Manual Hold'
        }
        return formatPascalCase(detailName)
      }
    }
    if (efdStatus) {
      return formatPascalCase(efdStatus)
    }
    return 'On Hold'
  }

  if (status === 'Exception') {
    if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
      const detailName = statusDetails[0]?.name
      if (detailName === 'OutOfStock') return 'Out of Stock'
      if (detailName === 'UnknownSku') return 'Unknown SKU'
      if (detailName === 'AddressValidationFailed') return 'Address Issue'
      if (detailName) return formatPascalCase(detailName)
    }
    return 'Exception'
  }

  // Check event timestamps - most reliable indicators of fulfillment progress
  if (shipment.event_labeled) {
    return 'Labelled'
  }
  if (shipment.event_packed) {
    return 'Packed'
  }
  if (shipment.event_picked) {
    return 'Picked'
  }

  // Check status_details for granular processing statuses
  if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
    const detailName = statusDetails[0]?.name

    if (detailName === 'OutOfStock') return 'Out of Stock'
    if (detailName === 'AddressValidationFailed') return 'Address Issue'
    if (detailName === 'Picked') return 'Picked'
    if (detailName === 'Packed') return 'Packed'
    if (detailName === 'PickInProgress') return 'Pick In-Progress'
    if (detailName === 'LabeledCreated' || detailName === 'Labelled') return 'Labelled'
  }

  // Check EFD status for inventory issues (only if not OnHold)
  if (efdStatus === 'AwaitingInventoryAllocation') {
    return 'Out of Stock'
  }

  // Check main status for granular processing states
  if (status) {
    switch (status) {
      // Exception
      case 'Exception':
        return 'Exception'

      // Granular processing statuses
      case 'LabeledCreated':
        return 'Labelled'
      case 'Packed':
        return 'Packed'
      case 'Picked':
        return 'Picked'
      case 'PickInProgress':
        return 'Pick In-Progress'
      case 'ImportReview':
        return 'Import Review'

      // Generic Processing - derive more detail
      case 'Processing':
        // Event timestamps are checked at the top of the function
        // If we reach here, no picking/packing has started yet
        if (efdStatus === 'PendingLate') {
          return 'Awaiting Pick (Late)'
        }
        return 'Awaiting Pick'
    }
  }

  // Fallback - pass through raw status or default to Pending
  return status || 'Pending'
}
