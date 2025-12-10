import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Default client ID for development (Henson Shaving)
const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

export async function GET(request: NextRequest) {
  // Use admin client to bypass RLS (API route is server-side only)
  const supabase = createAdminClient()

  // Get query params
  const searchParams = request.nextUrl.searchParams
  const clientIdParam = searchParams.get('clientId')
  // 'all' means return all brands (admin view), otherwise filter by clientId
  const clientId = clientIdParam === 'all' ? null : (clientIdParam || DEFAULT_CLIENT_ID)
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  // Date range filtering on order_import_date (ISO date strings, e.g., '2025-01-01')
  const startDate = searchParams.get('startDate')
  const endDate = searchParams.get('endDate')

  // Status filter (comma-separated)
  const statusFilter = searchParams.get('status')?.split(',').filter(Boolean) || []

  // Type filter (DTC, B2B, etc. - comma-separated)
  const typeFilter = searchParams.get('type')?.split(',').filter(Boolean) || []

  // Channel filter (comma-separated)
  const channelFilter = searchParams.get('channel')?.split(',').filter(Boolean) || []

  // Carrier filter (comma-separated) - filters by shipping carrier
  const carrierFilter = searchParams.get('carrier')?.split(',').filter(Boolean) || []

  // Search query for real-time search across multiple fields
  const searchQuery = searchParams.get('search')?.trim() || ''

  // Age filter - comma-separated age ranges like "0-1,1-2,7+"
  const ageFilter = searchParams.get('age')?.split(',').filter(Boolean) || []

  try {
    // Check if we need to filter by order fields (requires JOIN)
    // Search also requires JOIN to search across order fields like store_order_id
    // Age filter also requires JOIN since we filter on order_import_date
    // NOTE: type/channel filters now use denormalized columns on shipments (no JOIN needed)
    const hasOrderFilters = startDate || endDate || searchQuery || ageFilter.length > 0

    // =========================================================================
    // SINGLE QUERY WITH JOIN - Let the database do the filtering properly
    // Using Supabase's !inner syntax for INNER JOIN with filters
    // =========================================================================

    // Build the select query - use !inner for JOIN when we have order filters
    const selectFields = hasOrderFilters
      ? `
        id,
        shipment_id,
        order_id,
        shipbob_order_id,
        tracking_id,
        status,
        status_details,
        recipient_name,
        recipient_email,
        carrier,
        carrier_service,
        event_labeled,
        event_intransit,
        event_delivered,
        estimated_fulfillment_date,
        estimated_fulfillment_date_status,
        fc_name,
        client_id,
        application_name,
        destination_country,
        orders!inner(
          id,
          shipbob_order_id,
          store_order_id,
          customer_name,
          order_import_date,
          purchase_date,
          status,
          order_type,
          channel_name,
          application_name
        )
      `
      : `
        id,
        shipment_id,
        order_id,
        shipbob_order_id,
        tracking_id,
        status,
        status_details,
        recipient_name,
        recipient_email,
        carrier,
        carrier_service,
        event_labeled,
        event_intransit,
        event_delivered,
        estimated_fulfillment_date,
        estimated_fulfillment_date_status,
        fc_name,
        client_id,
        application_name,
        destination_country,
        orders(
          id,
          shipbob_order_id,
          store_order_id,
          customer_name,
          order_import_date,
          purchase_date,
          status,
          order_type,
          channel_name,
          application_name
        )
      `

    let query = supabase
      .from('shipments')
      .select(selectFields, { count: 'exact' })

    // Filter by client_id on shipments table
    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    // Only show shipments that have actually shipped (have event_labeled or event_intransit)
    query = query.not('event_labeled', 'is', null)

    // Exclude soft-deleted records
    query = query.is('deleted_at', null)

    // Apply status filter at database level
    // For shipped records, tracking status comes from status_details JSONB
    // The status column is typically 'Completed' for shipped items
    if (statusFilter.length > 0) {
      const dbFilters: string[] = []

      for (const status of statusFilter) {
        switch (status.toLowerCase()) {
          case 'delivered':
            // Delivered shipments have event_delivered set
            dbFilters.push('event_delivered.not.is.null')
            break
          case 'exception':
            // Exceptions are in status_details JSONB (DeliveryException)
            // Also check for DeliveryAttemptFailed
            dbFilters.push('status_details->0->>name.eq.DeliveryException')
            dbFilters.push('status_details->0->>name.eq.DeliveryAttemptFailed')
            break
          case 'labelled':
            // Labelled status (pre-ship, but some may have shipped_date)
            dbFilters.push('status.eq.LabeledCreated')
            break
          case 'awaiting carrier':
            // Awaiting carrier pickup - can come from:
            // 1. status = 'AwaitingCarrierScan'
            // 2. status_details[0].name = 'AwaitingCarrierScan'
            // 3. status_details[0].name = 'Processing' with description containing 'Carrier'
            dbFilters.push('status.eq.AwaitingCarrierScan')
            dbFilters.push('status_details->0->>name.eq.AwaitingCarrierScan')
            dbFilters.push('status_details->0->>description.ilike.*Carrier*')
            break
          case 'in transit':
            // InTransit tracking status
            dbFilters.push('status_details->0->>name.eq.InTransit')
            break
          case 'out for delivery':
            // OutForDelivery tracking status
            dbFilters.push('status_details->0->>name.eq.OutForDelivery')
            break
        }
      }

      if (dbFilters.length > 0) {
        query = query.or(dbFilters.join(','))
      }
    }

    // Apply order-related filters using the JOIN
    // These filter on the joined orders table directly in the database
    if (startDate) {
      query = query.gte('orders.order_import_date', startDate)
    }
    if (endDate) {
      query = query.lte('orders.order_import_date', `${endDate}T23:59:59.999Z`)
    }
    if (typeFilter.length > 0) {
      query = query.in('order_type', typeFilter)
    }
    if (channelFilter.length > 0) {
      query = query.in('application_name', channelFilter)
    }

    // Age filter - parse ranges for filtering
    // Age = fulfillment time (deliveredDate - importDate for delivered, now - importDate for in-transit)
    let ageFilterRanges: Array<{ min: number; max: number }> = []
    if (ageFilter.length > 0) {
      for (const range of ageFilter) {
        switch (range) {
          case '0-1':
            ageFilterRanges.push({ min: 0, max: 1 })
            break
          case '1-2':
            ageFilterRanges.push({ min: 1, max: 2 })
            break
          case '2-3':
            ageFilterRanges.push({ min: 2, max: 3 })
            break
          case '3-5':
            ageFilterRanges.push({ min: 3, max: 5 })
            break
          case '5-7':
            ageFilterRanges.push({ min: 5, max: 7 })
            break
          case '7-10':
            ageFilterRanges.push({ min: 7, max: 10 })
            break
          case '10-15':
            ageFilterRanges.push({ min: 10, max: 15 })
            break
          case '15+':
            ageFilterRanges.push({ min: 15, max: Infinity })
            break
        }
      }
    }

    // Apply carrier filter (filters on shipments.carrier column)
    if (carrierFilter.length > 0) {
      query = query.in('carrier', carrierFilter)
    }

    // Apply search filter - hybrid approach:
    // - Full-text search (GIN indexed) for name-like searches
    // - ILIKE for ID/tracking searches (substring matching)
    // This gives best UX: fast name search + partial ID matching
    let useFullTextSearch = false
    if (searchQuery) {
      const searchTerm = searchQuery.trim()
      // Detect if search looks like an ID (contains digits or is alphanumeric without spaces)
      const looksLikeId = /\d/.test(searchTerm) || (/^[a-zA-Z0-9]+$/.test(searchTerm) && searchTerm.length > 3)

      if (looksLikeId) {
        // Use ILIKE for ID searches - supports partial matching
        // Search visible columns: Order ID (shipbob_order_id), Shipment ID (shipment_id), Tracking ID (tracking_id)
        const searchPattern = `%${searchTerm}%`
        query = query.or(
          `recipient_name.ilike.${searchPattern},shipbob_order_id.ilike.${searchPattern},shipment_id.ilike.${searchPattern},tracking_id.ilike.${searchPattern}`
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

    // =========================================================================
    // AGE FILTER: Database-level filtering via RPC function (fast!)
    // Falls back to parallel batch fetching if RPC function doesn't exist
    // Age = deliveredDate - importDate (for delivered) or NOW() - importDate (in-transit)
    // =========================================================================
    let matchingShipmentIds: string[] | null = null
    let filteredTotalCount: number | null = null

    if (ageFilterRanges.length > 0) {
      // Convert age ranges to JSONB format for RPC function
      const ageRangesJsonb = ageFilterRanges.map(range => ({
        min: range.min,
        max: range.max === Infinity ? null : range.max
      }))

      // Try RPC function first (database-level filtering - very fast!)
      const rpcStartTime = Date.now()
      const { data: rpcData, error: rpcError } = await supabase.rpc('get_shipments_by_age', {
        p_client_id: clientId || null,
        p_age_ranges: ageRangesJsonb,
        p_limit: limit,
        p_offset: offset,
        p_status_filter: statusFilter.length > 0 ? statusFilter : null,
        p_type_filter: typeFilter.length > 0 ? typeFilter : null,
        p_channel_filter: channelFilter.length > 0 ? channelFilter : null,
        p_carrier_filter: carrierFilter.length > 0 ? carrierFilter : null,
        p_start_date: startDate || null,
        p_end_date: endDate || null,
      })

      if (!rpcError && rpcData) {
        // RPC function worked! Extract IDs and total count
        console.log(`[Age Filter RPC] ${rpcData.length} results in ${Date.now() - rpcStartTime}ms`)

        if (rpcData.length === 0) {
          // RPC worked but no results match the age filter
          return NextResponse.json({
            data: [],
            totalCount: 0,
            hasMore: false,
            carriers: [],
          })
        }

        matchingShipmentIds = rpcData.map((r: any) => r.shipment_id)
        filteredTotalCount = rpcData[0]?.total_count || rpcData.length

        // Modify main query to only fetch these IDs
        query = query.in('id', matchingShipmentIds)
      } else if (rpcError) {
        // RPC function doesn't exist or failed - fall back to parallel batch fetching
        console.log(`[Age Filter] RPC not available (${rpcError.message}), using parallel batch fallback`)

        const BATCH_SIZE = 1000
        const MAX_CONCURRENT = 15

        // Helper function to build a batch query with all filters applied
        const buildBatchQuery = () => {
          let batchQuery = supabase
            .from('shipments')
            .select(`
              id,
              event_delivered,
              event_labeled,
              orders!inner(order_import_date)
            `)
            .not('event_labeled', 'is', null)
            .is('deleted_at', null)

          if (clientId) {
            batchQuery = batchQuery.eq('client_id', clientId)
          }

          // Apply same filters as main query
          if (statusFilter.length > 0) {
            const dbFilters: string[] = []
            for (const status of statusFilter) {
              switch (status.toLowerCase()) {
                case 'delivered': dbFilters.push('event_delivered.not.is.null'); break
                case 'exception': dbFilters.push('status_details->0->>name.eq.DeliveryException'); dbFilters.push('status_details->0->>name.eq.DeliveryAttemptFailed'); break
                case 'labelled': dbFilters.push('status.eq.LabeledCreated'); break
                case 'awaiting carrier': dbFilters.push('status.eq.AwaitingCarrierScan'); dbFilters.push('status_details->0->>name.eq.AwaitingCarrierScan'); dbFilters.push('status_details->0->>description.ilike.*Carrier*'); break
                case 'in transit': dbFilters.push('status_details->0->>name.eq.InTransit'); break
                case 'out for delivery': dbFilters.push('status_details->0->>name.eq.OutForDelivery'); break
              }
            }
            if (dbFilters.length > 0) {
              batchQuery = batchQuery.or(dbFilters.join(','))
            }
          }
          if (startDate) batchQuery = batchQuery.gte('orders.order_import_date', startDate)
          if (endDate) batchQuery = batchQuery.lte('orders.order_import_date', `${endDate}T23:59:59.999Z`)
          if (typeFilter.length > 0) batchQuery = batchQuery.in('order_type', typeFilter)
          if (channelFilter.length > 0) batchQuery = batchQuery.in('application_name', channelFilter)
          if (carrierFilter.length > 0) batchQuery = batchQuery.in('carrier', carrierFilter)

          return batchQuery
        }

        // Get total count
        let countQuery = supabase
          .from('shipments')
          .select('id', { count: 'exact', head: true })
          .not('event_labeled', 'is', null)
          .is('deleted_at', null)

        if (clientId) {
          countQuery = countQuery.eq('client_id', clientId)
        }
        if (carrierFilter.length > 0) countQuery = countQuery.in('carrier', carrierFilter)

        const { count: totalRecords, error: countError } = await countQuery

        if (countError) {
          console.error('Error getting count for age filter:', countError)
          return NextResponse.json({ error: countError.message }, { status: 500 })
        }

        const totalBatches = Math.ceil((totalRecords || 0) / BATCH_SIZE)
        console.log(`[Age Filter Fallback] Total records: ${totalRecords}, batches needed: ${totalBatches}`)

        // Fetch all batches in parallel
        let allShipments: any[] = []

        for (let i = 0; i < totalBatches; i += MAX_CONCURRENT) {
          const batchPromises: Promise<any>[] = []
          const endBatch = Math.min(i + MAX_CONCURRENT, totalBatches)

          for (let batchNum = i; batchNum < endBatch; batchNum++) {
            const batchOffset = batchNum * BATCH_SIZE
            const batchQuery = buildBatchQuery()
              .order('event_labeled', { ascending: false })
              .range(batchOffset, batchOffset + BATCH_SIZE - 1)

            batchPromises.push(batchQuery)
          }

          const results = await Promise.all(batchPromises)

          for (const result of results) {
            if (result.error) {
              console.error('Error fetching batch for age filter:', result.error)
              continue
            }
            if (result.data && result.data.length > 0) {
              allShipments = allShipments.concat(result.data)
            }
          }
        }

        console.log(`[Age Filter Fallback] Fetched ${allShipments.length} shipments in parallel`)

        // Filter by age client-side
        // Age = time from label creation (event_labeled) to delivery (event_delivered) or now
        const now = new Date()
        const matchingShipments = allShipments.filter((s: any) => {
          if (!s.event_labeled) return false  // Skip shipments without label date
          const labelDate = new Date(s.event_labeled)
          const endDateValue = s.event_delivered ? new Date(s.event_delivered) : now
          const ageInDays = (endDateValue.getTime() - labelDate.getTime()) / (1000 * 60 * 60 * 24)

          return ageFilterRanges.some(range => {
            if (range.max === Infinity) {
              return ageInDays >= range.min
            }
            return ageInDays >= range.min && ageInDays < range.max
          })
        })

        console.log(`[Age Filter Fallback] ${matchingShipments.length} shipments match age criteria`)

        filteredTotalCount = matchingShipments.length
        const pageSlice = matchingShipments.slice(offset, offset + limit)
        matchingShipmentIds = pageSlice.map((s: any) => s.id)

        if (matchingShipmentIds.length === 0) {
          return NextResponse.json({
            data: [],
            totalCount: 0,
            hasMore: false,
            carriers: [],
          })
        }

        query = query.in('id', matchingShipmentIds)
      }
    }

    // Execute main query
    let { data: shipmentsData, error: shipmentsError, count } = await query
      .order('event_labeled', { ascending: false })
      .range(matchingShipmentIds ? 0 : offset, matchingShipmentIds ? matchingShipmentIds.length - 1 : offset + limit - 1)

    // If full-text search failed (column doesn't exist), retry with ILIKE
    if (shipmentsError && useFullTextSearch && shipmentsError.message.includes('search_vector')) {
      console.log('Full-text search column not found, falling back to ILIKE search')

      // Rebuild query without textSearch
      let fallbackQuery = supabase
        .from('shipments')
        .select(selectFields, { count: 'exact' })

      if (clientId) {
        fallbackQuery = fallbackQuery.eq('client_id', clientId)
      }
      fallbackQuery = fallbackQuery.not('event_labeled', 'is', null)
      fallbackQuery = fallbackQuery.is('deleted_at', null)

      // Re-apply all filters
      if (statusFilter.length > 0) {
        const dbFilters: string[] = []
        for (const status of statusFilter) {
          switch (status.toLowerCase()) {
            case 'delivered': dbFilters.push('event_delivered.not.is.null'); break
            case 'exception': dbFilters.push('status_details->0->>name.eq.DeliveryException'); dbFilters.push('status_details->0->>name.eq.DeliveryAttemptFailed'); break
            case 'labelled': dbFilters.push('status.eq.LabeledCreated'); break
            case 'awaiting carrier': dbFilters.push('status.eq.AwaitingCarrierScan'); dbFilters.push('status_details->0->>name.eq.AwaitingCarrierScan'); dbFilters.push('status_details->0->>description.ilike.*Carrier*'); break
            case 'in transit': dbFilters.push('status_details->0->>name.eq.InTransit'); break
            case 'out for delivery': dbFilters.push('status_details->0->>name.eq.OutForDelivery'); break
          }
        }
        if (dbFilters.length > 0) {
          fallbackQuery = fallbackQuery.or(dbFilters.join(','))
        }
      }
      if (startDate) fallbackQuery = fallbackQuery.gte('orders.order_import_date', startDate)
      if (endDate) fallbackQuery = fallbackQuery.lte('orders.order_import_date', `${endDate}T23:59:59.999Z`)
      if (typeFilter.length > 0) fallbackQuery = fallbackQuery.in('order_type', typeFilter)
      if (channelFilter.length > 0) fallbackQuery = fallbackQuery.in('application_name', channelFilter)
      if (carrierFilter.length > 0) fallbackQuery = fallbackQuery.in('carrier', carrierFilter)

      // Apply ILIKE search fallback - visible columns including Tracking ID
      const searchPattern = `%${searchQuery}%`
      fallbackQuery = fallbackQuery.or(
        `recipient_name.ilike.${searchPattern},shipbob_order_id.ilike.${searchPattern},shipment_id.ilike.${searchPattern},tracking_id.ilike.${searchPattern}`
      )

      const fallbackResult = await fallbackQuery
        .order('event_labeled', { ascending: false })
        .range(offset, offset + limit - 1)

      shipmentsData = fallbackResult.data
      shipmentsError = fallbackResult.error
      count = fallbackResult.count
    }

    if (shipmentsError) {
      console.error('Error fetching shipments:', shipmentsError)
      return NextResponse.json({ error: shipmentsError.message }, { status: 500 })
    }

    // =========================================================================
    // Get item counts, billing data, and refund status for the returned shipments
    // =========================================================================

    const shipmentIds = (shipmentsData || []).map((s: any) => s.shipment_id)
    const trackingIds = (shipmentsData || []).map((s: any) => s.tracking_id).filter(Boolean)
    let itemCounts: Record<string, number> = {}
    let billingMap: Record<string, { totalCost: number }> = {}
    let refundedTrackingIds: Set<string> = new Set()

    if (shipmentIds.length > 0) {
      // Count items per shipment
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

      // Get billing data
      const shipmentIdsForBilling = shipmentIds.map((id: string) => parseInt(id)).filter((id: number) => !isNaN(id))

      if (shipmentIdsForBilling.length > 0) {
        const { data: billingData } = await supabase
          .from('billing_shipments')
          .select(`
            order_id,
            fulfillment_cost,
            surcharge,
            pick_fees,
            b2b_fees,
            insurance
          `)
          .in('order_id', shipmentIdsForBilling)

        if (billingData) {
          billingMap = billingData.reduce((acc: Record<string, { totalCost: number }>, bill: any) => {
            const totalCost =
              (parseFloat(bill.fulfillment_cost) || 0) +
              (parseFloat(bill.surcharge) || 0) +
              (parseFloat(bill.pick_fees) || 0) +
              (parseFloat(bill.b2b_fees) || 0) +
              (parseFloat(bill.insurance) || 0)
            acc[bill.order_id.toString()] = { totalCost }
            return acc
          }, {})
        }
      }

      // Check for refunds in billing_shipments by tracking_id (shipment_id in billing table)
      if (trackingIds.length > 0) {
        const { data: refundData } = await supabase
          .from('billing_shipments')
          .select('shipment_id')
          .eq('transaction_type', 'Refund')
          .in('shipment_id', trackingIds)

        if (refundData) {
          refundedTrackingIds = new Set(refundData.map((r: any) => r.shipment_id))
          console.log(`[Refund Check] Found ${refundedTrackingIds.size} refunded shipments`)
        }
      }
    }

    // =========================================================================
    // Map to response format
    // =========================================================================

    let shipments = (shipmentsData || []).map((row: any) => {
      // Order data comes from the JOIN (nested under 'orders' key)
      const order = row.orders || null
      let shipmentStatus = getShipmentStatus(row.status, row.estimated_fulfillment_date_status, row.status_details, row.event_labeled || row.event_intransit, row.event_delivered)
      const billing = billingMap[row.shipment_id]

      // Override status to "Refunded" if this shipment has a refund in billing
      const isRefunded = row.tracking_id && refundedTrackingIds.has(row.tracking_id)
      if (isRefunded) {
        shipmentStatus = 'Refunded'
      }

      return {
        id: row.id,
        shipmentId: row.shipment_id || '',
        orderId: row.shipbob_order_id || order?.shipbob_order_id || '',
        status: shipmentStatus,
        customerName: row.recipient_name || order?.customer_name || 'Unknown',
        orderType: order?.order_type || 'DTC',
        qty: itemCounts[row.shipment_id] || 1,
        cost: billing?.totalCost || 0,
        importDate: order?.order_import_date || null,
        labelCreated: row.event_labeled || null,  // When label was created
        slaDate: row.estimated_fulfillment_date || null,
        trackingId: row.tracking_id || '',
        carrier: row.carrier || '',
        carrierService: row.carrier_service || '',
        shippedDate: row.event_labeled || row.event_intransit,
        deliveredDate: row.event_delivered,
        fcName: row.fc_name || '',
        storeOrderId: order?.store_order_id || '',
        channelName: row.application_name || order?.application_name || order?.channel_name || '',
        estimatedFulfillmentStatus: row.estimated_fulfillment_date_status || '',
        // Additional columns
        orderDate: order?.purchase_date || null,
        destCountry: row.destination_country || '',
        shipOption: row.carrier_service || '',
      }
    })

    // Note: Status filtering is now done at the database level (see above)
    // Age filtering is also done above with the special two-pass approach

    // =========================================================================
    // Get ALL unique carriers from the entire dataset (not just current page)
    // This query ignores pagination but respects client_id filter
    // =========================================================================
    let allCarriers: string[] = []
    try {
      // Use a separate query to get all distinct carriers
      let carriersQuery = supabase
        .from('shipments')
        .select('carrier')
        .not('event_labeled', 'is', null)
        .not('carrier', 'is', null)
        .is('deleted_at', null)

      if (clientId) {
        carriersQuery = carriersQuery.eq('client_id', clientId)
      }

      const { data: carriersData } = await carriersQuery

      if (carriersData) {
        // Filter out non-carrier values that got stored in carrier field
        const EXCLUDED_CARRIERS = ['DE_KITTING']
        allCarriers = [...new Set(
          carriersData
            .map((r: any) => r.carrier)
            .filter((c: string) => c && !EXCLUDED_CARRIERS.includes(c))
        )].sort() as string[]
      }
    } catch (err) {
      console.error('Error fetching all carriers:', err)
      // Fall back to carriers from current page
      allCarriers = [...new Set(shipments.map((s: any) => s.carrier).filter(Boolean))].sort() as string[]
    }

    // Use the pre-computed filtered count if age filter was applied, otherwise use DB count
    const finalTotalCount = filteredTotalCount !== null ? filteredTotalCount : (count || 0)

    return NextResponse.json({
      data: shipments,
      totalCount: finalTotalCount,
      hasMore: (offset + limit) < finalTotalCount,
      carriers: allCarriers,
    })
  } catch (err) {
    console.error('Shipments API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Extract shipment status - Complete ShipBob status hierarchy
function getShipmentStatus(
  status?: string,
  efdStatus?: string,
  statusDetails?: any[],
  shippedDate?: string | null,
  deliveredDate?: string | null
): string {
  if (deliveredDate) {
    return 'Delivered'
  }

  if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
    const trackingStatus = statusDetails[0]?.name
    const trackingDescription = statusDetails[0]?.description

    if (trackingStatus) {
      switch (trackingStatus) {
        case 'Delivered': return 'Delivered'
        case 'OutForDelivery': return 'Out for Delivery'
        case 'InTransit': return 'In Transit'
        case 'AwaitingCarrierScan': return 'Awaiting Carrier'
        case 'DeliveryException': return 'Exception'
        case 'DeliveryAttemptFailed': return 'Delivery Attempted'
        case 'Picked': return 'Picked'
        case 'Packed': return 'Packed'
        case 'PickInProgress': return 'Pick In-Progress'
        case 'Processing':
          if (trackingDescription?.includes('Waiting For Carrier') || trackingDescription?.includes('Carrier Pickup')) {
            return 'Awaiting Carrier'
          }
          break
      }
    }
  }

  if (status) {
    switch (status) {
      case 'Completed': return 'Shipped'
      case 'LabeledCreated': return 'Labelled'
      case 'Cancelled': return 'Cancelled'
      case 'Exception':
        return efdStatus === 'AwaitingInventoryAllocation' ? 'Out of Stock' : 'Exception'
      case 'Packed': return 'Packed'
      case 'Picked': return 'Picked'
      case 'PickInProgress': return 'Pick In-Progress'
      case 'ImportReview': return 'Import Review'
      case 'AwaitingCarrierScan': return 'Awaiting Carrier'
      case 'Processing':
        return efdStatus === 'AwaitingInventoryAllocation' ? 'Out of Stock' : 'Awaiting Pick'
    }
  }

  if (shippedDate) {
    return 'Shipped'
  }

  if (efdStatus) {
    switch (efdStatus) {
      case 'FulfilledOnTime':
      case 'FulfilledLate':
        return shippedDate ? 'Shipped' : 'Pending'
      case 'AwaitingInventoryAllocation': return 'Out of Stock'
      case 'PendingOnTime':
      case 'PendingLate': return 'Awaiting Pick'
      case 'Unavailable': return 'Unavailable'
      default: return efdStatus
    }
  }

  if (status) {
    return status
  }

  return 'Pending'
}
