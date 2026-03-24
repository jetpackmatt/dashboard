/**
 * Google Gemini AI Client
 *
 * Uses Gemini 3.0 Pro for shipment risk assessments.
 * Very cheap to use - no rate limiting needed.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

// Initialize the client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

// Get the model - using gemini-3-flash-preview (Gemini 3 Flash)
export const geminiModel = genAI.getGenerativeModel({
  model: 'gemini-3-flash-preview',
})

// AI Assessment response type
export interface AIAssessment {
  statusBadge: 'MOVING' | 'DELAYED' | 'WATCHLIST' | 'STALLED' | 'STUCK' | 'RETURNING' | 'LOST'
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  customerSentiment: string
  merchantAction: string
  reshipmentUrgency: number
  keyInsight: string
  nextMilestone: string
  confidence: number
}

// Checkpoint data for timeline
export interface TrackingCheckpoint {
  date: string
  description: string
  location: string
}

// Shipment data for assessment
export interface ShipmentDataForAssessment {
  trackingId: string
  carrier: string
  originCountry: string
  destinationCountry: string
  labelDate: string
  daysSinceLabel: number
  firstScanDate: string | null
  daysInTransit: number | null
  lastScanDate: string | null
  daysSinceLastScan: number | null
  checkpoints: TrackingCheckpoint[]
  typicalTransitDays: number | null
  carrierPerformanceSummary: string | null
}

/**
 * Generate an AI assessment for a shipment
 */
export async function generateAssessment(
  shipmentData: ShipmentDataForAssessment
): Promise<AIAssessment | null> {
  try {
    // Format checkpoint timeline
    const checkpointTimeline = shipmentData.checkpoints.length > 0
      ? shipmentData.checkpoints
          .slice(0, 20) // Limit to last 20 checkpoints
          .map(cp => `${cp.date} - ${cp.description}${cp.location ? `, ${cp.location}` : ''}`)
          .join('\n')
      : 'No checkpoint data available'

    const prompt = `You are an expert shipping logistics analyst helping e-commerce merchants protect their customer experience.

## SHIPMENT DATA
- Tracking Number: ${shipmentData.trackingId}
- Carrier: ${shipmentData.carrier}
- Origin: ${shipmentData.originCountry} → Destination: ${shipmentData.destinationCountry}
- Label Created: ${shipmentData.labelDate} (${shipmentData.daysSinceLabel} days ago)
- First Carrier Scan: ${shipmentData.firstScanDate || 'Not yet scanned'} (${shipmentData.daysInTransit ?? 'N/A'} days in transit)
- Latest Scan: ${shipmentData.lastScanDate || 'No scans'} (${shipmentData.daysSinceLastScan ?? 'N/A'} days silent)

## COMPLETE TRACKING TIMELINE
${checkpointTimeline}

## CARRIER CONTEXT
- Typical transit time for this route: ${shipmentData.typicalTransitDays ?? 'Unknown'} days
- This carrier's recent performance: ${shipmentData.carrierPerformanceSummary || 'No data available'}

## YOUR ANALYSIS
Analyze the complete timeline and provide your assessment. Note: all shipments you're analyzing are 8+ days in transit and need attention.

Respond ONLY with a valid JSON object in this exact format (no markdown, no explanation):
{
  "statusBadge": "MOVING" | "DELAYED" | "WATCHLIST" | "STALLED" | "STUCK" | "RETURNING" | "LOST",
  "riskLevel": "low" | "medium" | "high" | "critical",
  "customerSentiment": "string describing what the end customer is likely thinking",
  "merchantAction": "string with recommended action for the merchant",
  "reshipmentUrgency": number 0-100,
  "keyInsight": "one specific observation from the timeline",
  "nextMilestone": "what should happen next and when",
  "confidence": number 0-100
}

STATUS BADGE OPTIONS:
- MOVING: Still progressing, but slower than expected
- DELAYED: Behind schedule but still moving
- WATCHLIST: Needs close monitoring, uncertain outcome
- STALLED: No movement for concerning period
- STUCK: Appears stuck at a specific facility
- RETURNING: Signs of return to sender
- LOST: High probability package is lost

MERCHANT ACTION OPTIONS:
- Wait and monitor
- Proactively reach out to customer
- Consider reshipment now
- File Lost in Transit Claim
- Open Tracking Check (for carrier investigation)

RESHIPMENT URGENCY SCORING:
- 0-30: No action needed
- 31-60: Monitor closely
- 61-80: Consider reshipment
- 81-100: Reship immediately`

    const result = await geminiModel.generateContent(prompt)
    const response = result.response
    const text = response.text()

    // Parse JSON response
    // Remove any markdown code blocks if present
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()

    const assessment = JSON.parse(jsonText) as AIAssessment

    // Validate required fields
    if (!assessment.statusBadge || !assessment.riskLevel) {
      console.error('[AI] Invalid assessment response - missing required fields')
      return null
    }

    // Ensure values are within expected ranges
    assessment.reshipmentUrgency = Math.max(0, Math.min(100, assessment.reshipmentUrgency || 0))
    assessment.confidence = Math.max(0, Math.min(100, assessment.confidence || 50))

    return assessment
  } catch (error) {
    console.error('[AI] Error generating assessment:', error)
    return null
  }
}

// Movement evaluation types
export interface MovementEvaluation {
  isGenuineMovement: boolean
  confidence: number
  reason: string
}

// Checkpoint data for movement evaluation (from our stored checkpoints)
export interface CheckpointForEval {
  checkpoint_date: string
  raw_description: string
  raw_location: string | null
  raw_status: string | null
}

