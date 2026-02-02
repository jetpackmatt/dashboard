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
import { ScoutInsightCard, useScoutData } from "@/components/lookout/scout-insight-card"

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

function StatusBadge({ status, claimStatus }: { status: string; claimStatus?: string | null }) {
  const statusLower = status.toLowerCase()

  let variant: 'default' | 'secondary' | 'destructive' | 'outline' = 'secondary'
  let className = ''
  let displayStatus = status

  // If claim was approved/resolved, show "Lost in Transit" regardless of carrier status
  if (claimStatus === 'Credit Approved' || claimStatus === 'Resolved') {
    variant = 'destructive'
    className = 'bg-red-100 text-red-800 hover:bg-red-100'
    displayStatus = 'Lost in Transit'
  }
  // Map TrackingMore statuses to user-friendly labels
  else if (statusLower === 'delivered') {
    variant = 'default'
    className = 'bg-green-100 text-green-800 hover:bg-green-100'
    displayStatus = 'Delivered'
  } else if (statusLower === 'exception' || statusLower === 'undelivered') {
    variant = 'destructive'
    displayStatus = 'Exception'
  } else if (statusLower === 'transit' || statusLower === 'pickup') {
    className = 'bg-blue-100 text-blue-800 hover:bg-blue-100'
    displayStatus = 'In Transit'
  } else if (statusLower === 'notfound' || statusLower === 'pending') {
    displayStatus = 'Pending'
  } else if (statusLower === 'expired') {
    displayStatus = 'Expired'
  } else {
    // "Completed" without delivery likely means tracking stopped updating
    // Show as "In Transit" unless explicitly delivered
    displayStatus = 'In Transit'
    className = 'bg-blue-100 text-blue-800 hover:bg-blue-100'
  }

  return (
    <Badge variant={variant} className={className}>
      {displayStatus}
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[530px] sm:max-w-[530px] p-0 flex flex-col"
      >
        {/* Header */}
        <div className="flex-shrink-0 px-6 py-4 border-b bg-gradient-to-r from-indigo-50 to-blue-50 dark:from-indigo-950/30 dark:to-blue-950/30">
          <div className="flex items-start justify-between">
            <div>
              <SheetTitle className="text-lg font-semibold flex items-center gap-2">
                <TruckIcon className="h-5 w-5 text-indigo-600" />
                Tracking Insights
              </SheetTitle>
              {trackingNumber && (
                <p className="text-sm text-muted-foreground mt-1 font-mono">
                  {trackingNumber}
                </p>
              )}
            </div>
          </div>

          {/* Carrier & Status */}
          {data && (
            <div className="flex items-center justify-between mt-3">
              <div className="flex items-center gap-3">
                <Badge variant="outline" className="font-medium">
                  {getCarrierDisplayName(data.carrier)}
                </Badge>
                <StatusBadge status={data.currentStatus} claimStatus={data.claimStatus} />
              </div>
              {trackingNumber && data?.carrier && getTrackingUrl(data.carrier, trackingNumber) && (
                <a
                  href={getTrackingUrl(data.carrier, trackingNumber)!}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                >
                  <ExternalLinkIcon className="h-3 w-3" />
                  View Carrier Tracking
                </a>
              )}
            </div>
          )}
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
              {/* Scout AI Insights Card - replaces Last Carrier Scan */}
              {shipmentId && (
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

                            {/* Raw description as subtext - always show for carrier events with normalized data */}
                            {event.description && event.source === 'carrier' && event.normalizedType && (
                              <p className="text-xs text-muted-foreground mt-2 leading-relaxed italic">
                                {event.description}
                              </p>
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
