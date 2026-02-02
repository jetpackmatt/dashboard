/**
 * Google Gemini AI Client
 *
 * Uses Gemini 3.0 Pro for shipment risk assessments.
 * Very cheap to use - no rate limiting needed.
 */

import { GoogleGenerativeAI } from '@google/generative-ai'

// Initialize the client
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '')

// Get the model - using gemini-2.0-flash-001 (fast and cheap)
export const geminiModel = genAI.getGenerativeModel({
  model: 'gemini-2.0-flash-001',
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
