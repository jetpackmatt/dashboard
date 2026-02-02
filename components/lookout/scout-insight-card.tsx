"use client"

import * as React from "react"
import {
  TrendingUpIcon,
  TrendingDownIcon,
  AlertTriangleIcon,
  CheckCircleIcon,
  ClockIcon,
  BarChart3Icon,
  SparklesIcon,
  InfoIcon,
  Loader2Icon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

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

// Risk level styling
const RISK_STYLES: Record<string, { bg: string; text: string; border: string; icon: React.ReactNode }> = {
  low: {
    bg: 'bg-green-50',
    text: 'text-green-700',
    border: 'border-green-200',
    icon: <CheckCircleIcon className="h-4 w-4 text-green-600" />,
  },
  medium: {
    bg: 'bg-yellow-50',
    text: 'text-yellow-700',
    border: 'border-yellow-200',
    icon: <ClockIcon className="h-4 w-4 text-yellow-600" />,
  },
  high: {
    bg: 'bg-orange-50',
    text: 'text-orange-700',
    border: 'border-orange-200',
    icon: <AlertTriangleIcon className="h-4 w-4 text-orange-600" />,
  },
  critical: {
    bg: 'bg-red-50',
    text: 'text-red-700',
    border: 'border-red-200',
    icon: <AlertTriangleIcon className="h-4 w-4 text-red-600" />,
  },
}

// Confidence badge styling
const CONFIDENCE_STYLES: Record<string, string> = {
  high: 'bg-green-100 text-green-700',
  medium: 'bg-yellow-100 text-yellow-700',
  low: 'bg-orange-100 text-orange-700',
  insufficient: 'bg-gray-100 text-gray-500',
}

function ProbabilityGauge({ probability, riskLevel }: { probability: number; riskLevel: string }) {
  const pct = Math.round(probability * 100)
  const riskStyle = RISK_STYLES[riskLevel] || RISK_STYLES.medium

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-medium text-muted-foreground">Delivery Probability</span>
        <span className={cn("text-2xl font-bold", riskStyle.text)}>{pct}%</span>
      </div>
      <Progress
        value={pct}
        className="h-2"
      />
      <div className="flex justify-between mt-1 text-xs text-muted-foreground">
        <span>0%</span>
        <span>100%</span>
      </div>
    </div>
  )
}

function RiskFactorsList({ factors }: { factors: string[] }) {
  if (factors.length === 0) return null

  const factorLabels: Record<string, string> = {
    exception_detected: 'Exception in tracking',
    delivery_attempt_failed: 'Failed delivery attempt',
    past_p90_delivery_time: 'Past 90% delivery window',
    past_p95_delivery_time: 'Past 95% delivery window',
  }

  return (
    <div className="space-y-1">
      <span className="text-xs font-medium text-muted-foreground">Risk Factors</span>
      <div className="flex flex-wrap gap-1">
        {factors.map((factor) => (
          <Badge key={factor} variant="outline" className="text-xs bg-red-50 text-red-700 border-red-200">
            {factorLabels[factor] || factor}
          </Badge>
        ))}
      </div>
    </div>
  )
}

