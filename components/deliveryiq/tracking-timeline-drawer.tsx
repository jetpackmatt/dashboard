"use client"

import * as React from "react"
import { format, formatDistanceToNow } from "date-fns"
import {
  TruckIcon,
  MapPinIcon,
  AlertTriangleIcon,
  CheckCircle2Icon,
  CircleDotIcon,
  WarehouseIcon,
  ClockIcon,
  ExternalLinkIcon,
  PackageCheckIcon,
  RotateCcwIcon,
  XCircleIcon,
} from "lucide-react"

import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { JetpackLoader } from "@/components/jetpack-loader"
import { cn } from "@/lib/utils"
import { getCarrierDisplayName, getTrackingUrl } from "@/components/transactions/cell-renderers"
import { ScoutInsightCard, useScoutData, type ScoutProbabilityData } from "@/components/lookout/scout-insight-card"

// ============================================
// TYPES
// ============================================

interface TimelineEvent {
  timestamp: string
  title: string
  description: string
  location: string | null
  source: 'shipbob' | 'carrier'
  type: 'warehouse' | 'transit' | 'delivery' | 'exception' | 'info'
  status?: string
  // AI-normalized fields (for carrier events)
  normalizedType?: string  // LABEL, PICKUP, HUB, LOCAL, OFD, DELIVERED, etc.
  sentiment?: 'positive' | 'neutral' | 'concerning' | 'critical'
}

interface TrackingTimelineData {
  trackingNumber: string
  carrier: string
  carrierDisplayName: string
  currentStatus: string
  claimStatus: string | null  // Care ticket status if claim was filed
  estimatedDelivery: string | null
  timeline: TimelineEvent[]
  lastCarrierScan: {
    date: string | null
    description: string | null  // Raw carrier description
    displayTitle: string | null  // AI-normalized friendly title
    location: string | null
    daysSince: number | null
    normalizedType: string | null  // LABEL, PICKUP, HUB, LOCAL, OFD, DELIVERED, etc.
    sentiment: 'positive' | 'neutral' | 'concerning' | 'critical' | null
  }
  shipmentInfo: {
    shipmentId: string
    shipDate: string | null
    firstScanDate: string | null
    origin: string | null
    destination: string | null
  }
}

