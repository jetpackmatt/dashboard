"use client"

import * as React from "react"
import {
  CheckCircle2Icon,
  PackageCheckIcon,
  RotateCcwIcon,
  AlertTriangleIcon,
  XCircleIcon,
  MapPinIcon,
} from "lucide-react"
import { JetpackLoader } from "@/components/jetpack-loader"
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
  errorCode?: string | null
  compact?: boolean
}

// Terminal status configuration
// isPositive: true = good outcome (held for pickup)
// isReturn: true = item returning to warehouse (not a loss)
interface TerminalStatusConfig {
  label: string
  subtitle: string
  action: string
  isReturn?: boolean
  isPositive?: boolean
  icon: 'check' | 'package' | 'return' | 'alert' | 'x'
}

const TERMINAL_STATUS_LABELS: Record<string, TerminalStatusConfig> = {
  // POSITIVE: Package arrived safely, waiting for customer
  held_for_pickup: {
    label: 'Ready for Pickup',
    subtitle: 'Package arrived safely',
    action: 'Consider sending a pickup reminder to the customer',
    isPositive: true,
    icon: 'package',
  },
  // RETURNS: Item coming back to warehouse (not a loss)
  returned_to_shipper: {
    label: 'Returning to Warehouse',
    subtitle: 'Package is on its way back',
    action: 'Reship or refund once received',
    isReturn: true,
    icon: 'return',
  },
  delivery_refused: {
    label: 'Delivery Refused',
    subtitle: 'Customer declined the package',
    action: 'Contact customer to resolve, then reship or refund',
    isReturn: true,
    icon: 'return',
  },
  // NEGATIVE: Actual issues
  seized_or_confiscated: {
    label: 'Seized by Customs',
    subtitle: 'Package cannot be delivered',
    action: 'Issue refund to customer',
    icon: 'x',
  },
  unable_to_locate: {
    label: 'Unable to Locate',
    subtitle: 'Carrier cannot find the package',
    action: 'Consider filing a lost in transit claim',
    icon: 'alert',
  },
}

// Get the primary terminal status from risk factors
function getTerminalStatus(riskFactors: string[]): TerminalStatusConfig | null {
  for (const factor of riskFactors) {
    if (TERMINAL_STATUS_LABELS[factor]) {
      return TERMINAL_STATUS_LABELS[factor]
    }
  }
  return null
}

// Icon component for terminal status
function TerminalStatusIcon({ type, className }: { type: TerminalStatusConfig['icon']; className?: string }) {
  switch (type) {
    case 'check':
      return <CheckCircle2Icon className={className} />
    case 'package':
      return <PackageCheckIcon className={className} />
    case 'return':
      return <RotateCcwIcon className={className} />
    case 'alert':
      return <AlertTriangleIcon className={className} />
    case 'x':
      return <XCircleIcon className={className} />
  }
}

