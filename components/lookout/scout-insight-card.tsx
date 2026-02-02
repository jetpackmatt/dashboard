"use client"

import * as React from "react"
import { Loader2Icon } from "lucide-react"
import { cn } from "@/lib/utils"

// Types matching the API response
export interface ScoutProbabilityData {
  deliveryProbability: number
  stillInTransitProbability: number
  daysInTransit: number
  expectedDeliveryDay: number | null
  riskLevel: 'low' | 'medium' | 'high' | 'critical'
  riskFactors: string[]
  confidence: 'high' | 'medium' | 'low' | 'insufficient'
  sampleSize: number
  segmentUsed: {
    carrier: string
    service_bucket: string
    zone_bucket: string
    season_bucket: string
  }
  percentiles: {
    p50: number | null
    p75: number | null
    p90: number | null
    p95: number | null
  }
  summary?: string
  recommended_action?: string
  ai_summary?: {
    headline: string
    summary: string
    customerMessage: string
    merchantAction: string
    sentiment: 'positive' | 'neutral' | 'concerning' | 'critical'
    confidence: number
  }
}

interface ScoutInsightCardProps {
  shipmentId: string
  data: ScoutProbabilityData | null
  isLoading?: boolean
  error?: string | null
  compact?: boolean
}

// Risk level colors - very subtle
const RISK_COLORS = {
  low: { bg: 'bg-emerald-500', text: 'text-emerald-600', light: 'bg-emerald-50' },
  medium: { bg: 'bg-amber-500', text: 'text-amber-600', light: 'bg-amber-50' },
  high: { bg: 'bg-orange-500', text: 'text-orange-600', light: 'bg-orange-50' },
  critical: { bg: 'bg-red-500', text: 'text-red-600', light: 'bg-red-50' },
}

// Clean transit timeline visualization
function TransitTimeline({
  currentDay,
  p50,
  p90,
  p95,
  riskLevel
}: {
  currentDay: number
  p50: number | null
  p90: number | null
  p95: number | null
  riskLevel: string
}) {
  const maxDay = Math.max(p95 || 10, currentDay * 1.2, 10)
  const colors = RISK_COLORS[riskLevel as keyof typeof RISK_COLORS] || RISK_COLORS.medium

  // Calculate positions as percentages
  const currentPos = Math.min((currentDay / maxDay) * 100, 100)
  const p50Pos = p50 ? (p50 / maxDay) * 100 : null
  const p90Pos = p90 ? (p90 / maxDay) * 100 : null
  const p95Pos = p95 ? (p95 / maxDay) * 100 : null

  return (
    <div className="space-y-3">
      {/* Timeline bar */}
      <div className="relative h-2 bg-gray-100 rounded-full overflow-visible">
        {/* Progress fill */}
        <div
          className={cn("absolute top-0 left-0 h-full rounded-full transition-all", colors.bg)}
          style={{ width: `${currentPos}%` }}
        />

        {/* Percentile markers */}
        {p50Pos && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-300"
            style={{ left: `${p50Pos}%` }}
          />
        )}
        {p90Pos && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-400"
            style={{ left: `${p90Pos}%` }}
          />
        )}
        {p95Pos && (
          <div
            className="absolute top-1/2 -translate-y-1/2 w-0.5 h-4 bg-gray-500"
            style={{ left: `${p95Pos}%` }}
          />
        )}
      </div>

      {/* Labels row */}
      <div className="flex justify-between text-[11px] text-gray-400">
        <span>0</span>
        {p50 && <span className="relative" style={{ left: `${(p50Pos || 0) - 50}%` }}>P50: {p50}d</span>}
        {p90 && <span className="relative" style={{ left: `${(p90Pos || 0) - 50}%` }}>P90: {p90}d</span>}
        <span>{Math.round(maxDay)}d</span>
      </div>
    </div>
  )
}