function PercentileChart({ percentiles, currentDay }: { percentiles: ScoutProbabilityData['percentiles']; currentDay: number }) {
  const maxDay = Math.max(percentiles.p95 || 10, currentDay + 2)

  return (
    <div className="space-y-2">
      <span className="text-xs font-medium text-muted-foreground">Transit Benchmarks</span>
      <div className="relative h-8 bg-muted rounded-full overflow-hidden">
        {/* P50 marker */}
        {percentiles.p50 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-green-500"
            style={{ left: `${(percentiles.p50 / maxDay) * 100}%` }}
          >
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-green-600">
              P50
            </span>
          </div>
        )}
        {/* P90 marker */}
        {percentiles.p90 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-orange-500"
            style={{ left: `${(percentiles.p90 / maxDay) * 100}%` }}
          >
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-orange-600">
              P90
            </span>
          </div>
        )}
        {/* P95 marker */}
        {percentiles.p95 && (
          <div
            className="absolute top-0 bottom-0 w-0.5 bg-red-500"
            style={{ left: `${(percentiles.p95 / maxDay) * 100}%` }}
          >
            <span className="absolute -top-5 left-1/2 -translate-x-1/2 text-[10px] text-red-600">
              P95
            </span>
          </div>
        )}
        {/* Current position */}
        <div
          className="absolute top-1 bottom-1 w-3 h-3 rounded-full bg-blue-600 border-2 border-white shadow-sm -ml-1.5"
          style={{ left: `${Math.min((currentDay / maxDay) * 100, 100)}%` }}
        />
        {/* Fill to current */}
        <div
          className="absolute top-0 bottom-0 left-0 bg-blue-200 opacity-50"
          style={{ width: `${Math.min((currentDay / maxDay) * 100, 100)}%` }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-muted-foreground">
        <span>Day 0</span>
        <span>Day {Math.round(maxDay)}</span>
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
  if (isLoading) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-center py-8">
          <Loader2Icon className="h-6 w-6 animate-spin text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">Analyzing shipment...</span>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card className="border-dashed border-orange-200 bg-orange-50">
        <CardContent className="flex items-center justify-center py-6">
          <AlertTriangleIcon className="h-5 w-5 text-orange-500" />
          <span className="ml-2 text-sm text-orange-700">{error}</span>
        </CardContent>
      </Card>
    )
  }

  if (!data) {
    return (
      <Card className="border-dashed">
        <CardContent className="flex items-center justify-center py-6">
          <InfoIcon className="h-5 w-5 text-muted-foreground" />
          <span className="ml-2 text-sm text-muted-foreground">No probability data available</span>
        </CardContent>
      </Card>
    )
  }

  // Don't display probability for low/insufficient confidence - not reliable enough
  if (data.confidence === 'low' || data.confidence === 'insufficient') {
    return (
      <Card className="border-dashed border-gray-200">
        <CardContent className="flex items-center justify-center py-6">
          <InfoIcon className="h-5 w-5 text-gray-400" />
          <span className="ml-2 text-sm text-gray-500">
            Insufficient data for probability analysis ({data.sampleSize} samples)
          </span>
        </CardContent>
      </Card>
    )
  }

  const riskStyle = RISK_STYLES[data.riskLevel] || RISK_STYLES.medium

  // Compact view for inline display
  if (compact) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <div className={cn(
              "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border cursor-help",
              riskStyle.bg,
              riskStyle.border
            )}>
              {riskStyle.icon}
              <span className={cn("font-semibold", riskStyle.text)}>
                {Math.round(data.deliveryProbability * 100)}%
              </span>
              <Badge variant="outline" className={cn("text-[10px]", CONFIDENCE_STYLES[data.confidence])}>
                {data.confidence}
              </Badge>
            </div>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="max-w-xs">
            <p className="font-medium">{data.ai_summary?.headline || data.summary}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {data.daysInTransit.toFixed(1)} days in transit • {data.riskFactors.length} risk factors
            </p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Full card view
  return (
    <Card className={cn("overflow-hidden", riskStyle.border)}>
      <CardHeader className={cn("py-3", riskStyle.bg)}>
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <BarChart3Icon className="h-4 w-4" />
            Scout Analysis
          </CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="outline" className={cn("text-xs", CONFIDENCE_STYLES[data.confidence])}>
              {data.confidence} confidence
            </Badge>
            {data.sampleSize > 0 && (
              <span className="text-xs text-muted-foreground">
                n={data.sampleSize.toLocaleString()}
              </span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 pt-4">
        {/* AI Summary (if available) */}
        {data.ai_summary && (
          <div className={cn("rounded-lg p-3 border", riskStyle.bg, riskStyle.border)}>
            <div className="flex items-start gap-2">
              <SparklesIcon className="h-4 w-4 text-indigo-500 mt-0.5 flex-shrink-0" />
              <div>
                <p className={cn("font-semibold", riskStyle.text)}>{data.ai_summary.headline}</p>
                <p className="text-sm text-muted-foreground mt-1">{data.ai_summary.summary}</p>
              </div>
            </div>
          </div>
        )}

        {/* Probability gauge */}
        <ProbabilityGauge probability={data.deliveryProbability} riskLevel={data.riskLevel} />

        {/* Transit benchmarks */}
        <PercentileChart percentiles={data.percentiles} currentDay={data.daysInTransit} />

        {/* Risk factors */}
        <RiskFactorsList factors={data.riskFactors} />

        {/* Transit stats */}
        <div className="grid grid-cols-2 gap-4 pt-2 border-t">
          <div>
            <p className="text-xs text-muted-foreground">Days in Transit</p>
            <p className="text-lg font-semibold flex items-center gap-1">
              {data.daysInTransit.toFixed(1)}
              {data.daysInTransit > (data.percentiles.p90 || 7) ? (
                <TrendingDownIcon className="h-4 w-4 text-red-500" />
              ) : (
                <TrendingUpIcon className="h-4 w-4 text-green-500" />
              )}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Expected (P50)</p>
            <p className="text-lg font-semibold">
              {data.percentiles.p50 ? `${data.percentiles.p50} days` : '—'}
            </p>
          </div>
        </div>

        {/* Recommended action */}
        {(data.ai_summary?.merchantAction || data.recommended_action) && (
          <div className="pt-2 border-t">
            <p className="text-xs font-medium text-muted-foreground mb-1">Recommended Action</p>
            <p className="text-sm font-medium">
              {data.ai_summary?.merchantAction || data.recommended_action}
            </p>
          </div>
        )}

        {/* Segment info (collapsed) */}
        <details className="pt-2 border-t">
          <summary className="text-xs text-muted-foreground cursor-pointer hover:text-foreground">
            Segment details
          </summary>
          <div className="mt-2 text-xs text-muted-foreground space-y-1">
            <p>Carrier: {data.segmentUsed.carrier}</p>
            <p>Service: {data.segmentUsed.service_bucket}</p>
            <p>Zone: {data.segmentUsed.zone_bucket}</p>
            <p>Season: {data.segmentUsed.season_bucket}</p>
          </div>
        </details>
      </CardContent>
    </Card>
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
