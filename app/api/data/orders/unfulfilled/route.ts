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

  try {
    // Query shipments that haven't been shipped yet (no fees assigned)
    // These are shipments where shipped_date IS NULL and status is not Cancelled
    let query = supabase
      .from('shipments')
      .select(`
        id,
        shipment_id,
        shipbob_order_id,
        order_id,
        status,
        estimated_fulfillment_date,
        estimated_fulfillment_date_status,
        status_details,
        label_generation_date,
        recipient_name,
        carrier_service,
        fc_name,
        client_id
      `, { count: 'exact' })
      .is('shipped_date', null) // No fees assigned yet
      .neq('status', 'Cancelled') // Exclude cancelled

    // Only filter by client_id if not viewing all brands
    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    // Apply status filter if provided (matches our derived status names)
    // We'll filter after deriving statuses since they're computed

    // Order by label generation date (most recent first) and paginate
    const { data: shipmentsData, error: shipmentsError, count } = await query
      .order('label_generation_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (shipmentsError) {
      console.error('Error fetching unfulfilled shipments:', shipmentsError)
      return NextResponse.json({ error: shipmentsError.message }, { status: 500 })
    }

    // Get order details for these shipments (for customer name, store order ID)
    const orderIds = [...new Set((shipmentsData || []).map((s: any) => s.order_id).filter(Boolean))]
    let ordersMap: Record<string, any> = {}

    if (orderIds.length > 0) {
      const { data: ordersData } = await supabase
        .from('orders')
        .select(`
          id,
          store_order_id,
          customer_name,
          order_import_date,
          order_type,
          channel_name
        `)
        .in('id', orderIds)

      if (ordersData) {
        ordersMap = ordersData.reduce((acc: Record<string, any>, order: any) => {
          acc[order.id] = order
          return acc
        }, {})
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
      const order = ordersMap[shipment.order_id] || {}
      const derivedStatus = deriveGranularStatus(shipment)

      return {
        id: shipment.id,
        orderId: shipment.shipbob_order_id || '',
        storeOrderId: order.store_order_id || '',
        customerName: shipment.recipient_name || order.customer_name || 'Unknown',
        status: derivedStatus,
        orderDate: order.order_import_date || shipment.label_generation_date,
        slaDate: shipment.estimated_fulfillment_date,
        itemCount: itemCounts[shipment.shipment_id] || 1,
        orderType: order.order_type || 'DTC',
        channelName: order.channel_name || '',
        carrierService: shipment.carrier_service || '',
        fcName: shipment.fc_name || '',
      }
    })

    // Apply status filter if provided (filter on derived status)
    let filteredShipments = shipments
    if (statusFilter) {
      const statuses = statusFilter.split(',').map(s => s.trim().toLowerCase())
      filteredShipments = shipments.filter((s: any) =>
        statuses.some(status => s.status.toLowerCase().includes(status))
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
 * Derive a granular, human-readable status from shipment fields
 */
function deriveGranularStatus(shipment: any): string {
  const status = shipment.status
  const efdStatus = shipment.estimated_fulfillment_date_status
  const statusDetails = shipment.status_details

  // Check status_details first for specific exceptions
  if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
    const detailName = statusDetails[0]?.name
    if (detailName === 'OutOfStock') {
      return 'Out of Stock'
    }
    if (detailName === 'AddressValidationFailed') {
      return 'Address Issue'
    }
    if (detailName === 'OnHold') {
      return 'On Hold'
    }
  }

  // Check EFD status for inventory issues
  if (efdStatus === 'AwaitingInventoryAllocation') {
    return 'Out of Stock'
  }

  // Check main status
  if (status === 'Exception') {
    return 'Exception'
  }

  if (status === 'Processing') {
    // Check if label has been created
    if (shipment.label_generation_date) {
      // Has label, waiting to be picked/shipped
      if (efdStatus === 'PendingLate') {
        return 'Awaiting Pick (Late)'
      }
      return 'Awaiting Pick'
    }
    // No label yet
    return 'Processing'
  }

  // Fallback
  return status || 'Pending'
}
