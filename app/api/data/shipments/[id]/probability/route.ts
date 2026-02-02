/**
 * API: Get delivery probability for a shipment
 *
 * Returns survival analysis-based delivery probability with risk assessment.
 * Optionally includes AI-generated summary (add ?ai=true to request).
 */

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient, verifyClientAccess, handleAccessError } from '@/lib/supabase/admin'
import {
  calculateDeliveryProbability,
  getProbabilitySummary,
  getRecommendedAction,
} from '@/lib/delivery-intelligence/probability'
import { getCachedSummary, type SummaryContext } from '@/lib/ai/delivery-summary'
import { getCheckpoints } from '@/lib/trackingmore/checkpoint-storage'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: shipmentId } = await params
  const includeAI = request.nextUrl.searchParams.get('ai') === 'true'

  // Get shipment to verify client access
  const supabase = createAdminClient()
  const { data: shipment, error: shipmentError } = await supabase
    .from('shipments')
    .select('client_id, tracking_id, carrier, carrier_service')
    .eq('shipment_id', shipmentId)
    .single()

  if (shipmentError || !shipment) {
    return NextResponse.json(
      { error: 'Shipment not found' },
      { status: 404 }
    )
  }

  // Verify access
  try {
    await verifyClientAccess(shipment.client_id)
  } catch (error) {
    return handleAccessError(error)
  }

  // Calculate probability
  const result = await calculateDeliveryProbability(shipmentId)

  if (!result) {
    return NextResponse.json(
      { error: 'Unable to calculate probability - missing transit data' },
      { status: 400 }
    )
  }

  // Build response
  const response: Record<string, unknown> = {
    shipment_id: shipmentId,
    ...result,
    summary: getProbabilitySummary(result),
    recommended_action: getRecommendedAction(result),
  }

  // Include AI summary if requested
  if (includeAI) {
    // Get checkpoints for context
    const checkpoints = await getCheckpoints(shipmentId)
    const lastCheckpoint = checkpoints.length > 0 ? checkpoints[checkpoints.length - 1] : null

    const context: SummaryContext = {
      shipmentId,
      trackingNumber: shipment.tracking_id,
      carrier: shipment.carrier,
      carrierService: shipment.carrier_service,
      probability: result,
      checkpoints,
      daysInTransit: result.daysInTransit,
      lastCheckpointDescription: lastCheckpoint?.display_title || lastCheckpoint?.raw_description,
      lastCheckpointDate: lastCheckpoint?.checkpoint_date
        ? new Date(lastCheckpoint.checkpoint_date).toLocaleDateString()
        : undefined,
    }

    const aiSummary = await getCachedSummary(context, true)
    response.ai_summary = aiSummary
  }

  return NextResponse.json(response)
}