export function ScoutInsightCard({
  shipmentId,
  data,
  isLoading = false,
  error = null,
  errorCode = null,
  compact = false,
}: ScoutInsightCardProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="flex items-center justify-center gap-2 text-gray-400">
          <JetpackLoader size="sm" />
          <span className="text-sm">Analyzing...</span>
        </div>
      </div>
    )
  }

  // Error states with specific handling
  if (error || !data) {
    // Handle specific error codes
    if (errorCode === 'PICKUP_CANCELLED') {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-medium text-amber-700">Pickup Cancelled</p>
          <p className="text-xs text-amber-600 mt-1">This shipment never entered transit</p>
        </div>
      )
    }

    if (errorCode === 'NOT_IN_TRANSIT') {
      return (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
          <p className="text-sm text-gray-500">Awaiting carrier pickup</p>
        </div>
      )
    }

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
      // Determine compact badge color based on terminal type
      const isPositive = terminalStatus.isPositive === true
      const isReturn = terminalStatus.isReturn === true
      return (
        <div className={cn(
          "inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium",
          isPositive ? "bg-emerald-50 text-emerald-700" : isReturn ? "bg-amber-50 text-amber-700" : "bg-red-50 text-red-700"
        )}>
          <TerminalStatusIcon
            type={terminalStatus.icon}
            className={cn(
              "h-3.5 w-3.5",
              isPositive ? "text-emerald-500" : isReturn ? "text-amber-500" : "text-red-500"
            )}
          />
          <span>{terminalStatus.label}</span>
        </div>
      )
    }
    return (
      <div className={cn(
        "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs",
        isCritical ? "bg-red-50" : "bg-gray-100"
      )}>
        <span className={cn("font-semibold tabular-nums", isCritical ? "text-red-600" : "text-gray-700")}>
          {pct}%
        </span>
        <span className={isCritical ? "text-red-300" : "text-gray-300"}>·</span>
        <span className={isCritical ? "text-red-500" : "text-gray-500"}>{data.daysInTransit.toFixed(0)}d</span>
      </div>
    )
  }

  // Full card view
  // For terminal states, show a clean, elegant card with icon
  if (isTerminal) {
    const isPositive = terminalStatus.isPositive === true
    const isReturn = terminalStatus.isReturn === true

    // Color scheme based on status type
    const colorScheme = isPositive
      ? {
          border: 'border-emerald-100',
          bg: 'bg-gradient-to-br from-emerald-50/80 to-white',
          iconBg: 'bg-emerald-100',
          iconColor: 'text-emerald-600',
          titleColor: 'text-emerald-900',
          subtitleColor: 'text-emerald-600',
          textColor: 'text-emerald-700',
          mutedColor: 'text-emerald-500',
        }
      : isReturn
      ? {
          border: 'border-amber-100',
          bg: 'bg-gradient-to-br from-amber-50/80 to-white',
          iconBg: 'bg-amber-100',
          iconColor: 'text-amber-600',
          titleColor: 'text-amber-900',
          subtitleColor: 'text-amber-600',
          textColor: 'text-amber-700',
          mutedColor: 'text-amber-500',
        }
      : {
          border: 'border-red-100',
          bg: 'bg-gradient-to-br from-red-50/80 to-white',
          iconBg: 'bg-red-100',
          iconColor: 'text-red-600',
          titleColor: 'text-red-900',
          subtitleColor: 'text-red-600',
          textColor: 'text-red-700',
          mutedColor: 'text-red-500',
        }

    return (
      <div className={cn('rounded-xl border p-4', colorScheme.border, colorScheme.bg)}>
        {/* Header with icon */}
        <div className="flex items-start gap-3">
          <div className={cn('rounded-lg p-2', colorScheme.iconBg)}>
            <TerminalStatusIcon type={terminalStatus.icon} className={cn('h-5 w-5', colorScheme.iconColor)} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className={cn('font-semibold text-[15px]', colorScheme.titleColor)}>
              {terminalStatus.label}
            </h3>
            <p className={cn('text-xs mt-0.5', colorScheme.subtitleColor)}>
              {terminalStatus.subtitle}
            </p>
          </div>
          <div className="text-right">
            <span className={cn('text-xs font-medium tabular-nums', colorScheme.mutedColor)}>
              {data.daysInTransit.toFixed(0)}d
            </span>
          </div>
        </div>

        {/* Action suggestion */}
        <div className={cn('mt-3 pt-3 border-t border-dashed', colorScheme.border)}>
          <p className={cn('text-xs leading-relaxed', colorScheme.textColor)}>
            {terminalStatus.action}
          </p>
        </div>

        {/* AI insight - only for non-positive terminal states (returns/negative may benefit from context) */}
        {!isPositive && data.ai_summary?.merchantAction && (
          <div className={cn('mt-3 pt-3 border-t', colorScheme.border)}>
            <p className={cn('text-xs leading-relaxed italic', colorScheme.mutedColor)}>
              {data.ai_summary.merchantAction}
            </p>
          </div>
        )}
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
  const [errorCode, setErrorCode] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!shipmentId) {
      setData(null)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)
    setErrorCode(null)

    const url = `/api/data/shipments/${shipmentId}/probability${includeAI ? '?ai=true' : ''}`

    fetch(url)
      .then(async (res) => {
        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}))
          const err = new Error(errorData.error || 'Failed to fetch probability data')
          ;(err as unknown as Record<string, string>).code = errorData.code
          throw err
        }
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
          setErrorCode((err as unknown as Record<string, string>).code || null)
          setIsLoading(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [shipmentId, includeAI])

  return { data, isLoading, error, errorCode }
}
