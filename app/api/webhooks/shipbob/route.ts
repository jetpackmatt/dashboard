import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'

/**
 * ShipBob Webhook Receiver
 *
 * Receives real-time status updates from ShipBob for shipments and returns.
 * Webhooks are automatically registered when a client's API token is saved.
 *
 * Supported topics (2025-07 API):
 *
 * Shipment topics:
 * - order.shipped: Label purchased, printed, and scanned
 * - order.shipment.delivered: Shipment reached customer
 * - order.shipment.exception: Issues like out-of-stock
 * - order.shipment.on_hold: Missing information
 * - order.shipment.cancelled: Shipment cancelled
 *
 * Return topics:
 * - return.created: Return request initiated
 * - return.updated: Return modified
 * - return.completed: Return completed
 *
 * Headers from ShipBob:
 * - x-webhook-topic: The event topic
 * - webhook-timestamp: Event timestamp
 * - webhook-signature: HMAC signature for verification
 * - webhook-id: Unique webhook event ID
 */

// Map ShipBob shipment webhook topics to our status values
const SHIPMENT_TOPIC_TO_STATUS: Record<string, string> = {
  'order.shipped': 'Shipped',
  'order.shipment.delivered': 'Completed',
  'order.shipment.exception': 'Exception',
  'order.shipment.on_hold': 'OnHold',
  'order.shipment.cancelled': 'Cancelled',
}

// Map ShipBob return webhook topics to our status values
const RETURN_TOPIC_TO_STATUS: Record<string, string> = {
  'return.created': 'Created',
  'return.updated': 'Updated',
  'return.completed': 'Completed',
}

// All supported topics
const ALL_TOPICS = [
  ...Object.keys(SHIPMENT_TOPIC_TO_STATUS),
  ...Object.keys(RETURN_TOPIC_TO_STATUS),
]

/**
 * Fetch a shipment from ShipBob API and upsert it to our database.
 * Used when we receive a webhook for a shipment that doesn't exist yet.
 */
