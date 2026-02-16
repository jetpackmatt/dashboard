import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

/**
 * GET /api/data/shipments/resolve?q=<input>&clientId=<optional>
 *
 * Multi-format shipment resolution: accepts a Shipment ID, ShipBob Order ID,
 * or store order number, and resolves it to a shipment record.
 *
 * Resolution order:
 * 1. shipment_id (most common)
 * 2. shipbob_order_id → most recent shipment
 * 3. store_order_id (via orders table) → most recent shipment
 *
 * Returns the resolved shipment with its shipment_id for downstream use.
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const input = searchParams.get('q')?.trim()
  const requestedClientId = searchParams.get('clientId')

  if (!input) {
    return NextResponse.json({ error: 'Query parameter "q" is required' }, { status: 400 })
  }

  // Verify access
  let clientId: string | null
  try {
    const access = await verifyClientAccess(requestedClientId)
    clientId = access.requestedClientId
  } catch (error) {
    return handleAccessError(error)
  }

  const supabase = createAdminClient()

  try {
    // 1. Try as shipment_id
    let query = supabase
      .from('shipments')
      .select('shipment_id, shipbob_order_id, client_id, tracking_id, carrier, ship_option_name')
      .eq('shipment_id', input)
    if (clientId) query = query.eq('client_id', clientId)

    const { data: byShipment } = await query.maybeSingle()
    if (byShipment) {
      return NextResponse.json({
        found: true,
        shipmentId: byShipment.shipment_id,
        orderId: byShipment.shipbob_order_id,
        trackingId: byShipment.tracking_id,
        carrier: byShipment.carrier,
        shipOption: byShipment.ship_option_name,
        resolvedVia: 'shipment_id',
      })
    }

    // 2. Try as shipbob_order_id → find most recent shipment for that order
    let orderQuery = supabase
      .from('shipments')
      .select('shipment_id, shipbob_order_id, client_id, tracking_id, carrier, ship_option_name')
      .eq('shipbob_order_id', input)
      .order('created_date', { ascending: false })
    if (clientId) orderQuery = orderQuery.eq('client_id', clientId)

    const { data: byOrder } = await orderQuery.limit(1)
    if (byOrder && byOrder.length > 0) {
      return NextResponse.json({
        found: true,
        shipmentId: byOrder[0].shipment_id,
        orderId: byOrder[0].shipbob_order_id,
        trackingId: byOrder[0].tracking_id,
        carrier: byOrder[0].carrier,
        shipOption: byOrder[0].ship_option_name,
        resolvedVia: 'order_id',
      })
    }

    // 3. Try as store_order_id → resolve via orders table
    let storeQuery = supabase
      .from('orders')
      .select('shipbob_order_id')
      .eq('store_order_id', input)
    if (clientId) storeQuery = storeQuery.eq('client_id', clientId)

    const { data: storeResult } = await storeQuery.limit(1)
    if (storeResult && storeResult.length > 0) {
      const sbOrderId = storeResult[0].shipbob_order_id
      let shipQuery = supabase
        .from('shipments')
        .select('shipment_id, shipbob_order_id, client_id, tracking_id, carrier, ship_option_name')
        .eq('shipbob_order_id', sbOrderId)
        .order('created_date', { ascending: false })
      if (clientId) shipQuery = shipQuery.eq('client_id', clientId)

      const { data: shipment } = await shipQuery.limit(1)
      if (shipment && shipment.length > 0) {
        return NextResponse.json({
          found: true,
          shipmentId: shipment[0].shipment_id,
          orderId: shipment[0].shipbob_order_id,
          trackingId: shipment[0].tracking_id,
          carrier: shipment[0].carrier,
          shipOption: shipment[0].ship_option_name,
          resolvedVia: 'store_order_id',
        })
      }
    }

    // Not found by any method
    return NextResponse.json({ found: false }, { status: 404 })
  } catch (err) {
    console.error('Shipment resolve error:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
