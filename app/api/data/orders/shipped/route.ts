import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

// Default client ID for development (Henson Shaving)
const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

/**
 * GET /api/data/orders/shipped
 * Returns orders that HAVE been shipped (status = 'Fulfilled')
 * Joins with shipments to get tracking/carrier info
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

  try {
    // Build query for shipped orders (status = 'Fulfilled')
    let query = supabase
      .from('orders')
      .select(`
        id,
        shipbob_order_id,
        store_order_id,
        customer_name,
        status,
        order_type
      `, { count: 'exact' })
      .eq('status', 'Fulfilled')

    // Only filter by client_id if not viewing all brands
    if (clientId) {
      query = query.eq('client_id', clientId)
    }

    const { data: ordersData, error: ordersError, count } = await query
      .order('order_import_date', { ascending: false })
      .range(offset, offset + limit - 1)

    if (ordersError) {
      console.error('Error fetching shipped orders:', ordersError)
      return NextResponse.json({ error: ordersError.message }, { status: 500 })
    }

    // Get order IDs
    const orderIds = (ordersData || []).map((o: any) => o.id)

    // Get shipments for these orders (to get tracking info)
    let shipmentsMap: Record<string, any> = {}
    if (orderIds.length > 0) {
      const { data: shipmentsData } = await supabase
        .from('shipments')
        .select(`
          order_id,
          tracking_id,
          carrier,
          carrier_service,
          shipped_date,
          event_delivered,
          status,
          status_details,
          invoice_amount
        `)
        .in('order_id', orderIds)

      if (shipmentsData) {
        // Group by order_id, take the most recent shipment per order
        for (const shipment of shipmentsData) {
          if (!shipmentsMap[shipment.order_id]) {
            shipmentsMap[shipment.order_id] = shipment
          }
        }
      }
    }

    // Get item counts for each shipment
    let itemCounts: Record<string, number> = {}
    const shipmentIds = Object.values(shipmentsMap)
      .filter((s: any) => s.tracking_id)
      .map((s: any) => s.tracking_id)

    if (shipmentIds.length > 0) {
      const { data: itemData } = await supabase
        .from('order_items')
        .select('order_id')
        .in('order_id', orderIds)

      if (itemData) {
        itemCounts = itemData.reduce((acc: Record<string, number>, item: any) => {
          acc[item.order_id] = (acc[item.order_id] || 0) + 1
          return acc
        }, {})
      }
    }

    // Map to response format
    const orders = (ordersData || []).map((order: any) => {
      const shipment = shipmentsMap[order.id] || {}
      return {
        id: order.id,
        orderId: order.shipbob_order_id || '',
        storeOrderId: order.store_order_id || '',
        customerName: order.customer_name || 'Unknown',
        status: getShipmentStatus(shipment),
        carrier: shipment.carrier || '',
        carrierService: shipment.carrier_service || '',
        trackingId: shipment.tracking_id || '',
        shippedDate: shipment.shipped_date,
        deliveredDate: shipment.event_delivered,
        itemCount: itemCounts[order.id] || 1,
        charge: shipment.invoice_amount || 0,  // TODO: Should use billed_amount from transactions table
      }
    })

    return NextResponse.json({
      data: orders,
      totalCount: count || 0,
      hasMore: (offset + limit) < (count || 0),
    })
  } catch (err) {
    console.error('Shipped orders API error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Extract shipment status from shipment data
function getShipmentStatus(shipment: any): string {
  // Check status_details for tracking info (most specific)
  if (shipment.status_details && Array.isArray(shipment.status_details) && shipment.status_details.length > 0) {
    const trackingStatus = shipment.status_details[0]?.name
    if (trackingStatus) {
      switch (trackingStatus) {
        case 'Delivered':
          return 'Delivered'
        case 'InTransit':
          return 'In Transit'
        case 'OutForDelivery':
          return 'Out for Delivery'
        case 'DeliveryException':
          return 'Exception'
        case 'DeliveryAttemptFailed':
          return 'Delivery Attempted'
      }
    }
  }

  // Use main shipment status
  if (shipment.status) {
    switch (shipment.status) {
      case 'Completed':
        return 'Delivered'
      case 'LabeledCreated':
        return 'Labelled'
      default:
        return shipment.status
    }
  }

  return 'Shipped'
}