interface TrackingTimelineDrawerProps {
  trackingNumber: string | null
  carrier: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ============================================
// HELPER COMPONENTS
// ============================================

function TimelineIcon({ type, source }: { type: TimelineEvent['type']; source: TimelineEvent['source'] }) {
  const iconClass = "h-4 w-4"

  if (type === 'delivery') {
    return <CheckCircle2Icon className={cn(iconClass, "text-green-600")} />
  }
  if (type === 'exception') {
    return <AlertTriangleIcon className={cn(iconClass, "text-amber-600")} />
  }
  if (source === 'shipbob') {
    return <WarehouseIcon className={cn(iconClass, "text-blue-600")} />
  }
  if (type === 'transit') {
    return <TruckIcon className={cn(iconClass, "text-indigo-600")} />
  }
  return <CircleDotIcon className={cn(iconClass, "text-gray-400")} />
}

// Terminal status types for intelligent header
interface TerminalStateInfo {
  isTerminal: boolean
  isPositive: boolean
  isReturn: boolean
  label: string
  subtitle: string
  action: string
  icon: 'check' | 'package' | 'return' | 'alert' | 'x'
}

// Carrier-specific pickup hold periods (days before return to sender)
// Only carriers with retail pickup locations are listed here
// Last-mile carriers (Veho, OnTrac, BetterTrucks, UniUni, etc.) deliver to door only
const CARRIER_PICKUP_HOLD_DAYS: Record<string, number> = {
  'USPS': 15,           // USPS holds at post office for 15 days
  'FedEx': 7,           // FedEx Office / Ship Center holds 5-7 days
  'UPS': 7,             // UPS Store / Access Point holds 5-7 days
  'DHL': 7,             // DHL Service Point holds ~7 days
  'DHLExpress': 7,
}

// Get hold period for a carrier (returns null if carrier doesn't have pickup locations)
function getCarrierHoldDays(carrier: string): number | null {
  // Try exact match first
  if (CARRIER_PICKUP_HOLD_DAYS[carrier]) {
    return CARRIER_PICKUP_HOLD_DAYS[carrier]
  }
  // Try partial match (e.g., "USPS Ground Advantage" → "USPS")
  for (const [key, days] of Object.entries(CARRIER_PICKUP_HOLD_DAYS)) {
    if (carrier.toLowerCase().includes(key.toLowerCase())) {
      return days
    }
  }
  return null // Unknown carrier or last-mile carrier without pickup locations
}

// Detect terminal state from Scout data
function getTerminalStateFromScout(scoutData: ScoutProbabilityData | null, carrier?: string): TerminalStateInfo | null {
  if (!scoutData) return null

  // For held_for_pickup, generate dynamic subtitle based on carrier (if they have pickup locations)
  const holdDays = carrier ? getCarrierHoldDays(carrier) : null
  const pickupSubtitle = holdDays
    ? `${carrier} holds packages for ${holdDays} days`
    : '' // No subtitle for unknown carriers or last-mile carriers

  const terminalStates: Record<string, TerminalStateInfo> = {
    held_for_pickup: {
      isTerminal: true,
      isPositive: true,
      isReturn: false,
      label: 'Available for Pickup',
      subtitle: pickupSubtitle,
      action: 'Consider sending a pickup reminder to the customer',
      icon: 'package',
    },
    returned_to_shipper: {
      isTerminal: true,
      isPositive: false,
      isReturn: true,
      label: 'Returning to Warehouse',
      subtitle: 'Package is on its way back',
      action: 'Reship or refund once received',
      icon: 'return',
    },
    delivery_refused: {
      isTerminal: true,
      isPositive: false,
      isReturn: true,
      label: 'Delivery Refused',
      subtitle: 'Customer declined the package',
      action: 'Contact customer to resolve, then reship or refund',
      icon: 'return',
    },
    seized_or_confiscated: {
      isTerminal: true,
      isPositive: false,
      isReturn: false,
      label: 'Seized by Customs',
      subtitle: 'Package cannot be delivered',
      action: 'Issue refund to customer',
      icon: 'x',
    },
    unable_to_locate: {
      isTerminal: true,
      isPositive: false,
      isReturn: false,
      label: 'Unable to Locate',
      subtitle: 'Carrier cannot find the package',
      action: 'Consider filing a lost in transit claim',
      icon: 'alert',
    },
  }

  // Check risk factors for terminal state indicators
  for (const factor of scoutData.riskFactors || []) {
    if (terminalStates[factor]) {
      return terminalStates[factor]
    }
  }

  return null
}

// Get header colors based on state
function getHeaderColors(terminalState: TerminalStateInfo | null, scoutData: ScoutProbabilityData | null) {
  // Terminal positive (held for pickup) = green
  if (terminalState?.isPositive) {
    return {
      gradient: 'from-emerald-50 to-green-50 dark:from-emerald-950/30 dark:to-green-950/30',
      border: 'border-emerald-200/50',
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
    }
  }

  // Terminal return (returned, refused) = amber
  if (terminalState?.isReturn) {
    return {
      gradient: 'from-amber-50 to-orange-50 dark:from-amber-950/30 dark:to-orange-950/30',
      border: 'border-amber-200/50',
      iconBg: 'bg-amber-100',
      iconColor: 'text-amber-600',
    }
  }

  // Terminal negative (seized, lost) = red
  if (terminalState?.isTerminal) {
    return {
      gradient: 'from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30',
      border: 'border-red-200/50',
      iconBg: 'bg-red-100',
      iconColor: 'text-red-600',
    }
  }

  // At-risk non-terminal = default blue
  return {
    gradient: 'from-indigo-50 to-blue-50 dark:from-indigo-950/30 dark:to-blue-950/30',
    border: 'border-indigo-200/50',
    iconBg: 'bg-indigo-100',
    iconColor: 'text-indigo-600',
  }
}

// Terminal status icon
function TerminalIcon({ type, className }: { type: TerminalStateInfo['icon']; className?: string }) {
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

// Intelligent status badge - uses Scout data when available
function IntelligentStatusBadge({
  status,
  claimStatus,
  scoutData,
  terminalState,
}: {
  status: string
  claimStatus?: string | null
  scoutData: ScoutProbabilityData | null
  terminalState: TerminalStateInfo | null
}) {
  // Terminal state takes priority
  if (terminalState) {
    const bgColor = terminalState.isPositive
      ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-100'
      : terminalState.isReturn
      ? 'bg-amber-100 text-amber-800 hover:bg-amber-100'
      : 'bg-red-100 text-red-800 hover:bg-red-100'

    return (
      <Badge variant="secondary" className={bgColor}>
        {terminalState.label}
      </Badge>
    )
  }

  // Claim approved = Lost
  if (claimStatus === 'Credit Approved' || claimStatus === 'Resolved') {
    return (
      <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100">
        Lost in Transit
      </Badge>
    )
  }

  // Map based on scout risk level if available
  if (scoutData) {
    const riskLevel = scoutData.riskLevel
    if (riskLevel === 'critical') {
      return (
        <Badge variant="destructive" className="bg-red-100 text-red-800 hover:bg-red-100">
          At Risk
        </Badge>
      )
    }
    if (riskLevel === 'high') {
      return (
        <Badge variant="secondary" className="bg-amber-100 text-amber-800 hover:bg-amber-100">
          Delayed
        </Badge>
      )
    }
    if (riskLevel === 'medium') {
      return (
        <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 hover:bg-yellow-100">
          Monitoring
        </Badge>
      )
    }
  }

  // Fallback to ShipBob status
  const statusLower = status.toLowerCase()
  if (statusLower === 'delivered') {
    return (
      <Badge variant="default" className="bg-green-100 text-green-800 hover:bg-green-100">
        Delivered
      </Badge>
    )
  }

  return (
    <Badge variant="secondary" className="bg-blue-100 text-blue-800 hover:bg-blue-100">
      In Transit
    </Badge>
  )
}

// Helper to strip the title from description to avoid repetition
function stripTitleFromDescription(title: string, description: string): string {
  if (!description) return ''
  // If description starts with the title, remove it
  if (description.toLowerCase().startsWith(title.toLowerCase())) {
    const remainder = description.slice(title.length).trim()
    // Remove leading punctuation or common joiners
    return remainder.replace(/^[,.\-:]+\s*/, '')
  }
  return description
}

// ============================================
// MAIN COMPONENT
// ============================================

export function TrackingTimelineDrawer({
  trackingNumber,
  carrier,
  open,
  onOpenChange,
}: TrackingTimelineDrawerProps) {
  const [data, setData] = React.useState<TrackingTimelineData | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Fetch Scout AI probability data when we have a shipment ID
  const shipmentId = data?.shipmentInfo?.shipmentId || null
  const { data: scoutData, isLoading: scoutLoading, error: scoutError } = useScoutData(shipmentId, true)

  // Fetch timeline data when drawer opens
  React.useEffect(() => {
    if (!open || !trackingNumber) {
      setData(null)
      setError(null)
      return
    }

    const fetchTimeline = async () => {
      setIsLoading(true)
      setError(null)

      try {
        const response = await fetch(
          `/api/data/tracking/${encodeURIComponent(trackingNumber)}/timeline`
        )

        if (!response.ok) {
          throw new Error('Failed to fetch tracking timeline')
        }

        const result = await response.json()
        setData(result)
      } catch (err) {
        console.error('Error fetching timeline:', err)
        setError(err instanceof Error ? err.message : 'Failed to load timeline')
      } finally {
        setIsLoading(false)
      }
    }

    fetchTimeline()
  }, [open, trackingNumber])

  // Detect terminal state from Scout data (pass carrier for pickup hold period info)
  const terminalState = getTerminalStateFromScout(scoutData, data?.carrier || carrier || undefined)
  const headerColors = getHeaderColors(terminalState, scoutData)

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[630px] sm:max-w-[630px] p-0 flex flex-col"
      >
        {/* Header - color changes based on state */}
        <div className={cn(
          "flex-shrink-0 border-b",
          `bg-gradient-to-r ${headerColors.gradient}`,
          headerColors.border
        )}>
          {/* Main header row */}
          <div className="px-6 py-4">
            <div>
              <SheetTitle className="text-lg font-semibold">
                Tracking Insights
              </SheetTitle>
              {trackingNumber && (
                <p className="text-sm text-muted-foreground mt-1 font-mono">
                  {trackingNumber}
                </p>
              )}
            </div>

            {/* Carrier, Status & Carrier Link */}
            {data && (
              <div className="flex items-center justify-between mt-3">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-medium">
                    {getCarrierDisplayName(data.carrier)}
                  </Badge>
                  <IntelligentStatusBadge
                    status={data.currentStatus}
                    claimStatus={data.claimStatus}
                    scoutData={scoutData}
                    terminalState={terminalState}
                  />
                </div>
                {trackingNumber && data?.carrier && getTrackingUrl(data.carrier, trackingNumber) && (
                  <a
                    href={getTrackingUrl(data.carrier, trackingNumber)!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                  >
                    <ExternalLinkIcon className="h-3 w-3" />
                    Carrier Site
                  </a>
                )}
              </div>
            )}
          </div>

          {/* Terminal state banner - integrated into header */}
          {terminalState && scoutData && (() => {
            // For held_for_pickup, find when it became available and calculate waiting time
            let pickupDate: Date | null = null
            let daysWaiting = 0
            let daysRemaining: number | null = null
            let transitDays = Math.round(scoutData.daysInTransit)

            if (terminalState.isPositive && data?.timeline) {
              // Find the first HOLD event (when it became available for pickup)
              const holdEvent = data.timeline.find(e =>
                e.normalizedType === 'HOLD' ||
                e.title?.toLowerCase().includes('available for pickup') ||
                e.title?.toLowerCase().includes('held at post office')
              )
              if (holdEvent) {
                pickupDate = new Date(holdEvent.timestamp)
                const now = new Date()
                daysWaiting = Math.floor((now.getTime() - pickupDate.getTime()) / (1000 * 60 * 60 * 24))

                // Calculate transit time (from ship to pickup arrival)
                if (data.shipmentInfo?.firstScanDate) {
                  const firstScan = new Date(data.shipmentInfo.firstScanDate)
                  transitDays = Math.floor((pickupDate.getTime() - firstScan.getTime()) / (1000 * 60 * 60 * 24))
                }

                // Calculate days remaining before return (if we know the hold period)
                const holdPeriod = getCarrierHoldDays(data.carrier)
                if (holdPeriod) {
                  daysRemaining = Math.max(0, holdPeriod - daysWaiting)
                }
              }
            }

            // Calculate customer experience context
            const days = transitDays // Use actual transit time, not total time
            const expectedDays = scoutData.percentiles.p50 || 5 // Default to 5 if unknown
            const daysOverExpected = days - expectedDays
            const daysAhead = expectedDays - days

            // Customer sentiment based on delivery speed (always show for positive states)
            let customerSentiment: string | null = null
            let sentimentType: 'great' | 'good' | 'neutral' | 'concerned' | 'frustrated' = 'neutral'
            const actionSuggestions: string[] = []

            if (terminalState.isPositive) {
              // Package arrived at pickup location - assess the transit experience
              if (daysAhead >= 2) {
                // Ahead of schedule - celebrate!
                customerSentiment = `Fast ${days}d transit — customer likely delighted`
                actionSuggestions.push("Perfect retention opportunity — great delivery experience")
                sentimentType = 'great'
              } else if (daysAhead >= 1 || daysOverExpected <= 0) {
                // On time or slightly ahead
                customerSentiment = `On-time ${days}d transit — customer likely satisfied`
                sentimentType = 'good'
              } else if (daysOverExpected <= 2) {
                // Slightly over but within reasonable range
                customerSentiment = `${days}d transit was slightly longer than typical`
                sentimentType = 'neutral'
              } else if (daysOverExpected <= 6) {
                // Significantly delayed transit
                customerSentiment = `${days}d transit may have disappointed customer`
                actionSuggestions.push("A brief empathetic message could turn this into a positive touchpoint")
                sentimentType = 'concerned'
              } else {
                // Extremely delayed transit
                customerSentiment = `${days}d transit likely frustrated customer`
                actionSuggestions.push("An empathetic note or courtesy gesture could help rebuild trust")
                sentimentType = 'frustrated'
              }
              // Pickup reminder is now shown in the header subtitle, no need to duplicate here
            } else if (terminalState.isReturn) {
              customerSentiment = `Customer expecting delivery — proactive outreach recommended`
              actionSuggestions.push("Reach out before they contact you to show you're on top of it")
              if (terminalState.action) {
                actionSuggestions.push(terminalState.action)
              }
              sentimentType = 'concerned'
            } else {
              // Negative terminal state (seized, lost)
              customerSentiment = `Customer will need immediate communication about this issue`
              actionSuggestions.push("Proactive outreach with a solution (refund or replacement) is essential")
              if (terminalState.action) {
                actionSuggestions.push(terminalState.action)
              }
              sentimentType = 'frustrated'
            }

            return (
            <div className={cn(
              "px-6 py-3 border-t",
              terminalState.isPositive
                ? "bg-emerald-50/50 border-emerald-200/30"
                : terminalState.isReturn
                ? "bg-amber-50/50 border-amber-200/30"
                : "bg-red-50/50 border-red-200/30"
            )}>
              <div className="flex items-center gap-3">
                {/* Icon - larger checkmark for positive states */}
                <div className={cn(
                  "rounded-full p-2.5",
                  terminalState.isPositive
                    ? "bg-emerald-100"
                    : terminalState.isReturn
                    ? "bg-amber-100"
                    : "bg-red-100"
                )}>
                  {terminalState.isPositive ? (
                    <CheckCircle2Icon className="h-5 w-5 text-emerald-600" />
                  ) : (
                    <TerminalIcon
                      type={terminalState.icon}
                      className={cn(
                        "h-5 w-5",
                        terminalState.isReturn ? "text-amber-600" : "text-red-600"
                      )}
                    />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={cn(
                    "text-base font-semibold",
                    terminalState.isPositive
                      ? "text-emerald-900"
                      : terminalState.isReturn
                      ? "text-amber-900"
                      : "text-red-900"
                  )}>
                    {terminalState.label}
                  </p>
                  {/* Dynamic subtitle for held_for_pickup showing waiting time and days remaining */}
                  {terminalState.isPositive && daysWaiting > 0 ? (
                    <p className={cn(
                      "text-xs mt-0.5",
                      daysRemaining !== null && daysRemaining <= 3 ? "text-amber-600 font-medium" : "text-emerald-600"
                    )}>
                      {daysRemaining !== null
                        ? daysRemaining === 0
                          ? `Waiting ${daysWaiting}d — returns to sender today! Remind your customer.`
                          : daysRemaining <= 3
                          ? `Waiting ${daysWaiting}d — only ${daysRemaining}d left before return! Remind your customer.`
                          : `Waiting ${daysWaiting}d — ${daysRemaining}d left to pickup`
                        : `Waiting ${daysWaiting}d for customer pickup`
                      }
                    </p>
                  ) : terminalState.subtitle ? (
                    <p className={cn(
                      "text-xs mt-0.5",
                      terminalState.isPositive
                        ? "text-emerald-600"
                        : terminalState.isReturn
                        ? "text-amber-600"
                        : "text-red-600"
                    )}>
                      {terminalState.subtitle}
                    </p>
                  ) : null}
                </div>
                {/* Days in transit box - shows actual transit time for pickup status */}
                <div className={cn(
                  "rounded-lg px-3 py-2 text-center min-w-[72px]",
                  terminalState.isPositive
                    ? "bg-emerald-100/80"
                    : terminalState.isReturn
                    ? "bg-amber-100/80"
                    : "bg-red-100/80"
                )}>
                  <p className={cn(
                    "text-xl font-bold tabular-nums leading-none",
                    terminalState.isPositive
                      ? "text-emerald-700"
                      : terminalState.isReturn
                      ? "text-amber-700"
                      : "text-red-700"
                  )}>
                    {transitDays}d
                  </p>
                  <p className={cn(
                    "text-[10px] uppercase tracking-wide mt-0.5",
                    terminalState.isPositive
                      ? "text-emerald-600"
                      : terminalState.isReturn
                      ? "text-amber-600"
                      : "text-red-600"
                  )}>
                    transit
                  </p>
                </div>
              </div>

              {/* Scout Assessment - Customer Experience Insight */}
              {customerSentiment && (
                <div className={cn(
                  "mt-3 pt-3 border-t",
                  terminalState.isPositive
                    ? "border-emerald-200/40"
                    : terminalState.isReturn
                    ? "border-amber-200/40"
                    : "border-red-200/40"
                )}>
                  <div className="flex items-start gap-3">
                    {/* Scout IQ emblem - circular badge with inner ring matching the checkmark icon above */}
                    <div className={cn(
                      "rounded-full p-2.5 flex items-center justify-center w-10 h-10 shrink-0",
                      terminalState.isPositive
                        ? "bg-emerald-100"
                        : terminalState.isReturn
                        ? "bg-amber-100"
                        : "bg-red-100"
                    )}>
                      <div className={cn(
                        "w-5 h-5 rounded-full border flex items-center justify-center",
                        terminalState.isPositive
                          ? "border-emerald-600"
                          : terminalState.isReturn
                          ? "border-amber-600"
                          : "border-red-600"
                      )}>
                        <span className={cn(
                          "text-[8px] font-bold leading-none",
                          terminalState.isPositive
                            ? "text-emerald-600"
                            : terminalState.isReturn
                            ? "text-amber-600"
                            : "text-red-600"
                        )}>
                          IQ
                        </span>
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className={cn(
                        "text-sm font-medium",
                        sentimentType === 'great' || sentimentType === 'good'
                          ? "text-emerald-900"
                          : sentimentType === 'neutral'
                          ? "text-gray-900"
                          : terminalState.isReturn
                          ? "text-amber-900"
                          : "text-red-900"
                      )}>
                        {customerSentiment}
                      </p>
                      {actionSuggestions.length > 0 && (
                        <ul className={cn(
                          "mt-1.5 space-y-1",
                          sentimentType === 'great' || sentimentType === 'good'
                            ? "text-emerald-700"
                            : sentimentType === 'neutral'
                            ? "text-gray-600"
                            : terminalState.isReturn
                            ? "text-amber-700"
                            : "text-red-700"
                        )}>
                          {actionSuggestions.map((suggestion, index) => (
                            <li key={index} className="text-xs flex items-start gap-1.5">
                              <span className="mt-1.5 w-1 h-1 rounded-full bg-current shrink-0" />
                              <span>{suggestion}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {/* Typical transit box - matching the days box above */}
                    <div className={cn(
                      "rounded-lg px-3 py-2 text-center min-w-[72px] shrink-0",
                      terminalState.isPositive
                        ? "bg-emerald-100/80"
                        : terminalState.isReturn
                        ? "bg-amber-100/80"
                        : "bg-red-100/80"
                    )}>
                      <p className={cn(
                        "text-xl font-bold tabular-nums leading-none",
                        terminalState.isPositive
                          ? "text-emerald-700"
                          : terminalState.isReturn
                          ? "text-amber-700"
                          : "text-red-700"
                      )}>
                        {expectedDays}d
                      </p>
                      <p className={cn(
                        "text-[10px] uppercase tracking-wide mt-0.5",
                        terminalState.isPositive
                          ? "text-emerald-600"
                          : terminalState.isReturn
                          ? "text-amber-600"
                          : "text-red-600"
                      )}>
                        typical
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </div>
            )
          })()}
        </div>

        {/* Content */}
        <ScrollArea className="flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center h-64">
              <JetpackLoader />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center h-64 text-center px-6">
              <AlertTriangleIcon className="h-10 w-10 text-amber-500 mb-3" />
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-4"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </div>
          ) : data ? (
            <div className="p-6 space-y-6">
              {/* Scout AI Insights Card - only show for non-terminal states */}
              {/* Terminal states already have their info integrated into the header */}
              {shipmentId && !terminalState && (
                <ScoutInsightCard
                  shipmentId={shipmentId}
                  data={scoutData}
                  isLoading={scoutLoading}
                  error={scoutError}
                />
              )}

              {/* Shipment Info Cards */}
              <div className="grid grid-cols-3 gap-3">
                {data.shipmentInfo.firstScanDate && (
                  <div className="rounded-lg border bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20 p-3">
                    <p className="text-[10px] text-blue-600 dark:text-blue-400 uppercase tracking-wide font-medium">First Scan</p>
                    <p className="text-sm font-semibold mt-1 text-blue-900 dark:text-blue-100">
                      {format(new Date(data.shipmentInfo.firstScanDate), 'MMM d, yyyy')}
                    </p>
                  </div>
                )}
                {data.lastCarrierScan.date && (
                  <div className="rounded-lg border bg-gradient-to-br from-purple-50 to-pink-50 dark:from-purple-950/20 dark:to-pink-950/20 p-3">
                    <p className="text-[10px] text-purple-600 dark:text-purple-400 uppercase tracking-wide font-medium">Last Scan</p>
                    <p className="text-sm font-semibold mt-1 text-purple-900 dark:text-purple-100">
                      {format(new Date(data.lastCarrierScan.date), 'MMM d, yyyy')}
                    </p>
                  </div>
                )}
                {data.shipmentInfo.destination && (
                  <div className="rounded-lg border bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-950/20 dark:to-teal-950/20 p-3">
                    <p className="text-[10px] text-emerald-600 dark:text-emerald-400 uppercase tracking-wide font-medium">Destination</p>
                    <p className="text-sm font-semibold mt-1 text-emerald-900 dark:text-emerald-100 truncate" title={data.shipmentInfo.destination}>
                      {data.shipmentInfo.destination}
                    </p>
                  </div>
                )}
              </div>

              {/* Timeline */}
              <div>
                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-4">
                  Timeline
                </h3>

                {data.timeline.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    No tracking events available
                  </p>
                ) : (
                  <div className="relative">
                    {/* Timeline line */}
                    <div className="absolute left-3 top-2 bottom-2 w-px bg-border" />

                    <div className="space-y-0">
                      {data.timeline.map((event, index) => (
                        <div key={`${event.timestamp}-${index}`} className="relative pl-8 pb-8">
                          {/* Icon dot */}
                          <div className="absolute left-0 top-0.5 bg-background p-0.5 rounded-full">
                            <div className={cn(
                              "rounded-full p-1",
                              event.type === 'delivery' ? "bg-green-100 dark:bg-green-900/50" :
                              event.type === 'exception' ? "bg-amber-100 dark:bg-amber-900/50" :
                              event.source === 'shipbob' ? "bg-blue-100 dark:bg-blue-900/50" :
                              "bg-gray-100 dark:bg-gray-800"
                            )}>
                              <TimelineIcon type={event.type} source={event.source} />
                            </div>
                          </div>

                          {/* Content */}
                          <div>
                            <div className="flex items-center gap-2">
                              <p className="text-sm font-medium">{event.title}</p>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "text-[10px] px-1.5 py-0 h-4",
                                  event.source === 'shipbob'
                                    ? "bg-blue-50 text-blue-700 border-blue-200"
                                    : "bg-indigo-50 text-indigo-700 border-indigo-200"
                                )}
                              >
                                {event.source === 'shipbob' ? 'Warehouse' : 'Carrier'}
                              </Badge>
                              {/* Sentiment badge for carrier events with AI normalization */}
                              {event.sentiment && (
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    "text-[10px] px-1.5 py-0 h-4",
                                    event.sentiment === 'positive' && "bg-green-50 text-green-700 border-green-200",
                                    event.sentiment === 'neutral' && "bg-gray-50 text-gray-600 border-gray-200",
                                    event.sentiment === 'concerning' && "bg-amber-50 text-amber-700 border-amber-200",
                                    event.sentiment === 'critical' && "bg-red-50 text-red-700 border-red-200"
                                  )}
                                >
                                  {event.sentiment}
                                </Badge>
                              )}
                            </div>

                            {/* Date & Location - styled as distinct metadata row */}
                            <div className="flex items-center gap-2 mt-1.5">
                              <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                                <ClockIcon className="h-3 w-3" />
                                {format(new Date(event.timestamp), 'MMM d, yyyy · h:mm a')}
                              </span>
                              {event.location && (
                                <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 px-2 py-0.5 rounded">
                                  <MapPinIcon className="h-3 w-3" />
                                  {event.location}
                                </span>
                              )}
                            </div>

                            {/* Raw description as subtext - only show if it adds meaningful context beyond the title */}
                            {event.description && event.source === 'carrier' && event.normalizedType && (
                              (() => {
                                // Don't show if description is essentially the same as title
                                const titleNorm = event.title.toLowerCase().replace(/[^a-z0-9]/g, '')
                                const descNorm = event.description.toLowerCase().replace(/[^a-z0-9]/g, '')
                                // Show if description is meaningfully longer (has extra context)
                                const hasExtraContext = descNorm.length > titleNorm.length + 10
                                // Or if it contains details the title doesn't
                                const isSubstantiallyDifferent = !descNorm.startsWith(titleNorm) && !titleNorm.startsWith(descNorm)

                                if (hasExtraContext || isSubstantiallyDifferent) {
                                  return (
                                    <p className="text-xs text-muted-foreground mt-2 leading-relaxed italic">
                                      {event.description}
                                    </p>
                                  )
                                }
                                return null
                              })()
                            )}
                            {/* For non-normalized events, strip title from description to avoid repetition */}
                            {event.description && !(event.source === 'carrier' && event.normalizedType) && (
                              (() => {
                                const cleanDesc = stripTitleFromDescription(event.title, event.description)
                                return cleanDesc && cleanDesc !== event.title ? (
                                  <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
                                    {cleanDesc}
                                  </p>
                                ) : null
                              })()
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

            </div>
          ) : null}
        </ScrollArea>
      </SheetContent>
    </Sheet>
  )
}