/**
 * Evaluate whether a shipment is showing genuine new movement or is stuck in a
 * repeating pattern. Called when a monitored shipment gets a new scan that drops
 * daysSinceLastScan below 8.
 *
 * Uses Gemini Flash for nuanced interpretation — carrier tracking descriptions
 * have too many edge cases for pure rule-based logic (DHL cycling "Clearance Event"
 * / "Shipment is on hold" daily, USPS embedding dates in descriptions, same
 * description at new locations = real movement, etc.)
 *
 * @returns MovementEvaluation with isGenuineMovement boolean
 */
export async function evaluateMovement(
  carrier: string,
  checkpoints: CheckpointForEval[],
): Promise<MovementEvaluation> {
  // Safety: if fewer than 2 checkpoints, can't evaluate patterns
  if (checkpoints.length < 2) {
    return { isGenuineMovement: false, confidence: 50, reason: 'Insufficient checkpoint history' }
  }

  // Pre-filter: if raw_status is "inforeceived" on the latest checkpoint, never real movement
  if (checkpoints[0]?.raw_status === 'inforeceived') {
    return { isGenuineMovement: false, confidence: 95, reason: 'Info received event, not physical movement' }
  }

  // Format the checkpoint timeline (limit to last 30 for context)
  const timeline = checkpoints
    .slice(0, 30)
    .map(cp => {
      const date = cp.checkpoint_date.split('T')[0]
      const loc = cp.raw_location || 'no location'
      return `${date} | ${cp.raw_description} | ${loc} | status:${cp.raw_status || 'unknown'}`
    })
    .join('\n')

  const prompt = `You are a shipping logistics expert analyzing carrier tracking data. Your job is to determine whether a shipment that was being monitored as potentially lost is now showing GENUINE forward movement toward delivery, or is stuck in a repeating/cycling pattern.

## CARRIER: ${carrier}

## CHECKPOINT HISTORY (newest first, last ${Math.min(checkpoints.length, 30)} events)
date | description | location | status
${timeline}

## #1 SIGNAL: LOCATION CHANGE (most important)
The strongest indicator of genuine movement is the package appearing at a NEW physical location (different city or facility). If recent checkpoints show the package at multiple distinct locations, it is moving — regardless of what the status text says. Even "In Transit" repeated 3 times is genuine movement if the locations are Chicago → Denver → Los Angeles.

HOWEVER, these do NOT count as location changes:
- Same city appearing with minor formatting differences (e.g., "MEMPHIS,TN" vs "Memphis, TN")
- ShipBob internal warehouse transfers between ShipBob fulfillment centers — this is warehouse logistics, not delivery progress
- Location toggling between just 2 locations repeatedly (package bouncing, not progressing)

## #2 SIGNAL: STATUS PROGRESSION (secondary)
A clear forward progression in delivery status is also genuine movement:
- "Label Created" → first carrier scan (package was picked up)
- Any status → "Out for Delivery" or "Delivery Attempted"

## WHAT DOES NOT COUNT AS GENUINE MOVEMENT
- Same description repeating at the SAME location on different days (carrier auto-updating stale data)
- Alternating/cycling between 2-3 statuses at the same location (e.g., DHL cycling "Clearance Event" / "Shipment is on hold" daily at the same customs facility for weeks)
- Informational-only updates ("label created", "shipping info received", "electronic notification")
- "Awaiting collection" or "available for pickup" repeating — package is sitting, not moving
- Exception/hold statuses repeating at the same location ("Hold for Instructions", "Shipment is on hold")

## YOUR TASK
Examine the most recent 5-10 checkpoints. First, check if the package has appeared at genuinely new locations. Then check for status progression. If neither, check for stuck/cycling patterns.

Respond ONLY with a JSON object (no markdown, no explanation):
{
  "isGenuineMovement": true/false,
  "confidence": 0-100,
  "reason": "brief explanation"
}`

  try {
    const result = await geminiModel.generateContent(prompt)
    const text = result.response.text()
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const evaluation = JSON.parse(jsonText) as MovementEvaluation

    // Validate
    if (typeof evaluation.isGenuineMovement !== 'boolean') {
      console.error('[AI] Invalid movement evaluation - missing isGenuineMovement')
      return { isGenuineMovement: false, confidence: 0, reason: 'Invalid AI response' }
    }

    evaluation.confidence = Math.max(0, Math.min(100, evaluation.confidence || 50))

    return evaluation
  } catch (error) {
    console.error('[AI] Error evaluating movement:', error)
    // On error, default to keeping in monitoring (safe default)
    return { isGenuineMovement: false, confidence: 0, reason: `AI evaluation failed: ${error instanceof Error ? error.message : 'Unknown'}` }
  }
}

/**
 * Calculate next check time based on current risk/status
 */
export function calculateNextCheckTime(
  assessment: AIAssessment | null,
  daysSinceLastScan: number | null
): Date {
  const now = new Date()

  // High priority: At risk (15+ days) or critical risk - check every hour
  if (daysSinceLastScan && daysSinceLastScan >= 15) {
    return new Date(now.getTime() + 60 * 60 * 1000) // 1 hour
  }

  if (assessment?.riskLevel === 'critical' || assessment?.riskLevel === 'high') {
    return new Date(now.getTime() + 60 * 60 * 1000) // 1 hour
  }

  // Medium priority: 8+ days in transit - check every 4 hours
  return new Date(now.getTime() + 4 * 60 * 60 * 1000) // 4 hours
}