export function ScoutInsightCard({
  shipmentId,
  data,
  isLoading = false,
  error = null,
  compact = false,
}: ScoutInsightCardProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-center gap-2 text-gray-400">
          <Loader2Icon className="h-4 w-4 animate-spin" />
          <span className="text-sm">Analyzing...</span>
        </div>
      </div>
    )
  }

  // Error state
  if (error) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    )
  }

  // No data
  if (!data) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-400">No analysis available</p>
      </div>
    )
  }

  // Insufficient confidence
  if (data.confidence === 'low' || data.confidence === 'insufficient') {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-400">
          Limited data ({data.sampleSize} samples)
        </p>
      </div>
    )
  }

  const colors = RISK_COLORS[data.riskLevel] || RISK_COLORS.medium
  const pct = Math.round(data.deliveryProbability * 100)
  const daysOverdue = data.percentiles.p50
    ? Math.max(0, data.daysInTransit - data.percentiles.p50)
    : 0

  // Compact inline view
  if (compact) {
    return (
      <div className={cn(
        "inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-sm",
        colors.light
      )}>
        <span className={cn("font-semibold tabular-nums", colors.text)}>{pct}%</span>
        <span className="text-gray-400">·</span>
        <span className="text-gray-500">{data.daysInTransit.toFixed(0)}d</span>
      </div>
    )
  }

  // Full card - clean and flat
  return (
    <div className="rounded-lg border border-gray-200 bg-white">
      {/* Header - very minimal */}
      <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
          Delivery Analysis
        </span>
        <span className="text-[10px] text-gray-300">
          n={data.sampleSize.toLocaleString()}
        </span>
      </div>

      <div className="p-4 space-y-4">
        {/* Primary metric row */}
        <div className="flex items-start justify-between">
          {/* Probability - large and prominent */}
          <div>
            <div className="flex items-baseline gap-1">
              <span className={cn("text-4xl font-light tabular-nums", colors.text)}>
                {pct}
              </span>
              <span className={cn("text-lg", colors.text)}>%</span>
            </div>
            <p className="text-xs text-gray-400 mt-0.5">delivery probability</p>
          </div>

          {/* Days in transit */}
          <div className="text-right">
            <div className="flex items-baseline gap-1 justify-end">
              <span className="text-2xl font-light tabular-nums text-gray-700">
                {data.daysInTransit.toFixed(0)}
              </span>
              <span className="text-sm text-gray-400">days</span>
            </div>
            {daysOverdue > 0 && (
              <p className="text-xs text-gray-400 mt-0.5">
                +{daysOverdue.toFixed(0)} over expected
              </p>
            )}
          </div>
        </div>

        {/* Transit timeline - clean visualization */}
        <TransitTimeline
          currentDay={data.daysInTransit}
          p50={data.percentiles.p50}
          p90={data.percentiles.p90}
          p95={data.percentiles.p95}
          riskLevel={data.riskLevel}
        />

        {/* Risk factors - subtle pills */}
        {data.riskFactors.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {data.riskFactors.map((factor) => (
              <span
                key={factor}
                className="px-2 py-0.5 text-[10px] rounded-full bg-gray-100 text-gray-500"
              >
                {factor.replace(/_/g, ' ').replace('detected', '').replace('delivery time', '').trim()}
              </span>
            ))}
          </div>
        )}

        {/* AI insight - only if meaningful */}
        {data.ai_summary?.headline && (
          <div className={cn("rounded-md p-3", colors.light)}>
            <p className={cn("text-sm font-medium", colors.text)}>
              {data.ai_summary.headline}
            </p>
            {data.ai_summary.merchantAction && (
              <p className="text-xs text-gray-500 mt-1">
                {data.ai_summary.merchantAction}
              </p>
            )}
          </div>
        )}

        {/* Fallback action when no AI */}
        {!data.ai_summary && data.recommended_action && (
          <p className="text-xs text-gray-500 pt-2 border-t border-gray-100">
            {data.recommended_action}
          </p>
        )}
      </div>
    </div>
  )
}

// Hook for fetching Scout data
export function useScoutData(shipmentId: string | null, includeAI: boolean = false) {
  const [data, setData] = React.useState<ScoutProbabilityData | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!shipmentId) {
      setData(null)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    const url = `/api/data/shipments/${shipmentId}/probability${includeAI ? '?ai=true' : ''}`

    fetch(url)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch probability data')
        return res.json()
      })
      .then((result) => {
        if (!cancelled) {
          setData(result)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message)
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [shipmentId, includeAI])

  return { data, isLoading, error }
}
