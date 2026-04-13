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
    .select('client_id, tracking_id, carrier, carrier_service, event_labeled, event_intransit, event_delivered, destination_country')
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

  // Demo client: synthesize a realistic probability response without survival curves.
  // Demo shipments are excluded from delivery_outcomes / curve computation, so the
  // normal code path would 400. This branch keeps the Delivery IQ drawer working
  // without polluting production ML data.
  const { data: clientRow } = await supabase.from('clients').select('is_demo').eq('id', shipment.client_id).single()
  if (clientRow?.is_demo) {
    const synth = synthesizeDemoProbability(shipment)
    return NextResponse.json({
      shipment_id: shipmentId,
      ...synth,
      summary: demoSummary(synth),
      recommended_action: demoRecommendedAction(synth),
      ai_summary: demoAiSummary(synth, shipment),
    })
  }

  // Calculate probability
  const result = await calculateDeliveryProbability(shipmentId)

  if (!result) {
    // Check if shipment has any tracking data to provide a better error message
    const { data: checkpoints } = await supabase
      .from('tracking_checkpoints')
      .select('raw_description')
      .eq('shipment_id', shipmentId)
      .limit(5)

    const checkpointDescs = checkpoints?.map((c: { raw_description: string }) => c.raw_description.toLowerCase()) || []
    const hasPickupCancelled = checkpointDescs.some((d: string) => d.includes('cancelled') || d.includes('canceled'))

    if (hasPickupCancelled) {
      return NextResponse.json(
        { error: 'Shipment pickup was cancelled - never entered transit', code: 'PICKUP_CANCELLED' },
        { status: 400 }
      )
    }

    return NextResponse.json(
      { error: 'Unable to calculate probability - shipment has not entered transit yet', code: 'NOT_IN_TRANSIT' },
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
  // Skip AI summary for positive terminal states - they don't need merchant advice
  if (includeAI && !result.terminalState?.isPositive) {
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
      terminalState: result.terminalState,
    }

    const aiSummary = await getCachedSummary(context, true)
    response.ai_summary = aiSummary
  }

  return NextResponse.json(response)
}

// ============ Demo-only synthesized probability ============
// Returns a plausible DeliveryProbabilityResult shape for demo shipments
// so the Delivery IQ drawer renders fully, without touching survival curves.
function synthesizeDemoProbability(shipment: {
  tracking_id: string | null
  carrier: string | null
  carrier_service: string | null
  event_labeled: string | null
  event_intransit: string | null
  event_delivered: string | null
  destination_country: string | null
}) {
  const now = Date.now()
  const labeledAt = shipment.event_labeled ? new Date(shipment.event_labeled).getTime() : null
  const daysInTransit = labeledAt ? Math.max(0, Math.floor((now - labeledAt) / 86400_000)) : 0
  const isIntl = shipment.destination_country === 'CA'
  const expected = isIntl ? 6 : 4

  // Already delivered → 100%
  if (shipment.event_delivered) {
    return {
      deliveryProbability: 1,
      stillInTransitProbability: 0,
      daysInTransit,
      expectedDeliveryDay: expected,
      riskLevel: 'low' as const,
      riskFactors: [],
      confidence: 'high' as const,
      sampleSize: 42000,
      segmentUsed: {
        carrier: shipment.carrier || 'Unknown',
        service_bucket: shipment.carrier_service || 'Standard',
        zone_bucket: isIntl ? 'international' : 'zone-4-6',
        season_bucket: 'current',
      },
      percentiles: { p50: expected, p75: expected + 2, p90: expected + 4, p95: expected + 6 },
      terminalState: { isTerminal: true, isPositive: true, reason: 'delivered', probability: 1 },
    }
  }

  // Compute probability decay based on days beyond expected
  const overdue = Math.max(0, daysInTransit - expected)
  const prob =
    overdue < 2 ? 0.92 - overdue * 0.05 :
    overdue < 5 ? 0.72 - (overdue - 2) * 0.08 :
    overdue < 10 ? 0.42 - (overdue - 5) * 0.05 :
    Math.max(0.1, 0.2 - (overdue - 10) * 0.01)

  const risk =
    prob >= 0.75 ? 'low' :
    prob >= 0.5 ? 'medium' :
    prob >= 0.25 ? 'high' : 'critical'

  const riskFactors: string[] = []
  if (overdue > 0) riskFactors.push(`${overdue} day${overdue > 1 ? 's' : ''} past expected delivery`)
  if (!shipment.event_intransit) riskFactors.push('No in-transit scan recorded')
  if (daysInTransit > 15 && isIntl) riskFactors.push('International shipment beyond typical window')
  if (daysInTransit > 10 && !isIntl) riskFactors.push('Domestic shipment significantly delayed')

  return {
    deliveryProbability: Math.round(prob * 100) / 100,
    stillInTransitProbability: Math.round((prob * 0.6) * 100) / 100,
    daysInTransit,
    expectedDeliveryDay: expected,
    riskLevel: risk,
    riskFactors,
    confidence: 'high' as const,
    sampleSize: 42000,
    segmentUsed: {
      carrier: shipment.carrier || 'Unknown',
      service_bucket: shipment.carrier_service || 'Standard',
      zone_bucket: isIntl ? 'international' : 'zone-4-6',
      season_bucket: 'current',
    },
    percentiles: { p50: expected, p75: expected + 2, p90: expected + 4, p95: expected + 6 },
  }
}

