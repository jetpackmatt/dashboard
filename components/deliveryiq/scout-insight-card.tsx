"use client"

import * as React from "react"
import {
  CheckCircle2Icon,
  PackageCheckIcon,
  RotateCcwIcon,
  AlertTriangleIcon,
  XCircleIcon,
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
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 text-muted-foreground">
          <JetpackLoader size="sm" />
          <span className="text-xs">Analyzing...</span>
        </div>
      </div>
    )
  }

  // Error states with specific handling
  if (error || !data) {
    if (errorCode === 'PICKUP_CANCELLED') {
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 px-4 py-2.5">
          <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Pickup Cancelled — shipment never entered transit</p>
        </div>
      )
    }

    if (errorCode === 'NOT_IN_TRANSIT') {
      return (
        <div className="rounded-lg border border-border bg-muted/50 px-4 py-2.5">
          <p className="text-xs text-muted-foreground">Awaiting carrier pickup</p>
        </div>
      )
    }

    return (
      <div className="rounded-lg border border-border bg-card px-4 py-2.5">
        <p className="text-xs text-muted-foreground">{error || 'No analysis available'}</p>
      </div>
    )
  }

  // Insufficient confidence
  if (data.confidence === 'low' || data.confidence === 'insufficient') {
    return (
      <div className="rounded-lg border border-border bg-card px-4 py-2.5">
        <p className="text-xs text-muted-foreground">Limited data ({data.sampleSize} samples)</p>
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

  // Non-terminal states - donut + action layout
  const strokeColor = isCritical ? '#ef4444' : pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444'
  const trackColor = isCritical ? '#fecaca' : pct >= 80 ? '#d1fae5' : pct >= 50 ? '#fef3c7' : '#fecaca'
  const pctTextColor = isCritical ? 'text-red-600 dark:text-red-400' : pct >= 80 ? 'text-emerald-600 dark:text-emerald-400' : pct >= 50 ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'

  // Build human-readable reasons
  const reasons: string[] = []
  const days = Math.round(data.daysInTransit)
  if (data.percentiles.p50 && daysOverdue > 0) {
    reasons.push(`${days} days in transit — ${daysOverdue} days past the typical ${data.percentiles.p50}-day delivery`)
  } else {
    reasons.push(`${days} days in transit`)
  }
  const displayFactors = data.riskFactors.filter(f => !TERMINAL_STATUS_LABELS[f])
  const hasPastP95 = displayFactors.some(f => f.includes('p95'))
  for (const factor of displayFactors) {
    if (factor.includes('p90') && hasPastP95) continue // skip p90 when p95 present
    if (factor.includes('exception')) { reasons.push('Carrier reported a delivery exception'); continue }
    if (factor.includes('attempt_failed') || factor.includes('attempt failed')) { reasons.push('A delivery attempt was made but failed'); continue }
    if (factor.includes('p95')) { reasons.push('Longer than 95% of similar shipments'); continue }
    if (factor.includes('p90')) { reasons.push('Longer than 90% of similar shipments'); continue }
    if (factor.includes('needs_action')) { reasons.push('Package held at facility — carrier awaiting instructions'); continue }
    if (factor.includes('stalled')) { reasons.push('No movement detected for an extended period'); continue }
    if (factor.includes('no_scans') || factor.includes('no scans')) { reasons.push('No carrier scans recorded since pickup'); continue }
    const label = factor.replace(/_/g, ' ').replace('detected', '').replace('delivery time', '').trim()
    if (label) reasons.push(label.charAt(0).toUpperCase() + label.slice(1))
  }

  // Action headline
  // Prefer AI action (arrives in phase 2), fall back to short risk-based label
  const hasNeedsAction = data.riskFactors.includes('needs_action')
  const action = hasNeedsAction ? 'Contact carrier for re-delivery'
    : data.ai_summary?.merchantAction
    || (data.riskLevel === 'critical' ? 'Consider reshipment'
      : data.riskLevel === 'high' ? 'Monitor closely'
      : 'Monitor shipment')

  // SVG donut params
  const size = 88
  const strokeWidth = 7
  const radius = (size - strokeWidth) / 2
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (pct / 100) * circumference

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      <div className="flex gap-5 p-5">
        {/* Donut + label */}
        <div className="shrink-0 flex flex-col items-center pt-0.5">
          <div className="relative" style={{ width: size, height: size }}>
            <svg width={size} height={size} className="-rotate-90">
              <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={trackColor} strokeWidth={strokeWidth} />
              <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={strokeColor} strokeWidth={strokeWidth}
                strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset} className="transition-all duration-500" />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className={cn("text-lg font-bold tabular-nums leading-none", pctTextColor)}>{pct}%</span>
              <span className="text-[7px] text-muted-foreground uppercase tracking-wider mt-1 leading-none">probability</span>
            </div>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Action + days */}
          <div className="flex items-baseline justify-between gap-2">
            <p className={cn(
              "text-base font-semibold leading-snug",
              isCritical ? "text-red-700 dark:text-red-400" : "text-foreground"
            )}>
              {action}
            </p>
            <span className="text-xs tabular-nums text-foreground font-semibold shrink-0">{days} Days</span>
          </div>

          {/* AI headline */}
          {data.ai_summary?.headline && data.ai_summary.headline !== action && (
            <p className="text-[11px] text-muted-foreground italic leading-snug">{data.ai_summary.headline}</p>
          )}

          {/* Reasons */}
          {reasons.length > 0 && (
            <ul className="mt-2 pt-2 border-t border-border space-y-0.5">
              {reasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-1.5 text-[11px] text-muted-foreground leading-relaxed">
                  <span className={cn(
                    "mt-[5px] w-1 h-1 rounded-full shrink-0",
                    isCritical ? "bg-red-400" : "bg-muted-foreground/40"
                  )} />
                  {reason}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  )
}

// Hook for fetching Scout data — two-phase: probability first (fast), then AI summary
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

    // Phase 1: Fetch probability without AI (fast — no LLM call)
    fetch(`/api/data/shipments/${shipmentId}/probability`)
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
        if (cancelled) return
        setData(result)
        setIsLoading(false)

        // Phase 2: Fetch AI summary in background, merge when ready
        if (includeAI) {
          fetch(`/api/data/shipments/${shipmentId}/probability?ai=true`)
            .then(res => res.ok ? res.json() : null)
            .then(aiResult => {
              if (!cancelled && aiResult?.ai_summary) {
                setData(prev => prev ? { ...prev, ai_summary: aiResult.ai_summary } : prev)
              }
            })
            .catch(() => {}) // AI summary is optional — fail silently
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
