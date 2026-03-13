import {
  createAdminClient,
  verifyClientAccess,
  handleAccessError,
} from '@/lib/supabase/admin'
import { ShipBobClient } from '@/lib/shipbob/client'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/data/shipments/[id]/cancel
 * Cancel an unfulfilled shipment via the ShipBob API.
 * Only works for shipments that haven't been labeled/picked yet.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = createAdminClient()
  const { id } = await params

  if (!id) {
    return NextResponse.json({ error: 'Shipment ID is required' }, { status: 400 })
  }

  try {
    // Fetch shipment with order ID and check it's unfulfilled
    const { data: shipment, error: checkError } = await supabase
      .from('shipments')
      .select('client_id, shipbob_order_id, event_labeled, status')
      .eq('shipment_id', id)
      .single()

    if (checkError || !shipment) {
      return NextResponse.json({ error: 'Shipment not found' }, { status: 404 })
    }

    // Verify access
    try {
      await verifyClientAccess(shipment.client_id)
    } catch (error) {
      return handleAccessError(error)
    }

    // Only allow cancellation for unfulfilled shipments (no label created)
    if (shipment.event_labeled) {
      return NextResponse.json(
        { error: 'Cannot cancel a shipment that has already been labeled/shipped' },
        { status: 400 }
      )
    }

    if (shipment.status === 'Cancelled') {
      return NextResponse.json(
        { error: 'Shipment is already cancelled' },
        { status: 400 }
      )
    }

    if (!shipment.shipbob_order_id) {
      return NextResponse.json(
        { error: 'No ShipBob order ID found for this shipment' },
        { status: 400 }
      )
    }

    // Get the client's child API token for ShipBob
    const { data: credentials } = await supabase
      .from('client_api_credentials')
      .select('api_token')
      .eq('client_id', shipment.client_id)
      .eq('provider', 'shipbob')
      .single()

    if (!credentials?.api_token) {
      return NextResponse.json(
        { error: 'No API credentials found for this client' },
        { status: 500 }
      )
    }

    // Call ShipBob cancel API
    const client = new ShipBobClient(credentials.api_token)
    const orderId = parseInt(shipment.shipbob_order_id, 10)

    if (isNaN(orderId)) {
      return NextResponse.json(
        { error: 'Invalid ShipBob order ID' },
        { status: 400 }
      )
    }

    try {
      await client.orders.cancelOrder(orderId)
    } catch (apiError) {
      console.error('ShipBob cancel API error:', apiError)
      return NextResponse.json(
        { error: 'Failed to cancel order with ShipBob. The order may have already been picked.' },
        { status: 400 }
      )
    }

    // Update local DB status
    await supabase
      .from('shipments')
      .update({ status: 'Cancelled' })
      .eq('shipment_id', id)

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('Error in cancel POST:', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