async function fetchAndUpsertShipment(
  supabase: ReturnType<typeof createAdminClient>,
  shipmentId: string
): Promise<{ success: boolean; clientId?: string; error?: string }> {
  const token = process.env.SHIPBOB_API_TOKEN
  if (!token) {
    return { success: false, error: 'No API token configured' }
  }

  try {
    // Fetch orders containing this shipment
    const response = await fetch(
      `${SHIPBOB_API_BASE}/order?ShipmentId=${shipmentId}&Limit=1`,
      { headers: { Authorization: `Bearer ${token}` } }
    )

    if (!response.ok) {
      return { success: false, error: `API error: ${response.status}` }
    }

    const orders = await response.json()
    if (!Array.isArray(orders) || orders.length === 0) {
      return { success: false, error: 'Order not found in ShipBob' }
    }

    const order = orders[0]
    const shipment = order.shipments?.find((s: { id: number }) => s.id.toString() === shipmentId)

    if (!shipment) {
      return { success: false, error: 'Shipment not found in order' }
    }

    // Find which client this order belongs to by matching channel_id
    const channelId = order.channel?.id
    let clientId: string | null = null
    let merchantId: string | null = null

    if (channelId) {
      const { data: client } = await supabase
        .from('clients')
        .select('id, merchant_id')
        .eq('shipbob_channel_id', channelId)
        .single()

      if (client) {
        clientId = client.id
        merchantId = client.merchant_id
      }
    }

    // If no client found by channel, try to find by existing order
    if (!clientId) {
      const { data: existingOrder } = await supabase
        .from('orders')
        .select('client_id, merchant_id')
        .eq('shipbob_order_id', order.id.toString())
        .single()

      if (existingOrder) {
        clientId = existingOrder.client_id
        merchantId = existingOrder.merchant_id
      }
    }

    if (!clientId) {
      return { success: false, error: 'Could not determine client for shipment' }
    }

    // First ensure the order exists
    const orderRecord = {
      client_id: clientId,
      merchant_id: merchantId,
      shipbob_order_id: order.id.toString(),
      store_order_id: order.order_number || null,
      customer_name: order.recipient?.name || null,
      order_import_date: order.created_date || null,
      status: order.status || null,
      address1: order.recipient?.address?.address1 || null,
      city: order.recipient?.address?.city || null,
      state: order.recipient?.address?.state || null,
      zip_code: order.recipient?.address?.zip_code || null,
      country: order.recipient?.address?.country || null,
      customer_email: order.recipient?.email || null,
      total_shipments: order.shipments?.length || 1,
      order_type: order.type || null,
      channel_id: order.channel?.id || null,
      channel_name: order.channel?.name || null,
      updated_at: new Date().toISOString(),
    }

    const { error: orderError } = await supabase
      .from('orders')
      .upsert(orderRecord, { onConflict: 'client_id,shipbob_order_id' })

    if (orderError) {
      console.error('[Webhook] Failed to upsert order:', orderError)
    }

    // Get the order ID
    const { data: orderRow } = await supabase
      .from('orders')
      .select('id')
      .eq('client_id', clientId)
      .eq('shipbob_order_id', order.id.toString())
      .single()

    const orderId = orderRow?.id || null

    // Now upsert the shipment
    const shipmentRecord = {
      client_id: clientId,
      merchant_id: merchantId,
      order_id: orderId,
      shipment_id: shipment.id.toString(),
      shipbob_order_id: order.id.toString(),
      tracking_id: shipment.tracking?.tracking_number || null,
      tracking_url: shipment.tracking?.tracking_url || null,
      status: shipment.status || null,
      recipient_name: shipment.recipient?.name || order.recipient?.name || null,
      recipient_email: shipment.recipient?.email || order.recipient?.email || null,
      label_generation_date: shipment.created_date || null,
      shipped_date: shipment.actual_fulfillment_date || null,
      delivered_date: shipment.delivery_date || null,
      carrier: shipment.tracking?.carrier || null,
      carrier_service: shipment.ship_option || null,
      fc_name: shipment.location?.name || null,
      actual_weight_oz: shipment.measurements?.total_weight_oz || null,
      estimated_fulfillment_date: shipment.estimated_fulfillment_date || null,
      estimated_fulfillment_date_status: shipment.estimated_fulfillment_date_status || null,
      invoice_amount: shipment.invoice?.amount || null,
      status_details: shipment.status_details || null,
      updated_at: new Date().toISOString(),
    }

    const { error: shipmentError } = await supabase
      .from('shipments')
      .upsert(shipmentRecord, { onConflict: 'shipment_id' })

    if (shipmentError) {
      return { success: false, error: shipmentError.message }
    }

    return { success: true, clientId }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

export async function POST(request: NextRequest) {
  const supabase = createAdminClient()

  try {
    // Get webhook headers
    const topic = request.headers.get('x-webhook-topic') || ''
    const webhookId = request.headers.get('webhook-id') || ''
    const timestamp = request.headers.get('webhook-timestamp') || ''
    const signature = request.headers.get('webhook-signature') || ''

    // Parse request body
    const payload = await request.json()

    // Log the webhook event for debugging
    console.log(`[Webhook] Received ${topic}`, {
      webhookId,
      timestamp,
      hasSignature: !!signature,
      payloadKeys: Object.keys(payload),
    })

    // Determine if this is a shipment or return topic
    const isShipmentTopic = topic in SHIPMENT_TOPIC_TO_STATUS
    const isReturnTopic = topic in RETURN_TOPIC_TO_STATUS

    if (!isShipmentTopic && !isReturnTopic) {
      console.warn(`[Webhook] Unknown topic: ${topic}`)
      return NextResponse.json({ received: true, warning: `Unknown topic: ${topic}` })
    }

    // Handle shipment webhooks
    if (isShipmentTopic) {
      const newStatus = SHIPMENT_TOPIC_TO_STATUS[topic]

      // Extract shipment ID from payload
      const shipmentId = payload.shipment_id
        || payload.id
        || payload.shipment?.id
        || payload.data?.shipment_id
        || payload.data?.id

      if (!shipmentId) {
        console.warn('[Webhook] No shipment ID found in payload:', JSON.stringify(payload).slice(0, 500))
        return NextResponse.json({ received: true, warning: 'No shipment ID found' })
      }

      // Update shipment status in database
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('shipments')
        .update({
          status: newStatus,
          // Update status_details if provided in payload
          ...(payload.status_details && { status_details: payload.status_details }),
          // Update tracking info if provided
          ...(payload.tracking && {
            tracking_id: payload.tracking.tracking_number,
            carrier: payload.tracking.carrier,
          }),
          // Update delivery date for delivered events
          ...(topic === 'order.shipment.delivered' && {
            delivered_date: payload.delivered_at || payload.delivery_date || new Date().toISOString()
          }),
          // Update shipped date for shipped events
          ...(topic === 'order.shipped' && {
            shipped_date: payload.shipped_at || payload.ship_date || new Date().toISOString()
          }),
          updated_at: new Date().toISOString(),
        })
        .eq('shipment_id', shipmentId)
        .select('id, shipment_id, status')

      if (error) {
        console.error('[Webhook] Failed to update shipment:', error)
        return NextResponse.json({
          received: true,
          error: 'Failed to update shipment',
          shipmentId
        })
      }

      if (!data || data.length === 0) {
        // Shipment not in our database - try to fetch from ShipBob API and create it
        console.log(`[Webhook] Shipment ${shipmentId} not in database, fetching from API...`)

        const fetchResult = await fetchAndUpsertShipment(supabase, shipmentId)

        if (fetchResult.success) {
          // Now apply the webhook update
          const { error: retryError } = await supabase
            .from('shipments')
            .update({
              status: newStatus,
              ...(payload.status_details && { status_details: payload.status_details }),
              ...(payload.tracking && {
                tracking_id: payload.tracking.tracking_number,
                carrier: payload.tracking.carrier,
              }),
              ...(topic === 'order.shipment.delivered' && {
                delivered_date: payload.delivered_at || payload.delivery_date || new Date().toISOString()
              }),
              ...(topic === 'order.shipped' && {
                shipped_date: payload.shipped_at || payload.ship_date || new Date().toISOString()
              }),
              updated_at: new Date().toISOString(),
            })
            .eq('shipment_id', shipmentId)

          if (retryError) {
            console.error('[Webhook] Failed to update newly created shipment:', retryError)
          }

          console.log(`[Webhook] Created shipment ${shipmentId} from API, updated to status: ${newStatus}`)
          return NextResponse.json({
            received: true,
            created: true,
            updated: true,
            shipmentId,
            newStatus,
            clientId: fetchResult.clientId,
          })
        } else {
          console.warn(`[Webhook] Could not fetch shipment ${shipmentId}: ${fetchResult.error}`)
          return NextResponse.json({
            received: true,
            warning: `Shipment not found: ${fetchResult.error}`,
            shipmentId
          })
        }
      }

      console.log(`[Webhook] Updated shipment ${shipmentId} to status: ${newStatus}`)
      return NextResponse.json({
        received: true,
        updated: true,
        shipmentId,
        newStatus,
      })
    }

    // Handle return webhooks
    if (isReturnTopic) {
      const newStatus = RETURN_TOPIC_TO_STATUS[topic]

      // Extract return ID from payload
      const returnId = payload.return_id
        || payload.id
        || payload.return?.id
        || payload.data?.return_id
        || payload.data?.id

      if (!returnId) {
        console.warn('[Webhook] No return ID found in payload:', JSON.stringify(payload).slice(0, 500))
        return NextResponse.json({ received: true, warning: 'No return ID found' })
      }

      // Try to update return status in database
      // Note: returns table uses different column names than shipments
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('returns')
          .update({
            status: newStatus,
            ...(topic === 'return.completed' && {
              completed_date: payload.completed_at || new Date().toISOString()
            }),
            synced_at: new Date().toISOString(),
          })
          .eq('shipbob_return_id', returnId.toString())
          .select('id, shipbob_return_id, status')

        if (error) {
          // Table might not exist yet
          console.warn('[Webhook] Failed to update return (table may not exist):', error.message)
          return NextResponse.json({
            received: true,
            warning: 'Returns table not ready',
            returnId,
            newStatus,
          })
        }

        if (!data || data.length === 0) {
          console.warn(`[Webhook] Return ${returnId} not found in database`)
          return NextResponse.json({
            received: true,
            warning: 'Return not found',
            returnId
          })
        }

        console.log(`[Webhook] Updated return ${returnId} to status: ${newStatus}`)
        return NextResponse.json({
          received: true,
          updated: true,
          returnId,
          newStatus,
        })
      } catch (returnErr) {
        console.warn('[Webhook] Error processing return webhook:', returnErr)
        return NextResponse.json({
          received: true,
          warning: 'Returns processing not available',
          returnId,
        })
      }
    }

    // Fallback (shouldn't reach here)
    return NextResponse.json({ received: true })

  } catch (err) {
    console.error('[Webhook] Error processing webhook:', err)
    // Return 200 to prevent retries - log the error for debugging
    return NextResponse.json({
      received: true,
      error: err instanceof Error ? err.message : 'Unknown error'
    })
  }
}

// Health check / verification endpoint
export async function GET() {
  return NextResponse.json({
    status: 'ok',
    endpoint: '/api/webhooks/shipbob',
    supportedTopics: ALL_TOPICS,
  })
}
