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

// Terminal status labels for risk factors
const TERMINAL_STATUS_LABELS: Record<string, { label: string; action: string }> = {
  returned_to_shipper: { label: 'Returned to Sender', action: 'Reship or refund required' },
  delivery_refused: { label: 'Delivery Refused', action: 'Contact customer for resolution' },
  seized_or_confiscated: { label: 'Seized by Customs', action: 'Cannot be delivered' },
  unable_to_locate: { label: 'Unable to Locate', action: 'Consider filing claim' },
  critical_exception: { label: 'Critical Exception', action: 'Carrier investigation needed' },
  customs_delay: { label: 'Customs Delay', action: 'Monitor closely' },
}

// Get the primary terminal status from risk factors
function getTerminalStatus(riskFactors: string[]): { label: string; action: string } | null {
  for (const factor of riskFactors) {
    if (TERMINAL_STATUS_LABELS[factor]) {
      return TERMINAL_STATUS_LABELS[factor]
    }
  }
  return null
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

  // Error or no data
  if (error || !data) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <p className="text-sm text-gray-400">{error || 'No analysis available'}</p>
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

  const pct = Math.round(data.deliveryProbability * 100)
  const terminalStatus = getTerminalStatus(data.riskFactors)
  const isCritical = data.riskLevel === 'critical'
  const isTerminal = terminalStatus !== null
  const daysOverdue = data.percentiles.p50
    ? Math.max(0, Math.round(data.daysInTransit - data.percentiles.p50))
    : 0

  // Compact inline view
  if (compact) {
    if (isTerminal) {
      return (
        <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-sm bg-red-50">
          <span className="font-medium text-red-700">{terminalStatus.label}</span>
        </div>
      )
    }
    return (
      <div className={cn(
        "inline-flex items-center gap-2 px-2.5 py-1 rounded-md text-sm",
        isCritical ? "bg-red-50" : "bg-gray-50"
      )}>
        <span className={cn("font-semibold tabular-nums", isCritical ? "text-red-600" : "text-gray-700")}>
          {pct}%
        </span>
        <span className="text-gray-400">·</span>
        <span className="text-gray-500">{data.daysInTransit.toFixed(0)}d</span>
      </div>
    )
  }

  // Full card view
  // For terminal states, show a completely different layout
  if (isTerminal) {
    return (
      <div className="rounded-lg border-2 border-red-200 bg-red-50 overflow-hidden">
        {/* Terminal status banner */}
        <div className="bg-red-500 px-4 py-3">
          <p className="text-white font-semibold">{terminalStatus.label}</p>
          <p className="text-red-100 text-sm mt-0.5">{terminalStatus.action}</p>
        </div>

        <div className="p-4 space-y-3">
          {/* Stats row */}
          <div className="flex items-center justify-between text-sm">
            <div>
              <span className="text-red-900 font-semibold tabular-nums">{data.daysInTransit.toFixed(0)}</span>
              <span className="text-red-700 ml-1">days in transit</span>
            </div>
            <div className="text-right">
              <span className="text-red-600 font-semibold tabular-nums">{pct}%</span>
              <span className="text-red-500 ml-1">delivery probability</span>
            </div>
          </div>

          {/* AI insight if available */}
          {data.ai_summary?.merchantAction && (
            <p className="text-sm text-red-800 pt-2 border-t border-red-200">
              {data.ai_summary.merchantAction}
            </p>
          )}
        </div>
      </div>
    )
  }

  // Non-terminal states - show probability-focused view
  return (
    <div className={cn(
      "rounded-lg border overflow-hidden",
      isCritical ? "border-red-200 bg-white" : "border-gray-200 bg-white"
    )}>
      {/* Header with status indicator */}
      <div className={cn(
        "px-4 py-2 flex items-center justify-between",
        isCritical ? "bg-red-50" : "bg-gray-50"
      )}>
        <span className={cn(
          "text-xs font-medium uppercase tracking-wide",
          isCritical ? "text-red-600" : "text-gray-500"
        )}>
          {isCritical ? 'At Risk' : 'Delivery Analysis'}
        </span>
        {data.sampleSize > 0 && (
          <span className="text-[10px] text-gray-400">n={data.sampleSize.toLocaleString()}</span>
        )}
      </div>

      <div className="p-4 space-y-4">
        {/* Primary metrics */}
        <div className="flex items-end justify-between">
          <div>
            <div className="flex items-baseline">
              <span className={cn(
                "text-5xl font-extralight tabular-nums tracking-tight",
                isCritical ? "text-red-600" : pct >= 80 ? "text-emerald-600" : "text-amber-600"
              )}>
                {pct}
              </span>
              <span className={cn(
                "text-xl ml-0.5",
                isCritical ? "text-red-400" : pct >= 80 ? "text-emerald-400" : "text-amber-400"
              )}>%</span>
            </div>
            <p className="text-[11px] text-gray-400 mt-1">delivery probability</p>
          </div>

          <div className="text-right pb-1">
            <p className="text-2xl font-light tabular-nums text-gray-800">
              {data.daysInTransit.toFixed(0)}
              <span className="text-sm text-gray-400 ml-1">days</span>
            </p>
            {daysOverdue > 0 && (
              <p className={cn(
                "text-[11px] mt-0.5",
                isCritical ? "text-red-500" : "text-amber-500"
              )}>
                +{daysOverdue} over expected
              </p>
            )}
          </div>
        </div>

        {/* Simple progress indicator */}
        <div className="space-y-1">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className={cn(
                "h-full rounded-full transition-all",
                isCritical ? "bg-red-500" : pct >= 80 ? "bg-emerald-500" : "bg-amber-500"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
          {data.percentiles.p50 && (
            <div className="flex justify-between text-[10px] text-gray-400">
              <span>Expected: {data.percentiles.p50}d</span>
              {data.percentiles.p90 && <span>P90: {data.percentiles.p90}d</span>}
            </div>
          )}
        </div>

        {/* Risk factors for non-terminal states */}
        {data.riskFactors.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-gray-100">
            {data.riskFactors.filter(f => !TERMINAL_STATUS_LABELS[f]).map((factor) => (
              <span
                key={factor}
                className={cn(
                  "px-2 py-0.5 text-[10px] rounded-full",
                  isCritical ? "bg-red-100 text-red-600" : "bg-gray-100 text-gray-500"
                )}
              >
                {factor.replace(/_/g, ' ').replace('detected', '').replace('delivery time', '').trim()}
              </span>
            ))}
          </div>
        )}

        {/* AI insight */}
        {data.ai_summary?.headline && (
          <div className={cn(
            "rounded-md p-3 mt-2",
            isCritical ? "bg-red-50" : "bg-gray-50"
          )}>
            <p className={cn(
              "text-sm font-medium",
              isCritical ? "text-red-700" : "text-gray-700"
            )}>
              {data.ai_summary.headline}
            </p>
            {data.ai_summary.merchantAction && (
              <p className="text-xs text-gray-500 mt-1">
                {data.ai_summary.merchantAction}
              </p>
            )}
          </div>
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
