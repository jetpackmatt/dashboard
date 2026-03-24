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

// Watch reason badges for On Watch shipments
export type WatchReason = 'SLOW' | 'STALLED' | 'CUSTOMS' | 'PICKUP' | 'DELIVERY ISSUE' | 'NEEDS ACTION' | 'STUCK' | 'NO SCANS' | 'RETURNING'

// Movement evaluation types
export interface MovementEvaluation {
  isGenuineMovement: boolean
  watchReason: WatchReason
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
 * Format checkpoint timeline for AI prompts
 */
function formatCheckpointTimeline(checkpoints: CheckpointForEval[], limit: number = 30): string {
  return checkpoints
    .slice(0, limit)
    .map(cp => {
      const date = cp.checkpoint_date.split('T')[0]
      const loc = cp.raw_location || 'no location'
      return `${date} | ${cp.raw_description} | ${loc} | status:${cp.raw_status || 'unknown'}`
    })
    .join('\n')
}

/**
 * Shared prompt section for watch reason classification
 */
const WATCH_REASON_PROMPT = `
## WATCH REASON CLASSIFICATION
Based on the checkpoint pattern, classify the shipment into exactly one category:

- **SLOW**: Package is ACTIVELY progressing through different locations, just at a slow pace. The MOST RECENT checkpoint must be within the last 5-7 days and show the package at a new location compared to earlier checkpoints. If the last checkpoint is older than 7 days, the package is NOT slow — it is STALLED or worse.
- **STALLED**: Package was moving but has gone silent or stopped. Either: (a) the last checkpoint is 7+ days old with no new updates, or (b) recent checkpoints are all at the same location but the package was previously seen at other locations.
- **CUSTOMS**: International package in customs processing — whether routine or stuck/cycling. Any shipment where the primary issue is customs/clearance, including carriers cycling "Clearance Event" / "Shipment is on hold" at a customs facility. Applies to ALL carriers (DHL, FedEx, UPS, etc.), not just DHL.
- **PICKUP**: Package is waiting for the recipient to collect it. Examples: "Awaiting collection by the consignee", "Available for Pickup", "Reminder to pick up your item", "Reminder to Schedule Redelivery". The package is safe and accounted for but NOT delivered — the recipient must go get it. If too much time passes, the carrier will return it to sender.
- **DELIVERY ISSUE**: Carrier has attempted delivery but failed — one or more "Out for Delivery" or "Delivery Attempted" events followed by return to facility without successful delivery. The package is still in the carrier network and will likely be reattempted, but repeated failures risk return-to-sender. This takes PRIORITY over SLOW and STUCK — a shipment with recent "Out for Delivery" scans that failed to deliver is DELIVERY ISSUE, not STUCK or SLOW, regardless of how many times it cycled. Two delivery attempts in a row are common; the key signal is "went out, came back without delivering."
- **NEEDS ACTION**: Shipper or recipient must take a specific action to resolve a delivery issue. Examples: "address correction needed", "incorrect/insufficient address", "restricted address", "additional documentation required", "payment of duties required", "Hold for Instructions Requested" (carrier is asking for delivery instructions). NOTE: Cirro/GOFO's "Hold for Instructions Requested. Contact GOFO..." is NOT boilerplate — it means the carrier needs instructions from the shipper. Look at the underlying exception (address issue, business closed, no access) to confirm NEEDS ACTION.
- **STUCK**: Carrier is cycling/repeating the same 2-3 statuses at the same DOMESTIC location over multiple days or weeks WITHOUT any delivery attempts. The package is clearly not progressing despite the carrier posting "updates". NOTE: If the cycling is at a customs facility for an international shipment, use CUSTOMS instead. NOTE: If the cycling includes "Out for Delivery" attempts, use DELIVERY ISSUE instead.
- **RETURNING**: Evidence the package is being returned to sender. Descriptions mention "return", "returned to sender", "RTS", "back to shipper", "return initiated", "in transit to origin".

IMPORTANT DISTINCTIONS:
- DELIVERY ISSUE vs STUCK: If the cycling includes "Out for Delivery" or "Delivery Attempted" events, it's DELIVERY ISSUE, not STUCK. STUCK is for packages sitting at a facility without any delivery attempts.
- DELIVERY ISSUE vs SLOW: A shipment with recent movement that includes failed delivery attempts is DELIVERY ISSUE, not SLOW. SLOW is for packages progressing through the network but haven't reached the delivery stage yet.
- CUSTOMS vs STUCK: If the repeated statuses involve customs/clearance keywords at an international facility, it's CUSTOMS, not STUCK. STUCK is for domestic cycling patterns only.
- CUSTOMS vs NEEDS ACTION: If customs requires documents/payment from shipper or recipient, that's NEEDS ACTION, not CUSTOMS.
- PICKUP vs NEEDS ACTION: PICKUP is specifically for "come get your package" situations. NEEDS ACTION is for issues that need resolution before delivery can be attempted (address fix, hold instructions, etc.).
- STALLED vs STUCK: STALLED means the package has gone silent (no updates). STUCK means the carrier IS posting updates but they're the same cycling pattern.
- SLOW vs STALLED: SLOW means the package IS still appearing at new locations within the last 5-7 days. STALLED means it has STOPPED.`

/**
 * Evaluate whether a shipment is showing genuine new movement or is stuck in a
 * repeating pattern. Called when a monitored shipment gets a new scan that drops
 * daysSinceLastScan below 8.
 *
 * Also classifies the watch reason badge in the same AI call.
 *
 * Uses Gemini Flash for nuanced interpretation — carrier tracking descriptions
 * have too many edge cases for pure rule-based logic.
 *
 * @returns MovementEvaluation with isGenuineMovement boolean and watchReason badge
 */
export async function evaluateMovement(
  carrier: string,
  checkpoints: CheckpointForEval[],
  isInternational: boolean = false,
): Promise<MovementEvaluation> {
  // Safety: if fewer than 2 checkpoints, can't evaluate patterns
  if (checkpoints.length < 2) {
    return { isGenuineMovement: false, watchReason: 'STALLED', confidence: 50, reason: 'Insufficient checkpoint history' }
  }

  // Pre-filter: if raw_status is "inforeceived" on the latest checkpoint, never real movement
  if (checkpoints[0]?.raw_status === 'inforeceived') {
    return { isGenuineMovement: false, watchReason: 'NO SCANS', confidence: 95, reason: 'Only info received events, no physical scans' }
  }

  const timeline = formatCheckpointTimeline(checkpoints)
  const today = new Date().toISOString().split('T')[0]
  const latestCheckpoint = checkpoints[0]
  const daysSinceLastScan = latestCheckpoint?.checkpoint_date
    ? Math.floor((Date.now() - new Date(latestCheckpoint.checkpoint_date).getTime()) / (1000 * 60 * 60 * 24))
    : null

  const prompt = `You are a shipping logistics expert analyzing carrier tracking data. You have TWO tasks:
1. Determine whether this shipment is showing GENUINE forward movement toward delivery, or is stuck/cycling.
2. Classify the watch reason (why this shipment needs monitoring).

## TODAY'S DATE: ${today}
## DAYS SINCE LAST SCAN: ${daysSinceLastScan ?? 'unknown'}
## CARRIER: ${carrier}
## INTERNATIONAL: ${isInternational ? 'Yes' : 'No'}

## CHECKPOINT HISTORY (newest first, last ${Math.min(checkpoints.length, 30)} events)
date | description | location | status
${timeline}

## MOVEMENT EVALUATION

### #1 SIGNAL: LOCATION CHANGE (most important)
The strongest indicator of genuine movement is the package appearing at a NEW physical location (different city or facility). If recent checkpoints show the package at multiple distinct locations, it is moving — regardless of what the status text says. Even "In Transit" repeated 3 times is genuine movement if the locations are Chicago → Denver → Los Angeles.

HOWEVER, these do NOT count as location changes:
- Same city appearing with minor formatting differences (e.g., "MEMPHIS,TN" vs "Memphis, TN")
- ShipBob internal warehouse transfers between ShipBob fulfillment centers — this is warehouse logistics, not delivery progress
- Location toggling between just 2 locations repeatedly (package bouncing, not progressing)

### #2 SIGNAL: STATUS PROGRESSION (secondary)
A clear forward progression in delivery status is also genuine movement:
- "Label Created" → first carrier scan (package was picked up)
- Any status → "Out for Delivery" or "Delivery Attempted"

### WHAT DOES NOT COUNT AS GENUINE MOVEMENT
- Same description repeating at the SAME location on different days (carrier auto-updating stale data)
- Alternating/cycling between 2-3 statuses at the same location (e.g., DHL cycling "Clearance Event" / "Shipment is on hold" daily at the same customs facility for weeks)
- Informational-only updates ("label created", "shipping info received", "electronic notification")
- "Awaiting collection" or "available for pickup" repeating — package is sitting, not moving
- Exception/hold statuses repeating at the same location ("Hold for Instructions", "Shipment is on hold")
${WATCH_REASON_PROMPT}

## YOUR TASK
1. Examine the most recent 5-10 checkpoints for genuine movement (location changes first, then status progression).
2. Classify the watch reason based on the overall checkpoint pattern.

Respond ONLY with a JSON object (no markdown, no explanation):
{
  "isGenuineMovement": true/false,
  "watchReason": "SLOW" | "STALLED" | "CUSTOMS" | "PICKUP" | "DELIVERY ISSUE" | "NEEDS ACTION" | "STUCK" | "RETURNING",
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
      return { isGenuineMovement: false, watchReason: 'STALLED', confidence: 0, reason: 'Invalid AI response' }
    }

    const validReasons: WatchReason[] = ['SLOW', 'STALLED', 'CUSTOMS', 'PICKUP', 'DELIVERY ISSUE', 'NEEDS ACTION', 'STUCK', 'NO SCANS', 'RETURNING']
    if (!validReasons.includes(evaluation.watchReason)) {
      evaluation.watchReason = 'STALLED' // Safe default
    }

    evaluation.confidence = Math.max(0, Math.min(100, evaluation.confidence || 50))

    return evaluation
  } catch (error) {
    console.error('[AI] Error evaluating movement:', error)
    return { isGenuineMovement: false, watchReason: 'STALLED', confidence: 0, reason: `AI evaluation failed: ${error instanceof Error ? error.message : 'Unknown'}` }
  }
}

/**
 * Classify the watch reason for a monitored shipment without evaluating movement.
 * Used by the ai-reassess cron for shipments that haven't had a recent scan
 * (daysSince >= 8) and therefore don't need movement evaluation.
 *
 * @returns WatchReason badge and brief explanation
 */
export async function classifyWatchReason(
  carrier: string,
  checkpoints: CheckpointForEval[],
  isInternational: boolean = false,
): Promise<{ watchReason: WatchReason; reason: string }> {
  // Code-detectable: no checkpoints at all
  if (checkpoints.length === 0) {
    return { watchReason: 'NO SCANS', reason: 'No carrier scan data exists' }
  }

  // Code-detectable: only inforeceived events
  const hasPhysicalScan = checkpoints.some(cp => cp.raw_status && cp.raw_status !== 'inforeceived')
  if (!hasPhysicalScan) {
    return { watchReason: 'NO SCANS', reason: 'Only info received events, no physical carrier scans' }
  }

  const timeline = formatCheckpointTimeline(checkpoints)

  const today = new Date().toISOString().split('T')[0]
  const latestCheckpoint = checkpoints[0]
  const daysSinceLastScan = latestCheckpoint?.checkpoint_date
    ? Math.floor((Date.now() - new Date(latestCheckpoint.checkpoint_date).getTime()) / (1000 * 60 * 60 * 24))
    : null

  const prompt = `You are a shipping logistics expert. Classify why this shipment needs monitoring based on its tracking history.

## TODAY'S DATE: ${today}
## DAYS SINCE LAST SCAN: ${daysSinceLastScan ?? 'unknown'}
## CARRIER: ${carrier}
## INTERNATIONAL: ${isInternational ? 'Yes' : 'No'}

## CHECKPOINT HISTORY (newest first, last ${Math.min(checkpoints.length, 30)} events)
date | description | location | status
${timeline}
${WATCH_REASON_PROMPT}

CRITICAL: Consider how OLD the latest checkpoint is relative to today's date. A shipment that showed movement 15 days ago but has been completely silent since then is NOT "SLOW" — it is STALLED or STUCK. "SLOW" means the package is ACTIVELY progressing, with recent checkpoints (within the last few days) showing new locations.

Respond ONLY with a JSON object (no markdown, no explanation):
{
  "watchReason": "SLOW" | "STALLED" | "CUSTOMS" | "PICKUP" | "DELIVERY ISSUE" | "NEEDS ACTION" | "STUCK" | "RETURNING",
  "reason": "brief explanation"
}`

  try {
    const result = await geminiModel.generateContent(prompt)
    const text = result.response.text()
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const parsed = JSON.parse(jsonText) as { watchReason: WatchReason; reason: string }

    const validReasons: WatchReason[] = ['SLOW', 'STALLED', 'CUSTOMS', 'PICKUP', 'DELIVERY ISSUE', 'NEEDS ACTION', 'STUCK', 'NO SCANS', 'RETURNING']
    if (!validReasons.includes(parsed.watchReason)) {
      parsed.watchReason = 'STALLED'
    }

    return parsed
  } catch (error) {
    console.error('[AI] Error classifying watch reason:', error)
    return { watchReason: 'STALLED', reason: `Classification failed: ${error instanceof Error ? error.message : 'Unknown'}` }
  }
}

/**
 * Derive recheck interval from watch reason badge.
 * Replaces the old riskLevel-based calculation.
 */
export function getNextCheckInterval(watchReason: WatchReason): number {
  switch (watchReason) {
    case 'STUCK':
    case 'NEEDS ACTION':
    case 'DELIVERY ISSUE':
      return 60 * 60 * 1000 // 1 hour
    case 'PICKUP':
    case 'STALLED':
    case 'RETURNING':
      return 2 * 60 * 60 * 1000 // 2 hours
    case 'CUSTOMS':
    case 'SLOW':
      return 4 * 60 * 60 * 1000 // 4 hours
    case 'NO SCANS':
      return 4 * 60 * 60 * 1000 // 4 hours (no point checking often)
    default:
      return 4 * 60 * 60 * 1000
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
