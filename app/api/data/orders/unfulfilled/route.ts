import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Default client ID for development (Henson Shaving)
const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

/**
 * GET /api/data/orders/unfulfilled
 * Returns shipments that have NOT yet been assigned fees (shipped_date IS NULL)
 * This includes: Processing (Awaiting Pick), Exception (Out of Stock), etc.
 * Excludes: Cancelled shipments
 */
export async function GET(request: NextRequest) {
  const supabase = createAdminClient()

  // Get query params
  const searchParams = request.nextUrl.searchParams
  const clientIdParam = searchParams.get('clientId')
  // 'all' means return all brands (admin view), otherwise filter by clientId
  const clientId = clientIdParam === 'all' ? null : (clientIdParam || DEFAULT_CLIENT_ID)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')
  const statusFilter = searchParams.get('status') // comma-separated list of statuses
  const searchQuery = searchParams.get('search')?.trim() || '' // search across multiple fields

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

    // Apply status filter at database level for accurate count
    // Map derived status names to database conditions
    if (statusFilter) {
      const statuses = statusFilter.split(',').map(s => s.trim().toLowerCase())
      const dbFilters: string[] = []

      for (const status of statuses) {
        switch (status) {
          case 'exception':
            dbFilters.push('status.eq.Exception')
            break
          case 'out of stock':
            dbFilters.push('estimated_fulfillment_date_status.eq.AwaitingInventoryAllocation')
            dbFilters.push('status_details->0->>name.eq.OutOfStock')
            break
          case 'address issue':
            dbFilters.push('status_details->0->>name.eq.AddressValidationFailed')
            break
          case 'on hold':
            // Main status is "OnHold", status_details.name varies (Manual, InvalidAddress, etc.)
            dbFilters.push('status.eq.OnHold')
            break
          case 'picked':
            dbFilters.push('status.eq.Picked')
            dbFilters.push('status_details->0->>name.eq.Picked')
            break
          case 'packed':
            dbFilters.push('status.eq.Packed')
            dbFilters.push('status_details->0->>name.eq.Packed')
            break
          case 'pick in-progress':
            dbFilters.push('status.eq.PickInProgress')
            dbFilters.push('status_details->0->>name.eq.PickInProgress')
            break
          case 'labelled':
            dbFilters.push('status.eq.LabeledCreated')
            dbFilters.push('status_details->0->>name.eq.LabeledCreated')
            dbFilters.push('status_details->0->>name.eq.Labelled')
            break
          case 'import review':
            dbFilters.push('status.eq.ImportReview')
            break
          case 'awaiting pick':
          case 'awaiting pick (late)':
            // Processing status with label_generation_date set
            dbFilters.push('status.eq.Processing')
            break
          case 'processing':
            dbFilters.push('status.eq.Processing')
            break
        }
      }

      if (dbFilters.length > 0) {
        query = query.or(dbFilters.join(','))
      }
    }

    // Apply search filter - hybrid approach:
    // - Full-text search (GIN indexed) for name-like searches
    // - ILIKE for ID/tracking searches (substring matching)
    let needsClientSideSearch = false
    let useFullTextSearch = false
    if (searchQuery) {
      const searchTerm = searchQuery.trim()
      // Detect if search looks like an ID (contains digits or is alphanumeric without spaces)
      const looksLikeId = /\d/.test(searchTerm) || (/^[a-zA-Z0-9]+$/.test(searchTerm) && searchTerm.length > 3)

      if (looksLikeId) {
        // Use ILIKE for ID searches - supports partial matching
        // Note: Can only search shipments table columns in .or() - joined table columns don't work
        const searchPattern = `%${searchTerm}%`
        query = query.or(
          `recipient_name.ilike.${searchPattern},shipbob_order_id.ilike.${searchPattern},shipment_id.ilike.${searchPattern}`
        )
      } else {
        // Use full-text search for name searches (GIN indexed, very fast)
        query = query.textSearch('search_vector', searchTerm, {
          type: 'websearch',
          config: 'english'
        })
        useFullTextSearch = true
      }
    }

    // Order by label generation date (most recent first) and paginate
    let { data: shipmentsData, error: shipmentsError, count } = await query
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

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

      const fallbackResult = await fallbackQuery
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      shipmentsData = fallbackResult.data
      shipmentsError = fallbackResult.error
      count = fallbackResult.count
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

    // Map to response format with granular statuses
    const shipments = (shipmentsData || []).map((shipment: any) => {
      // Get order data from JOIN (when hasDateFilter) or from separate fetch
      const order = hasDateFilter ? (shipment.orders || {}) : (ordersMap[shipment.order_id] || {})
      const derivedStatus = deriveGranularStatus(shipment)

      return {
        id: shipment.id,
        orderId: shipment.shipbob_order_id || '',
        shipmentId: shipment.shipment_id?.toString() || '',
        storeOrderId: order.store_order_id || '',
        customerName: shipment.recipient_name || order.customer_name || 'Unknown',
        status: derivedStatus,
        orderDate: order.order_import_date || shipment.created_at,
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
      }
    })

    // Note: Status filtering is now done at database level (see above)
    // This ensures the count reflects the filtered results

    // Apply search filter client-side ONLY if full-text search was unavailable
    // (when migration hasn't been run yet)
    let filteredShipments = shipments
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
      totalCount: count || 0,
      hasMore: (offset + limit) < (count || 0),
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

  // Check status_details first - contains the most granular status info
  if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
    const detailName = statusDetails[0]?.name

    // Exception statuses
    if (detailName === 'OutOfStock') {
      return 'Out of Stock'
    }
    if (detailName === 'AddressValidationFailed') {
      return 'Address Issue'
    }
    if (detailName === 'OnHold') {
      return 'On Hold'
    }

    // Granular processing statuses from status_details
    if (detailName === 'Picked') {
      return 'Picked'
    }
    if (detailName === 'Packed') {
      return 'Packed'
    }
    if (detailName === 'PickInProgress') {
      return 'Pick In-Progress'
    }
    if (detailName === 'LabeledCreated' || detailName === 'Labelled') {
      return 'Labelled'
    }
  }

  // Check main status = OnHold FIRST (takes precedence over inventory issues)
  // Some OnHold orders also have AwaitingInventoryAllocation - show the hold reason, not "Out of Stock"
  if (status === 'OnHold') {
    if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
      const detailName = statusDetails[0]?.name
      if (detailName) {
        // Special case: "Manual" should display as "Manual Hold"
        if (detailName === 'Manual') {
          return 'Manual Hold'
        }
        // Format the reason nicely (e.g., "InvalidAddress" -> "Invalid Address")
        return formatPascalCase(detailName)
      }
    }
    // No status_details - use EFD status if available (e.g., "AwaitingReset" -> "Awaiting Reset")
    if (efdStatus) {
      return formatPascalCase(efdStatus)
    }
    return 'On Hold'
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
        // Check if label has been created
        if (shipment.event_labeled) {
          // Has label, waiting to be picked/shipped
          if (efdStatus === 'PendingLate') {
            return 'Awaiting Pick (Late)'
          }
          return 'Awaiting Pick'
        }
        // No label yet
        return 'Processing'
    }
  }

  // Fallback - pass through raw status or default to Pending
  return status || 'Pending'
}