function demoSummary(r: ReturnType<typeof synthesizeDemoProbability>): string {
  if (r.terminalState?.isPositive) return 'Delivered successfully.'
  const pct = Math.round(r.deliveryProbability * 100)
  if (pct >= 75) return `On track — ${pct}% chance of delivery. No action needed.`
  if (pct >= 50) return `Monitoring — ${pct}% chance of delivery. May warrant a carrier check-in.`
  if (pct >= 25) return `At risk — only ${pct}% chance of delivery. Consider filing a claim.`
  return `Likely lost — ${pct}% chance of delivery. File a claim and reship if needed.`
}

function demoRecommendedAction(r: ReturnType<typeof synthesizeDemoProbability>): string {
  if (r.terminalState?.isPositive) return 'none'
  if (r.deliveryProbability >= 0.75) return 'wait'
  if (r.deliveryProbability >= 0.5) return 'monitor'
  if (r.deliveryProbability >= 0.25) return 'consider_reship'
  return 'reship_and_claim'
}

function demoAiSummary(
  r: ReturnType<typeof synthesizeDemoProbability>,
  shipment: { carrier: string | null; destination_country: string | null }
) {
  const pct = Math.round(r.deliveryProbability * 100)
  const carrier = shipment.carrier || 'the carrier'
  if (r.terminalState?.isPositive) {
    return {
      headline: 'Delivered successfully — no action needed.',
      summary: 'This shipment was delivered on time. Tracking confirms arrival at the destination.',
      merchantAction: 'No action required. The order is complete.',
    }
  }
  if (pct >= 75) {
    return {
      headline: 'On pace for on-time delivery.',
      summary: `Transit times for ${carrier} suggest this shipment is progressing normally. Our model gives it a ${pct}% chance of delivery without intervention.`,
      merchantAction: 'No action needed — keep watching over the next 24–48 hours.',
    }
  }
  if (pct >= 50) {
    return {
      headline: 'Minor delay — monitoring closely.',
      summary: `This shipment is a day or two beyond the typical transit window for ${carrier}. We estimate a ${pct}% delivery probability. The carrier may still deliver, but the clock is ticking.`,
      merchantAction: 'Reach out to the customer proactively to set expectations. File a claim if no movement in 3 days.',
    }
  }
  if (pct >= 25) {
    return {
      headline: 'At risk — consider a reship.',
      summary: `${r.daysInTransit} days in transit with ${r.riskFactors[0] || 'limited recent movement'}. Our model gives a ${pct}% delivery probability — below the threshold where most merchants file a claim.`,
      merchantAction: 'File a claim now and reship to preserve customer relationship. Recovery is unlikely.',
    }
  }
  return {
    headline: 'Likely lost — file + reship.',
    summary: `Extended transit with ${r.riskFactors.length > 0 ? r.riskFactors.join('; ') : 'no recent scans'}. Only ${pct}% delivery probability. Carriers rarely recover shipments at this stage.`,
    merchantAction: 'Reship immediately and file the carrier claim to recover costs.',
  }
}
