"use client"

import * as React from "react"
import {
  ArrowRightIcon,
  ClockIcon,
  EyeIcon,
  PauseIcon,
  MapPinIcon,
  CornerDownLeftIcon,
  XCircleIcon,
  SparklesIcon,
} from "lucide-react"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@/components/ui/hover-card"

// AI Status Badge types
export type AiStatusBadgeValue = 'MOVING' | 'DELAYED' | 'WATCHLIST' | 'STALLED' | 'STUCK' | 'RETURNING' | 'LOST' | null

// AI Assessment interface
export interface AiAssessmentData {
  statusBadge: string
  riskLevel: string
  customerSentiment: string
  merchantAction: string
  reshipmentUrgency: number
  keyInsight: string
  nextMilestone: string
  confidence: number
}

interface AiStatusBadgeProps {
  statusBadge: AiStatusBadgeValue
  assessment: AiAssessmentData | null
  claimStatus: 'at_risk' | 'eligible' | 'claim_filed' | 'approved' | 'denied' | null
}

// Badge configuration by status
const BADGE_CONFIG: Record<string, { color: string; icon: React.ReactNode; label: string }> = {
  MOVING: {
    color: 'bg-lime-100 text-lime-700 border-lime-200',
    icon: <ArrowRightIcon className="h-3 w-3" />,
    label: 'MOVING',
  },
  DELAYED: {
    color: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    icon: <ClockIcon className="h-3 w-3" />,
    label: 'DELAYED',
  },
  WATCHLIST: {
    color: 'bg-amber-100 text-amber-700 border-amber-200',
    icon: <EyeIcon className="h-3 w-3" />,
    label: 'WATCHLIST',
  },
  STALLED: {
    color: 'bg-orange-100 text-orange-700 border-orange-200',
    icon: <PauseIcon className="h-3 w-3" />,
    label: 'STALLED',
  },
  STUCK: {
    color: 'bg-red-100 text-red-600 border-red-200',
    icon: <MapPinIcon className="h-3 w-3" />,
    label: 'STUCK',
  },
  RETURNING: {
    color: 'bg-purple-100 text-purple-700 border-purple-200',
    icon: <CornerDownLeftIcon className="h-3 w-3" />,
    label: 'RETURNING',
  },
  LOST: {
    color: 'bg-red-100 text-red-700 border-red-200',
    icon: <XCircleIcon className="h-3 w-3" />,
    label: 'LOST',
  },
}

// Risk level colors
const RISK_COLORS: Record<string, string> = {
  low: 'bg-green-100 text-green-700 border-green-200',
  medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
  high: 'bg-orange-100 text-orange-700 border-orange-200',
  critical: 'bg-red-100 text-red-700 border-red-200',
}

export function AiStatusBadge({ statusBadge, assessment, claimStatus }: AiStatusBadgeProps) {
  // If no AI assessment yet, show claim status badge
  if (!statusBadge && !assessment) {
    const claimStatusConfig: Record<string, { color: string; label: string }> = {
      at_risk: { color: 'bg-amber-100 text-amber-700 border-amber-200', label: 'At Risk' },
      eligible: { color: 'bg-red-100 text-red-700 border-red-200', label: 'Claim Ready' },
      claim_filed: { color: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Filed' },
      approved: { color: 'bg-green-100 text-green-700 border-green-200', label: 'Approved' },
      denied: { color: 'bg-gray-100 text-gray-700 border-gray-200', label: 'Denied' },
    }

    if (claimStatus && claimStatusConfig[claimStatus]) {
      return (
        <Badge
          variant="outline"
          className={cn("font-medium", claimStatusConfig[claimStatus].color)}
        >
          {claimStatusConfig[claimStatus].label}
        </Badge>
      )
    }

    return (
      <Badge variant="outline" className="text-muted-foreground">
        Pending
      </Badge>
    )
  }

  const config = statusBadge ? BADGE_CONFIG[statusBadge] : null

  // If no assessment data, just show the badge without hover
  if (!assessment) {
    return (
      <Badge
        variant="outline"
        className={cn("font-medium gap-1", config?.color || 'text-muted-foreground')}
      >
        {config?.icon}
        {config?.label || statusBadge || 'Unknown'}
      </Badge>
    )
  }

  // Full badge with hover card
  return (
    <HoverCard openDelay={200} closeDelay={100}>
      <HoverCardTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "font-medium gap-1 cursor-help",
            config?.color || 'text-muted-foreground'
          )}
        >
          {config?.icon}
          {config?.label || statusBadge || 'Unknown'}
        </Badge>
      </HoverCardTrigger>
      <HoverCardContent className="w-96" align="start" side="bottom">
        <div className="space-y-3">
          {/* Header with status and risk */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <SparklesIcon className="h-4 w-4 text-indigo-500" />
              <span className="font-semibold">{assessment.statusBadge}</span>
            </div>
            <Badge
              variant="outline"
              className={cn("text-xs", RISK_COLORS[assessment.riskLevel] || '')}
            >
              {assessment.riskLevel} risk
            </Badge>
          </div>

          {/* Key insight */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Key Insight</p>
            <p className="text-sm">{assessment.keyInsight}</p>
          </div>

          {/* Customer sentiment */}
          <div className="rounded bg-muted/50 p-2">
            <p className="text-xs font-medium text-muted-foreground mb-1">Customer Perspective</p>
            <p className="text-sm">{assessment.customerSentiment}</p>
          </div>

          {/* Recommended action */}
          <div>
            <p className="text-xs font-medium text-muted-foreground mb-1">Recommended Action</p>
            <p className="text-sm font-medium">{assessment.merchantAction}</p>
          </div>

          {/* Reshipment urgency bar */}
          {assessment.reshipmentUrgency > 30 && (
            <div>
              <div className="flex items-center justify-between mb-1">
                <p className="text-xs font-medium text-muted-foreground">Reshipment Urgency</p>
                <span className={cn(
                  "text-xs font-medium",
                  assessment.reshipmentUrgency >= 80 ? "text-red-600" :
                  assessment.reshipmentUrgency >= 60 ? "text-orange-600" :
                  "text-yellow-600"
                )}>
                  {assessment.reshipmentUrgency}%
                </span>
              </div>
              <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    assessment.reshipmentUrgency >= 80 ? "bg-red-500" :
                    assessment.reshipmentUrgency >= 60 ? "bg-orange-500" :
                    "bg-yellow-500"
                  )}
                  style={{ width: `${assessment.reshipmentUrgency}%` }}
                />
              </div>
            </div>
          )}

          {/* Next milestone */}
          <div className="pt-2 border-t">
            <p className="text-xs text-muted-foreground">
              <span className="font-medium">Next:</span> {assessment.nextMilestone}
            </p>
          </div>

          {/* Confidence */}
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <span className="flex items-center gap-1">
              <SparklesIcon className="h-3 w-3" />
              AI Assessment
            </span>
            <span>{assessment.confidence}% confidence</span>
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  )
}
