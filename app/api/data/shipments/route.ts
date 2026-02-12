import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'
import { SupabaseClient } from '@supabase/supabase-js'

/**
 * Batched .in() query helper.
 * Supabase returns MAX 1000 rows per request. When querying with .in()
 * on large ID arrays, results can exceed this limit. This helper splits
 * the IDs into batches and merges results.
 */
async function batchedInQuery<T = Record<string, unknown>>(
  supabase: SupabaseClient,
  table: string,
  selectFields: string,
  inColumn: string,
  ids: string[],
  batchSize = 500
): Promise<T[]> {
  if (ids.length === 0) return []
  if (ids.length <= batchSize) {
    const { data } = await supabase
      .from(table)
      .select(selectFields)
      .in(inColumn, ids)
    return (data || []) as T[]
  }
  // Split into batches and run in parallel
  const batches: string[][] = []
  for (let i = 0; i < ids.length; i += batchSize) {
    batches.push(ids.slice(i, i + batchSize))
  }
  const results = await Promise.all(
    batches.map(async (batch) => {
      const { data } = await supabase
        .from(table)
        .select(selectFields)
        .in(inColumn, batch)
      return (data || []) as T[]
    })
  )
  return results.flat()
}

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

  // Use admin client to bypass RLS (API route is server-side only)
  const supabase = createAdminClient()
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  // Cursor-based pagination: much faster than OFFSET for large exports.
  // When afterId param is present (even if empty string), uses ORDER BY id ASC
  // so all pages have consistent ordering. Empty afterId = first cursor page.
  const afterIdParam = searchParams.get('afterId') // null if param absent, '' if present but empty
  const useCursorMode = afterIdParam !== null // param is present at all
  const afterId = afterIdParam || null // non-empty value or null

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

  // Sort params - defaults to event_labeled descending
  const allowedSortFields = ['recipient_name', 'carrier', 'event_labeled', 'transit_time_days']
  const rawSortField = searchParams.get('sortField') || 'event_labeled'
  const sortField = allowedSortFields.includes(rawSortField) ? rawSortField : 'event_labeled'
  const sortDirection = searchParams.get('sortDirection') === 'asc' ? 'asc' : 'desc'
  const sortAscending = sortDirection === 'asc'

  // Export mode - when true, includes extra fields for invoice-format export
  const isExport = searchParams.get('export') === 'true'

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
        transit_time_days,
        estimated_fulfillment_date,
        estimated_fulfillment_date_status,
        fc_name,
        client_id,
        application_name,
        destination_country,
        ship_option_id,
        zone_used,
        actual_weight_oz,
        dim_weight_oz,
        billable_weight_oz,
        length,
        width,
        height,
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
          application_name,
          zip_code,
          city,
          state,
          country
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
        transit_time_days,
        estimated_fulfillment_date,
        estimated_fulfillment_date_status,
        fc_name,
        client_id,
        application_name,
        destination_country,
        ship_option_id,
        zone_used,
        actual_weight_oz,
        dim_weight_oz,
        billable_weight_oz,
        length,
        width,
        height,
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
          application_name,
          zip_code,
          city,
          state,
          country
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
    // Check for special claim eligibility status filters (from lost_in_transit_checks)
    const claimEligibilityFilters = statusFilter.filter(s =>
      s.toLowerCase() === 'at risk' || s.toLowerCase() === 'file a claim'
    )
    // Check for claim ticket status filters (from care_tickets)
    const claimTicketFilters = statusFilter.filter(s =>
      s.toLowerCase() === 'credit requested' ||
      s.toLowerCase() === 'credit approved' ||
      s.toLowerCase() === 'credit denied' ||
      s.toLowerCase() === 'claim resolved'
    )
    // Check for simple "Claim" filter - matches ANY shipment with a claim filed
    const hasClaimFilter = statusFilter.some(s => s.toLowerCase() === 'claim')
    const regularStatusFilters = statusFilter.filter(s =>
      s.toLowerCase() !== 'at risk' &&
      s.toLowerCase() !== 'file a claim' &&
      s.toLowerCase() !== 'credit requested' &&
      s.toLowerCase() !== 'credit approved' &&
      s.toLowerCase() !== 'credit denied' &&
      s.toLowerCase() !== 'claim resolved' &&
      s.toLowerCase() !== 'claim'
    )

    // Handle claim eligibility status filters
    // Both "At Risk" and "File a Claim" now query lost_in_transit_checks (TrackingMore verified)
    // This ensures we only show shipments with actual carrier tracking data, not just age-based guesses
    let claimFilterShipmentIds: string[] = []
    if (claimEligibilityFilters.length > 0) {
      const hasAtRisk = claimEligibilityFilters.some(s => s.toLowerCase() === 'at risk')
      const hasFileAClaim = claimEligibilityFilters.some(s => s.toLowerCase() === 'file a claim')

      // "At Risk" - query lost_in_transit_checks for TrackingMore-verified at-risk shipments
      // These are shipments where TrackingMore confirmed tracking is stalled but not yet eligible for claim
      if (hasAtRisk) {
        let atRiskQuery = supabase
          .from('lost_in_transit_checks')
          .select('shipment_id')
          .eq('claim_eligibility_status', 'at_risk')

        if (clientId) {
          atRiskQuery = atRiskQuery.eq('client_id', clientId)
        }

        const { data: atRiskData } = await atRiskQuery
        const atRiskIds = (atRiskData || []).map((c: { shipment_id: string }) => c.shipment_id)
        claimFilterShipmentIds.push(...atRiskIds)
      }

      // "File a Claim" - query lost_in_transit_checks for eligible shipments
      if (hasFileAClaim) {
        let eligibleQuery = supabase
          .from('lost_in_transit_checks')
          .select('shipment_id')
          .eq('claim_eligibility_status', 'eligible')

        if (clientId) {
          eligibleQuery = eligibleQuery.eq('client_id', clientId)
        }

        const { data: eligibleData } = await eligibleQuery
        const eligibleIds = (eligibleData || []).map((c: { shipment_id: string }) => c.shipment_id)
        claimFilterShipmentIds.push(...eligibleIds)
      }

      // Dedupe
      claimFilterShipmentIds = [...new Set(claimFilterShipmentIds)]
    }

    // Handle claim ticket status filters by querying care_tickets
    let claimTicketShipmentIds: string[] = []
    if (claimTicketFilters.length > 0) {
      // Map filter values to care_tickets status values
      const ticketStatuses = claimTicketFilters.map(s => {
        const lower = s.toLowerCase()
        if (lower === 'credit requested') return 'Credit Requested'
        if (lower === 'credit approved') return 'Credit Approved'
        if (lower === 'credit denied') return 'Credit Denied'
        if (lower === 'claim resolved') return 'Resolved'
        return s
      })

      let ticketQuery = supabase
        .from('care_tickets')
        .select('shipment_id')
        .eq('ticket_type', 'Claim')
        .in('status', ticketStatuses)
        .not('shipment_id', 'is', null)

      if (clientId) {
        ticketQuery = ticketQuery.eq('client_id', clientId)
      }

      const { data: ticketData } = await ticketQuery
      claimTicketShipmentIds = (ticketData || []).map((t: { shipment_id: string }) => t.shipment_id)
    }

    // Handle simple "Claim" filter - matches ANY shipment with a claim filed (any status)
    let anyClaimShipmentIds: string[] = []
    if (hasClaimFilter) {
      let anyClaimQuery = supabase
        .from('care_tickets')
        .select('shipment_id')
        .eq('ticket_type', 'Claim')
        .not('shipment_id', 'is', null)

      if (clientId) {
        anyClaimQuery = anyClaimQuery.eq('client_id', clientId)
      }

      const { data: anyClaimData } = await anyClaimQuery
      anyClaimShipmentIds = (anyClaimData || []).map((t: { shipment_id: string }) => t.shipment_id)
    }

    // Combine claim filter shipment IDs (union of eligibility, ticket, and any claim filters)
    const allClaimShipmentIds = [...new Set([...claimFilterShipmentIds, ...claimTicketShipmentIds, ...anyClaimShipmentIds])]

    // If we have claim filters but no matching shipments, and no regular filters, return empty
    if ((claimEligibilityFilters.length > 0 || claimTicketFilters.length > 0 || hasClaimFilter) &&
        allClaimShipmentIds.length === 0 && regularStatusFilters.length === 0) {
      return NextResponse.json({
        data: [],
        totalCount: 0,
        hasMore: false,
        carriers: [],
      })
    }

    // Apply the shipment ID filter if we have claim-related filters
    if (allClaimShipmentIds.length > 0) {
      query = query.in('shipment_id', allClaimShipmentIds)
    }

    if (regularStatusFilters.length > 0) {
      const dbFilters: string[] = []

      for (const status of regularStatusFilters) {
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
            // OutForDelivery tracking status - but NOT if already delivered
            // status_details may lag behind event_delivered, so we exclude delivered shipments
            dbFilters.push('and(status_details->0->>name.eq.OutForDelivery,event_delivered.is.null)')
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
        // Pre-resolve store_order_id → shipbob_order_id from orders table
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
        let orFilter = `recipient_name.ilike.${searchPattern},shipbob_order_id.ilike.${searchPattern},shipment_id.ilike.${searchPattern},tracking_id.ilike.${searchPattern}`

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
      // Convert status filter values to lowercase to match RPC function expectations
      const statusFilterLower = statusFilter.map(s => s.toLowerCase())

      const { data: rpcData, error: rpcError } = await supabase.rpc('get_shipments_by_age', {
        p_client_id: clientId || null,
        p_age_ranges: ageRangesJsonb,
        p_limit: limit,
        p_offset: offset,
        p_status_filter: statusFilterLower.length > 0 ? statusFilterLower : null,
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
                case 'out for delivery': dbFilters.push('and(status_details->0->>name.eq.OutForDelivery,event_delivered.is.null)'); break
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
              .order(sortField, { ascending: sortAscending })
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
    // Cursor-based pagination (useCursorMode): O(1) index scan vs O(N) for OFFSET
    // afterId is non-empty string on pages 2+, null on first cursor page
    if (afterId) {
      query = query.gt('id', afterId)
    }
    let { data: shipmentsData, error: shipmentsError, count } = useCursorMode
      ? await query.order('id', { ascending: true }).limit(limit)
      : await query
          .order(sortField, { ascending: sortAscending })
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
            case 'out for delivery': dbFilters.push('and(status_details->0->>name.eq.OutForDelivery,event_delivered.is.null)'); break
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
      // Re-use storeOrderIds from the initial search if available
      let fallbackOrFilter = `recipient_name.ilike.${searchPattern},shipbob_order_id.ilike.${searchPattern},shipment_id.ilike.${searchPattern},tracking_id.ilike.${searchPattern}`

      // Pre-resolve store_order_id for fallback path too
      const fbStoreQuery = supabase
        .from('orders')
        .select('shipbob_order_id')
        .ilike('store_order_id', searchPattern)
        .limit(100)
      if (clientId) fbStoreQuery.eq('client_id', clientId)
      const { data: fbStoreMatches } = await fbStoreQuery
      if (fbStoreMatches && fbStoreMatches.length > 0) {
        const fbIds = fbStoreMatches.map((o: any) => o.shipbob_order_id).filter(Boolean)
        if (fbIds.length > 0) {
          fallbackOrFilter += `,shipbob_order_id.in.(${fbIds.join(',')})`
        }
      }

      fallbackQuery = fallbackQuery.or(fallbackOrFilter)

      const fallbackResult = await fallbackQuery
        .order(sortField, { ascending: sortAscending })
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
    // OPTIMIZATION: Run these queries IN PARALLEL instead of sequentially
    // =========================================================================

    const shipmentIds = (shipmentsData || []).map((s: any) => s.shipment_id)
    const trackingIds = (shipmentsData || []).map((s: any) => s.tracking_id).filter(Boolean)
    let itemCounts: Record<string, number> = {}
    let billingMap: Record<string, { totalCost: number | null }> = {}
    let refundedTrackingIds: Set<string> = new Set()
    let voidedTrackingIds: Set<string> = new Set()
    let claimEligibilityMap: Record<string, { status: string | null; daysRemaining: number | null; eligibleAfter: string | null; substatusCategory: string | null; lastScanDescription: string | null; lastScanDate: string | null }> = {}
    let claimTicketMap: Record<string, { ticketNumber: number; status: string; creditAmount: number | null }> = {}
    let productsSoldMap: Record<string, string> = {}
    let billingExportMap: Record<string, { baseCharge: number | null; surchargeAmount: number | null; transactionType: string }> = {}
    let insuranceMap: Record<string, number> = {}
    let clientInfoMap: Record<string, { merchantId: string; merchantName: string }> = {}

    if (shipmentIds.length > 0) {
      // Run item counts, billing, claim eligibility, and claim tickets queries IN PARALLEL
      // NOTE: shipment_items and transactions queries use batchedInQuery to avoid
      // Supabase's 1000-row limit when exporting large pages (1000 shipments per page)
      const [itemData, billingData, claimEligibilityResult, claimTicketsResult, insuranceResult, clientInfoResult] = await Promise.all([
        // Query 1: Items per shipment (with name+quantity for export)
        // Batched: each shipment can have multiple items → easily exceeds 1000 rows
        batchedInQuery(
          supabase,
          'shipment_items',
          isExport ? 'shipment_id, name, quantity' : 'shipment_id',
          'shipment_id',
          shipmentIds
        ),
        // Query 2: Get billing data (only if we have tracking IDs)
        // Batched: ~1.2 transactions per tracking_id → 1000 IDs returns ~1200 rows
        trackingIds.length > 0
          ? batchedInQuery(
              supabase,
              'transactions',
              'tracking_id, reference_id, total_charge, base_charge, surcharge, fee_type, transaction_type, is_voided',
              'tracking_id',
              trackingIds
            )
          : Promise.resolve([]),
        // Query 3: Get claim eligibility status from lost_in_transit_checks
        supabase
          .from('lost_in_transit_checks')
          .select('shipment_id, claim_eligibility_status, eligible_after, substatus_category, last_scan_description, last_scan_date')
          .in('shipment_id', shipmentIds),
        // Query 4: Get claim ticket status from care_tickets (for filed claims)
        supabase
          .from('care_tickets')
          .select('shipment_id, ticket_number, status, credit_amount')
          .in('shipment_id', shipmentIds)
          .eq('ticket_type', 'Claim'),
        // Query 5: Insurance transactions (export only - keyed by reference_id/shipment_id)
        isExport
          ? supabase
              .from('transactions')
              .select('reference_id, total_charge')
              .in('reference_id', shipmentIds)
              .ilike('fee_type', '%Insurance%')
          : Promise.resolve({ data: null }),
        // Query 6: Client info for merchantId/merchantName (export only)
        isExport
          ? supabase.from('clients').select('id, merchant_id, company_name')
          : Promise.resolve({ data: null }),
      ])

      // Process item counts (itemData is a flat array from batchedInQuery)
      if (itemData.length > 0) {
        itemCounts = itemData.reduce((acc: Record<string, number>, item: any) => {
          acc[item.shipment_id] = (acc[item.shipment_id] || 0) + 1
          return acc
        }, {})
      }

      // Process billing data (billingData is a flat array from batchedInQuery)
      if (billingData.length > 0) {
        // Get total_charge from Shipping transactions only (excludes pick fees, insurance)
        // CRITICAL: Only show charge if total_charge is set (has preview or invoice markup)
        billingMap = billingData.reduce((acc: Record<string, { totalCost: number | null }>, tx: any) => {
          if (tx.tracking_id && tx.fee_type === 'Shipping' && tx.transaction_type !== 'Refund') {
            // total_charge = base_charge + surcharge (marked up shipping cost)
            // Returns null if not yet calculated (UI shows "-")
            const amount = tx.total_charge !== null && tx.total_charge !== undefined
              ? parseFloat(tx.total_charge) || 0
              : null
            acc[tx.tracking_id] = { totalCost: amount }
          }
          return acc
        }, {})

        // Also track refunded tracking IDs
        for (const tx of billingData) {
          if (tx.transaction_type === 'Refund' && tx.tracking_id) {
            refundedTrackingIds.add(tx.tracking_id as string)
          }
        }

        // Track voided tracking IDs (duplicate shipping labels that were recreated)
        for (const tx of billingData) {
          if (tx.is_voided === true && tx.tracking_id) {
            voidedTrackingIds.add(tx.tracking_id as string)
          }
        }
      }

      // Process claim eligibility data
      if (claimEligibilityResult.data) {
        for (const check of claimEligibilityResult.data) {
          if (check.shipment_id && check.claim_eligibility_status) {
            // Calculate days remaining if at_risk
            let daysRemaining: number | null = null
            if (check.claim_eligibility_status === 'at_risk' && check.eligible_after) {
              const eligibleDate = new Date(check.eligible_after)
              const today = new Date()
              today.setHours(0, 0, 0, 0)
              daysRemaining = Math.max(0, Math.ceil((eligibleDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)))
            }
            claimEligibilityMap[check.shipment_id] = {
              status: check.claim_eligibility_status,
              daysRemaining,
              eligibleAfter: check.eligible_after || null,
              substatusCategory: check.substatus_category || null,
              lastScanDescription: check.last_scan_description || null,
              lastScanDate: check.last_scan_date || null,
            }
          }
        }
      }

      // Process claim tickets data (filed claims from care_tickets)
      if (claimTicketsResult.data) {
        for (const ticket of claimTicketsResult.data) {
          if (ticket.shipment_id) {
            claimTicketMap[ticket.shipment_id] = {
              ticketNumber: ticket.ticket_number,
              status: ticket.status,
              creditAmount: ticket.credit_amount,
            }
          }
        }
      }

      // Export-only data processing
      if (isExport) {
        // Build products sold string from shipment_items (e.g. "Product A(2) ; Product B(1)")
        if (itemData.length > 0) {
          const itemsByShipment: Record<string, { name: string; qty: number }[]> = {}
          for (const item of (itemData as any[])) {
            if (!item.shipment_id) continue
            if (!itemsByShipment[item.shipment_id]) itemsByShipment[item.shipment_id] = []
            itemsByShipment[item.shipment_id].push({ name: item.name || '', qty: item.quantity || 1 })
          }
          for (const [sid, items] of Object.entries(itemsByShipment)) {
            productsSoldMap[sid] = items.map(i => `${i.name}(${i.qty})`).join(' ; ')
          }
        }

        // Extract billing breakdown (base_charge, surcharge, transaction_type) for Shipping transactions
        if (billingData.length > 0) {
          for (const tx of (billingData as any[])) {
            if (tx.fee_type === 'Shipping' && tx.transaction_type !== 'Refund' && tx.tracking_id) {
              billingExportMap[tx.tracking_id] = {
                baseCharge: tx.base_charge != null ? parseFloat(tx.base_charge) : null,
                surchargeAmount: tx.surcharge != null ? parseFloat(tx.surcharge) : null,
                transactionType: tx.transaction_type || '',
              }
            }
          }
        }

        // Build insurance map from insurance query results
        if (insuranceResult?.data) {
          for (const tx of (insuranceResult.data as any[])) {
            if (tx.reference_id) {
              const insAmt = tx.total_charge != null ? parseFloat(tx.total_charge) : 0
              insuranceMap[tx.reference_id] = (insuranceMap[tx.reference_id] || 0) + insAmt
            }
          }
        }

        // Build client info lookup
        if (clientInfoResult?.data) {
          for (const client of (clientInfoResult.data as any[])) {
            clientInfoMap[client.id] = {
              merchantId: client.merchant_id?.toString() || '',
              merchantName: client.company_name || '',
            }
          }
        }
      }
    }

    // =========================================================================
    // Map to response format
    // =========================================================================

    let shipments = (shipmentsData || []).map((row: any) => {
      // Order data comes from the JOIN (nested under 'orders' key)
      const order = row.orders || null
      let shipmentStatus = getShipmentStatus(row.status, row.estimated_fulfillment_date_status, row.status_details, row.event_labeled, row.event_delivered, row.event_picked, row.event_packed, row.event_intransit)
      // Look up billing by tracking_id (transactions table is keyed by tracking_id)
      const billing = row.tracking_id ? billingMap[row.tracking_id] : null

      // Override status to "Refunded" if this shipment has a refund in billing
      const isRefunded = row.tracking_id && refundedTrackingIds.has(row.tracking_id)
      if (isRefunded) {
        shipmentStatus = 'Refunded'
      }

      // Check if this shipment has a voided billing transaction
      const isVoided = row.tracking_id && voidedTrackingIds.has(row.tracking_id)

      // Compute age in days (from label creation to delivery or now)
      let age: number | null = null
      if (row.event_labeled) {
        const startDate = new Date(row.event_labeled)
        const endDate = row.event_delivered ? new Date(row.event_delivered) : new Date()
        const msElapsed = endDate.getTime() - startDate.getTime()
        age = parseFloat((msElapsed / (1000 * 60 * 60 * 24)).toFixed(1))
      }

      return {
        id: row.id,
        shipmentId: row.shipment_id || '',
        orderId: row.shipbob_order_id || order?.shipbob_order_id || '',
        status: shipmentStatus,
        customerName: row.recipient_name || order?.customer_name || 'Unknown',
        orderType: order?.order_type || 'DTC',
        qty: itemCounts[row.shipment_id] || 1,
        // CRITICAL: Only show charge if Shipping transaction has total_charge calculated
        // Returns null if awaiting SFTP/markup calculation (UI shows "-")
        charge: billing?.totalCost ?? null,
        importDate: order?.order_import_date || null,
        labelCreated: row.event_labeled || null,  // When label was created
        slaDate: row.estimated_fulfillment_date || null,
        trackingId: row.tracking_id || '',
        carrier: row.carrier || '',
        carrierService: row.carrier_service || '',
        shippedDate: row.event_labeled || row.event_intransit,
        deliveredDate: row.event_delivered,
        inTransitDate: row.event_intransit || null,  // When carrier picked up
        transitTimeDays: row.transit_time_days || null,  // Stored transit time for delivered
        fcName: row.fc_name || '',
        storeOrderId: order?.store_order_id || '',
        channelName: row.application_name || order?.application_name || order?.channel_name || '',
        estimatedFulfillmentStatus: row.estimated_fulfillment_date_status || '',
        // Additional columns
        orderDate: order?.purchase_date || null,
        destCountry: row.destination_country || '',
        shipOption: row.carrier_service || '',
        // Computed field for export
        age: age,
        // Client identification (for admin badge)
        clientId: row.client_id || null,
        // Voided status (duplicate shipping transaction that was recreated)
        isVoided: isVoided || false,
        // Claim eligibility status (for At Risk / File a Claim badges)
        claimEligibilityStatus: claimEligibilityMap[row.shipment_id]?.status || null,
        claimDaysRemaining: claimEligibilityMap[row.shipment_id]?.daysRemaining || null,
        // TrackingMore substatus for granular tracking status
        claimSubstatusCategory: claimEligibilityMap[row.shipment_id]?.substatusCategory || null,
        claimLastScanDescription: claimEligibilityMap[row.shipment_id]?.lastScanDescription || null,
        claimLastScanDate: claimEligibilityMap[row.shipment_id]?.lastScanDate || null,
        // Claim ticket info (for filed claims - overrides eligibility status in UI)
        claimTicketNumber: claimTicketMap[row.shipment_id]?.ticketNumber || null,
        claimTicketStatus: claimTicketMap[row.shipment_id]?.status || null,
        claimCreditAmount: claimTicketMap[row.shipment_id]?.creditAmount || null,
        // Export-only fields (invoice format)
        ...(isExport ? {
          merchantId: clientInfoMap[row.client_id]?.merchantId || '',
          merchantName: clientInfoMap[row.client_id]?.merchantName || '',
          transactionDate: row.event_labeled || null,
          transactionType: billingExportMap[row.tracking_id]?.transactionType || '',
          baseCharge: billingExportMap[row.tracking_id]?.baseCharge ?? null,
          surchargeAmount: billingExportMap[row.tracking_id]?.surchargeAmount ?? null,
          insuranceCharge: insuranceMap[row.shipment_id] || null,
          productsSold: productsSoldMap[row.shipment_id] || '',
          shipOptionId: row.ship_option_id || '',
          zone: row.zone_used || '',
          actualWeightOz: row.actual_weight_oz || '',
          dimWeightOz: row.dim_weight_oz || '',
          billableWeightOz: row.billable_weight_oz || '',
          lengthIn: row.length || '',
          widthIn: row.width || '',
          heightIn: row.height || '',
          zipCode: order?.zip_code || '',
          city: order?.city || '',
          state: order?.state || '',
        } : {}),
      }
    })

    // Note: Status filtering is now done at the database level (see above)
    // Age filtering is also done above with the special two-pass approach

    // =========================================================================
    // Get ALL unique carriers from the entire dataset (not just current page)
    // OPTIMIZATION: Use materialized view for instant lookup (<1ms vs 114ms)
    // Falls back to shipments table query if view doesn't exist
    // =========================================================================
    let allCarriers: string[] = []
    try {
      // Try materialized view first (instant query)
      if (clientId) {
        // Per-client carriers from materialized view
        const { data: viewData, error: viewError } = await supabase
          .from('carrier_options_by_client')
          .select('carrier')
          .eq('client_id', clientId)

        if (!viewError && viewData) {
          allCarriers = viewData.map((r: { carrier: string }) => r.carrier).filter(Boolean).sort()
        } else {
          // View doesn't exist yet - fall back to current page carriers
          // (This avoids the slow 114ms query until the view is created)
          console.log('[Carriers] Materialized view not available, using current page carriers')
          allCarriers = [...new Set(shipments.map((s: any) => s.carrier).filter(Boolean))].sort() as string[]
        }
      } else {
        // Admin viewing all clients - use the all-carriers view
        const { data: viewData, error: viewError } = await supabase
          .from('carrier_options_all')
          .select('carrier')

        if (!viewError && viewData) {
          allCarriers = viewData.map((r: { carrier: string }) => r.carrier).filter(Boolean).sort()
        } else {
          // View doesn't exist yet - fall back to current page carriers
          console.log('[Carriers] Materialized view not available, using current page carriers')
          allCarriers = [...new Set(shipments.map((s: any) => s.carrier).filter(Boolean))].sort() as string[]
        }
      }
    } catch (err) {
      console.error('Error fetching carriers:', err)
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
  deliveredDate?: string | null,
  eventPicked?: string | null,
  eventPacked?: string | null,
  eventInTransit?: string | null
): string {
  if (deliveredDate) {
    return 'Delivered'
  }

  // Check status_details FIRST for tracking updates (InTransit, OutForDelivery, etc.)
  // These are more authoritative than event timestamps for carrier tracking status
  if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
    const trackingStatus = statusDetails[0]?.name
    if (trackingStatus) {
      // Tracking updates take priority
      switch (trackingStatus) {
        case 'Delivered': return 'Delivered'
        case 'OutForDelivery': return 'Out for Delivery'
        case 'InTransit': return 'In Transit'
        case 'DeliveryException': return 'Exception'
        case 'DeliveryAttemptFailed': return 'Delivery Attempted'
      }
    }
  }

  // Also check event_intransit timestamp - if we have it, we're in transit
  if (eventInTransit) {
    return 'In Transit'
  }

  // Check event timestamps for fulfillment progress (most specific first)
  // These are more reliable than the raw status field for in-progress shipments
  if (shippedDate) {
    return 'Awaiting Carrier'
  }
  if (eventPacked) {
    return 'Packed'
  }
  if (eventPicked) {
    return 'Picked'
  }

  // Check status_details for hold reasons and fulfillment progress
  if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
    const trackingStatus = statusDetails[0]?.name
    const trackingDescription = statusDetails[0]?.description

    if (trackingStatus) {
      switch (trackingStatus) {
        case 'AwaitingCarrierScan': return 'Awaiting Carrier'
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
      case 'Completed': return 'Awaiting Carrier'
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
    return 'Awaiting Carrier'
  }

  if (efdStatus) {
    switch (efdStatus) {
      case 'FulfilledOnTime':
      case 'FulfilledLate':
        return shippedDate ? 'Awaiting Carrier' : 'Pending'
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
