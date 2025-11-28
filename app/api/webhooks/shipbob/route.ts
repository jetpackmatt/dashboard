import { createAdminClient } from '@/lib/supabase/admin'
import { NextRequest, NextResponse } from 'next/server'

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
        console.warn(`[Webhook] Shipment ${shipmentId} not found in database`)
        return NextResponse.json({
          received: true,
          warning: 'Shipment not found',
          shipmentId
        })
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
      // Note: returns table may not exist yet - gracefully handle this
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (supabase as any)
          .from('returns')
          .update({
            status: newStatus,
            ...(payload.status_details && { status_details: payload.status_details }),
            ...(topic === 'return.completed' && {
              completed_at: payload.completed_at || new Date().toISOString()
            }),
            updated_at: new Date().toISOString(),
          })
          .eq('return_id', returnId)
          .select('id, return_id, status')

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
