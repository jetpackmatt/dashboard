/**
 * AI-Powered Delivery Summary Generation
 *
 * Uses Gemini to generate human-readable summaries of shipment status
 * combining survival analysis probabilities with tracking context.
 */

import { geminiModel } from './client'
import type { DeliveryProbabilityResult } from '@/lib/delivery-intelligence/probability'
import type { StoredCheckpoint } from '@/lib/trackingmore/checkpoint-storage'

// =============================================================================
// Types
// =============================================================================

export interface DeliverySummary {
  headline: string // Short status (2-5 words)
  summary: string // 1-2 sentence explanation
  customerMessage: string // What to tell the customer
  merchantAction: string // Recommended action
  sentiment: 'positive' | 'neutral' | 'concerning' | 'critical'
  confidence: number // 0-100
}

export interface SummaryContext {
  shipmentId: string
  trackingNumber: string | null
  carrier: string
  carrierService: string | null
  probability: DeliveryProbabilityResult
  checkpoints?: StoredCheckpoint[]
  daysInTransit: number
  lastCheckpointDescription?: string
  lastCheckpointDate?: string
}

// =============================================================================
// Summary Generation
// =============================================================================

/**
 * Generate an AI-powered delivery summary
 */
export async function generateDeliverySummary(
  context: SummaryContext
): Promise<DeliverySummary | null> {
  try {
    // Format checkpoint timeline if available
    const checkpointTimeline = context.checkpoints && context.checkpoints.length > 0
      ? context.checkpoints
          .slice(-10) // Last 10 checkpoints
          .map(cp => {
            const date = new Date(cp.checkpoint_date).toLocaleDateString()
            const type = cp.normalized_type || 'UNKNOWN'
            return `${date} - [${type}] ${cp.display_title || cp.raw_description}`
          })
          .join('\n')
      : 'No detailed tracking data available'

    const prompt = `You are a shipping logistics expert helping e-commerce merchants communicate with customers about delayed packages.

## SHIPMENT DATA
- Tracking: ${context.trackingNumber || 'Unknown'}
- Carrier: ${context.carrier} ${context.carrierService ? `(${context.carrierService})` : ''}
- Days in Transit: ${context.daysInTransit.toFixed(1)}
- Last Checkpoint: ${context.lastCheckpointDescription || 'Unknown'} (${context.lastCheckpointDate || 'Unknown'})

## DELIVERY PROBABILITY ANALYSIS
- Delivery Probability: ${(context.probability.deliveryProbability * 100).toFixed(1)}%
- Risk Level: ${context.probability.riskLevel}
- Risk Factors: ${context.probability.riskFactors.length > 0 ? context.probability.riskFactors.join(', ') : 'None'}
- Expected Delivery: ${context.probability.expectedDeliveryDay ? `Day ${context.probability.expectedDeliveryDay}` : 'Unknown'}
- Percentiles: P50=${context.probability.percentiles.p50 || '?'}, P90=${context.probability.percentiles.p90 || '?'}, P95=${context.probability.percentiles.p95 || '?'} days

## RECENT TRACKING HISTORY
${checkpointTimeline}

## YOUR TASK
Generate a summary for this shipment. Be direct and actionable.

Respond ONLY with a valid JSON object (no markdown, no explanation):
{
  "headline": "2-5 word status (e.g., 'Delayed at hub', 'Moving slowly', 'Likely lost')",
  "summary": "1-2 sentence explanation of current status and what's happening",
  "customerMessage": "What the merchant should tell the customer (reassuring but honest)",
  "merchantAction": "Specific recommended action for the merchant",
  "sentiment": "positive" | "neutral" | "concerning" | "critical",
  "confidence": 0-100
}

SENTIMENT GUIDE:
- positive: On track, minor delay, will deliver
- neutral: Normal progress, nothing unusual
- concerning: Needs attention, uncertain outcome
- critical: High risk of loss, action needed

MERCHANT ACTION OPTIONS:
- "No action needed - package is progressing normally"
- "Monitor for 24-48 hours"
- "Proactively message customer about delay"
- "Open carrier investigation"
- "Consider reshipment"
- "File lost in transit claim"`

    const result = await geminiModel.generateContent(prompt)
    const response = result.response
    const text = response.text()

    // Parse JSON response
    const jsonText = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim()
    const summary = JSON.parse(jsonText) as DeliverySummary

    // Validate required fields
    if (!summary.headline || !summary.summary) {
      console.error('[AI Summary] Invalid response - missing required fields')
      return null
    }

    // Ensure confidence is in range
    summary.confidence = Math.max(0, Math.min(100, summary.confidence || 70))

    return summary
  } catch (error) {
    console.error('[AI Summary] Error generating summary:', error)
    return null
  }
}

