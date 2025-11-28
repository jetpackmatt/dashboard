import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Default client ID for development (Henson Shaving)
const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

export async function GET(request: NextRequest) {
  // Use admin client to bypass RLS (API route is server-side only)
  const supabase = createAdminClient()

  // Get query params
  const searchParams = request.nextUrl.searchParams
  const clientId = searchParams.get('clientId') || DEFAULT_CLIENT_ID
  const limit = parseInt(searchParams.get('limit') || '50')
  const offset = parseInt(searchParams.get('offset') || '0')

  try {
    // Query shipments (without FK join - we'll do manual join)
    const { data: shipmentsData, error: shipmentsError, count } = await supabase
      .from('shipments')
      .select(`
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
        shipped_date,
        delivered_date,
        estimated_fulfillment_date,
        estimated_fulfillment_date_status,
        label_generation_date,
        fc_name,
        invoice_amount
      `, { count: 'exact' })
      .eq('client_id', clientId)
      .order('label_generation_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (shipmentsError) {
      console.error('Error fetching shipments:', shipmentsError)
      return NextResponse.json({ error: shipmentsError.message }, { status: 500 })
    }

    // Get unique order_ids from shipments
    const orderIds = [...new Set((shipmentsData || []).map((s: any) => s.order_id).filter(Boolean))]

    // Fetch orders data separately
    let ordersMap: Record<string, any> = {}
    if (orderIds.length > 0) {
      const { data: ordersData } = await supabase
        .from('orders')
        .select(`
          id,
          shipbob_order_id,
          store_order_id,
          customer_name,
          order_import_date,
          status,
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
    }

    // Map to DataTable format
    const shipments = (shipmentsData || []).map((row: any) => {
      const order = ordersMap[row.order_id] || null
      const shipmentStatus = getShipmentStatus(row.status, row.estimated_fulfillment_date_status, row.status_details)

      return {
        id: row.id,
        // Use ShipBob order ID for display
        orderId: row.shipbob_order_id || order?.shipbob_order_id || '',
        status: shipmentStatus,
        // Use recipient name from shipment or customer name from order
        customerName: row.recipient_name || order?.customer_name || 'Unknown',
        orderType: order?.order_type || 'DTC',
        // Count of items in shipment
        qty: itemCounts[row.shipment_id] || 1,
        // Invoice amount if available
        cost: row.invoice_amount || 0,
        // Order import date
        importDate: order?.order_import_date || row.label_generation_date || new Date().toISOString(),
        // Estimated fulfillment date (SLA)
        slaDate: row.estimated_fulfillment_date || null,
        // Extended fields
        trackingId: row.tracking_id || '',
        carrier: row.carrier || '',
        carrierService: row.carrier_service || '',
        shippedDate: row.shipped_date,
        deliveredDate: row.delivered_date,
        fcName: row.fc_name || '',
        storeOrderId: order?.store_order_id || '',
        channelName: order?.channel_name || '',
        estimatedFulfillmentStatus: row.estimated_fulfillment_date_status || '',
      }
    })

    return NextResponse.json({
      data: shipments,
      totalCount: count || 0,
      hasMore: (offset + limit) < (count || 0),
    })
  } catch (err) {
    console.error('Shipments API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Extract shipment status - combines status, status_details (tracking), and EFD status
function getShipmentStatus(status?: string, efdStatus?: string, statusDetails?: any[]): string {
  // First check status_details for tracking info (most specific)
  if (statusDetails && Array.isArray(statusDetails) && statusDetails.length > 0) {
    const trackingStatus = statusDetails[0]?.name
    if (trackingStatus) {
      switch (trackingStatus) {
        case 'Delivered':
          return 'Delivered'
        case 'InTransit':
          return 'In Transit'
        case 'OutForDelivery':
          return 'Out for Delivery'
        case 'DeliveryException':
        case 'DeliveryAttemptFailed':
          return 'Delivery Exception'
        // Skip "Processing" - it's not a useful tracking status
      }
    }
  }

  // Then use main shipment status
  if (status) {
    switch (status) {
      case 'Completed':
        return 'Delivered'
      case 'LabeledCreated':
        return 'Labelled'
      case 'Cancelled':
        return 'Cancelled'
      case 'Exception':
        // Check EFD status for more context on exceptions
        if (efdStatus === 'AwaitingInventoryAllocation') {
          return 'Out of Stock'
        }
        return 'Exception'
      case 'Processing':
        // Check EFD for more specific status
        if (efdStatus === 'AwaitingInventoryAllocation') {
          return 'Out of Stock'
        }
        return 'Awaiting Pick'
      default:
        return status
    }
  }

  // Finally, use estimated_fulfillment_date_status for context
  if (efdStatus) {
    switch (efdStatus) {
      case 'FulfilledOnTime':
      case 'FulfilledLate':
        return 'Delivered'
      case 'AwaitingInventoryAllocation':
        return 'Out of Stock'
      case 'PendingOnTime':
      case 'PendingLate':
        return 'Awaiting Pick'
      case 'Unavailable':
        return 'Unavailable'
      default:
        return efdStatus
    }
  }

  return 'Pending'
}