/**
 * Generate a quick summary without AI (fallback)
 */
export function generateFallbackSummary(
  context: SummaryContext
): DeliverySummary {
  const prob = context.probability
  const pct = Math.round(prob.deliveryProbability * 100)

  // Determine headline and sentiment based on risk level
  let headline: string
  let summary: string
  let customerMessage: string
  let merchantAction: string
  let sentiment: DeliverySummary['sentiment']

  switch (prob.riskLevel) {
    case 'critical':
      headline = 'High risk of loss'
      summary = `Package has been in transit ${context.daysInTransit.toFixed(0)} days with ${prob.riskFactors.length} risk factors detected. Delivery probability is ${pct}%.`
      customerMessage = "We're investigating a delay with your order. We'll update you within 24 hours with next steps."
      merchantAction = 'File lost in transit claim or consider reshipment'
      sentiment = 'critical'
      break

    case 'high':
      headline = 'Significant delay'
      summary = `Package is ${context.daysInTransit.toFixed(0)} days in transit, exceeding expected delivery time. ${pct}% delivery probability.`
      customerMessage = "Your package is experiencing a delay. We're monitoring it closely and will reach out if action is needed."
      merchantAction = 'Open carrier investigation'
      sentiment = 'concerning'
      break

    case 'medium':
      headline = 'Minor delay'
      summary = `Package is ${context.daysInTransit.toFixed(0)} days in transit. ${pct}% delivery probability. Monitoring recommended.`
      customerMessage = 'Your package is on the way but running slightly behind schedule. Should arrive soon.'
      merchantAction = 'Monitor for 24-48 hours'
      sentiment = 'concerning'
      break

    default: // low
      headline = 'On track'
      summary = `Package is progressing normally after ${context.daysInTransit.toFixed(0)} days in transit. ${pct}% delivery probability.`
      customerMessage = 'Your package is on the way and should arrive soon!'
      merchantAction = 'No action needed - package is progressing normally'
      sentiment = 'positive'
  }

  return {
    headline,
    summary,
    customerMessage,
    merchantAction,
    sentiment,
    confidence: 70, // Lower confidence for fallback
  }
}

/**
 * Get summary with AI fallback
 */
export async function getDeliverySummary(
  context: SummaryContext,
  useAI: boolean = true
): Promise<DeliverySummary> {
  if (useAI) {
    const aiSummary = await generateDeliverySummary(context)
    if (aiSummary) {
      return aiSummary
    }
  }

  return generateFallbackSummary(context)
}

// =============================================================================
// Batch Operations
// =============================================================================

/**
 * Generate summaries for multiple shipments
 * Uses rate limiting to avoid overwhelming Gemini API
 */
export async function generateBatchSummaries(
  contexts: SummaryContext[],
  useAI: boolean = true
): Promise<Map<string, DeliverySummary>> {
  const results = new Map<string, DeliverySummary>()

  for (const context of contexts) {
    const summary = await getDeliverySummary(context, useAI)
    results.set(context.shipmentId, summary)

    // Small delay between AI calls
    if (useAI && contexts.indexOf(context) < contexts.length - 1) {
      await new Promise(r => setTimeout(r, 200))
    }
  }

  return results
}

// =============================================================================
// Pre-computed Summary Cache
// =============================================================================

/**
 * Get or generate cached summary for a shipment
 *
 * Summaries are cached for 4 hours to avoid repeated AI calls
 */
const summaryCache = new Map<string, { summary: DeliverySummary; cachedAt: number }>()
const CACHE_TTL_MS = 4 * 60 * 60 * 1000 // 4 hours

export async function getCachedSummary(
  context: SummaryContext,
  useAI: boolean = true
): Promise<DeliverySummary> {
  const cacheKey = `${context.shipmentId}:${context.probability.riskLevel}:${Math.floor(context.daysInTransit)}`

  const cached = summaryCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) {
    return cached.summary
  }

  const summary = await getDeliverySummary(context, useAI)

  summaryCache.set(cacheKey, {
    summary,
    cachedAt: Date.now(),
  })

  // Clean old entries periodically
  if (summaryCache.size > 1000) {
    const now = Date.now()
    for (const [key, value] of summaryCache) {
      if (now - value.cachedAt > CACHE_TTL_MS) {
        summaryCache.delete(key)
      }
    }
  }

  return summary
}
