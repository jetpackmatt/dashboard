"use client"

import * as React from "react"
import { format } from "date-fns"
import {
  AlertTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ExternalLinkIcon,
  XIcon,
} from "lucide-react"

import {
  Sheet,
  SheetContent,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { JetpackLoader } from "@/components/jetpack-loader"
import { getCarrierDisplayName } from "./transactions/cell-renderers"

// ============================================
// TYPES
// ============================================

interface ShipmentDetails {
  id: string
  shipmentId: string
  status: string
  trackingId: string
  trackingUrl: string
  orderId: string
  storeOrderId: string
  orderType: string
  channelName: string
  orderDate: string | null
  importDate: string | null
  customer: {
    name: string
    email: string
    company?: string
    address: {
      line1?: string
      line2?: string
      city: string
      state: string
      zipCode: string
      country: string
    }
  }
  shipping: {
    carrier: string
    carrierService: string
    shipOptionId: number
    zone: number
    fulfillmentCenter: string
    fcId: number
  }
  package: {
    actualWeightOz: number
    dimWeightOz: number
    billableWeightOz: number
    length: number
    width: number
    height: number
  }
  dates: {
    created: string | null
    picked: string | null
    packed: string | null
    labeled: string | null
    labelValidated: string | null
    inTransit: string | null
    outForDelivery: string | null
    delivered: string | null
    deliveryAttemptFailed: string | null
    estimatedFulfillment: string | null
    estimatedFulfillmentStatus: string | null
  }
  metrics: {
    transitTimeDays: number | null
    totalShipments: number
  }
  timeline: Array<{
    event: string
    timestamp: string
    description: string
    icon: string
  }>
  statusDetails: any[]
  items: Array<{
    id: string
    productId: string
    name: string
    sku: string
    quantity: number
    lotNumber: string
    expirationDate: string | null
  }>
  outOfStockItems: Array<{
    name: string
    sku: string
    quantity: number
  }>
  // Issue info derived from status_details on backend
  issueInfo: {
    type: 'warning' | 'error'
    issueType: string
    description: string
    affectedItems?: Array<{ name: string; sku: string; quantity: number }>
  } | null
  cartons: Array<{
    id: string
    cartonId: string
    trackingNumber: string
    weight: number
    length: number
    width: number
    height: number
  }>
  transactions: Array<{
    id: string
    transactionId: string
    cost: number
    billedAmount: number
    feeType: string
    transactionType: string
    chargeDate: string
    invoiceId: string
  }>
  returns: Array<{
    id: string
    returnId: number
    status: string
    returnType: string
    trackingNumber: string
    insertDate: string
    arrivedDate: string | null
    completedDate: string | null
  }>
  billing: {
    totalCost: number
    totalRefunds: number
  }
}

interface ShipmentDetailsDrawerProps {
  shipmentId: string | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

// ============================================
// CARRIER DETECTION FROM TRACKING NUMBER
// ============================================

// Detect carrier from tracking number format (for returns where carrier isn't stored)
function detectCarrierFromTracking(trackingNumber: string): string | null {
  if (!trackingNumber) return null
  const tracking = trackingNumber.trim().toUpperCase()

  // UPS: Starts with "1Z" followed by 16 alphanumeric characters
  if (tracking.startsWith('1Z') && tracking.length === 18) return 'ups'

  // FedEx: 12, 15, 20, or 22 digits
  if (/^\d{12}$/.test(tracking) || /^\d{15}$/.test(tracking) ||
      /^\d{20}$/.test(tracking) || /^\d{22}$/.test(tracking)) return 'fedex'

  // USPS: 20-22 digits, or specific formats
  if (/^(94|93|92|91|70|01|02)\d{18,20}$/.test(tracking)) return 'usps'
  if (/^\d{20,22}$/.test(tracking)) return 'usps'

  // DHL: 10 digits
  if (/^\d{10}$/.test(tracking)) return 'dhl'

  // OnTrac: Starts with C or D, 14-15 characters
  if (/^[CD]\d{13,14}$/.test(tracking)) return 'ontrac'

  return null
}

// ============================================
// STATUS STYLING
// ============================================

function getStatusColors(status: string) {
  switch (status) {
    case "Refunded":
      return "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50"
    case "Delivered":
      return "bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800/50"
    case "Out for Delivery":
    case "In Transit":
      return "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-900/30 dark:text-blue-400 dark:border-blue-800/50"
    case "Awaiting Carrier":
    case "Shipped":
      return "bg-cyan-100 text-cyan-700 border-cyan-200 dark:bg-cyan-900/30 dark:text-cyan-400 dark:border-cyan-800/50"
    case "Labelled":
      return "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-900/30 dark:text-violet-400 dark:border-violet-800/50"
    case "Packed":
      return "bg-indigo-100 text-indigo-700 border-indigo-200 dark:bg-indigo-900/30 dark:text-indigo-400 dark:border-indigo-800/50"
    case "Picked":
      return "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-900/30 dark:text-sky-400 dark:border-sky-800/50"
    case "Exception":
    case "Cancelled":
    case "Delivery Attempted":
    case "Invalid Address":
      return "bg-red-100 text-red-700 border-red-200 dark:bg-red-900/30 dark:text-red-400 dark:border-red-800/50"
    case "On Hold":
    case "Out of Stock":
      return "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800/50"
    default:
      return "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800/50 dark:text-slate-400 dark:border-slate-700/50"
  }
}

// ============================================
// PROGRESS TIMELINE COMPONENT
// ============================================

interface TimelineStep {
  label: string
  date: string | null
  isComplete: boolean
  isCurrent: boolean
}

// Get status badge for timeline events
function getEventStatusBadge(event: string): { label: string; color: string } | null {
  const eventLower = event.toLowerCase()
  if (eventLower.includes('picked')) return { label: 'Picked', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' }
  if (eventLower.includes('packed') || eventLower.includes('packaged')) return { label: 'Packed', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' }
  if (eventLower.includes('label') && eventLower.includes('created')) return { label: 'Labeled', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' }
  if (eventLower.includes('label') && eventLower.includes('validated')) return { label: 'Validated', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
  if (eventLower.includes('processing') || eventLower.includes('assigned')) return { label: 'Processing', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
  if (eventLower.includes('delivered')) return { label: 'Delivered', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
  if (eventLower.includes('transit')) return { label: 'In Transit', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' }
  if (eventLower.includes('out for delivery')) return { label: 'Out for Delivery', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' }
  return null
}

function ProgressTimeline({ data }: { data: ShipmentDetails }) {
  const [isExpanded, setIsExpanded] = React.useState(false)

  // Determine progress steps based on event dates
  const steps: TimelineStep[] = [
    {
      label: "Imported",
      date: data.dates.created,
      isComplete: !!data.dates.created,
      isCurrent: !!data.dates.created && !data.dates.picked && !data.dates.packed,
    },
    {
      label: "Processing",
      date: data.dates.picked || data.dates.packed,
      isComplete: !!data.dates.picked || !!data.dates.packed,
      isCurrent: (!!data.dates.picked || !!data.dates.packed) && !data.dates.labeled && !data.dates.inTransit,
    },
    {
      label: "Shipped",
      date: data.dates.labeled || data.dates.inTransit,
      isComplete: !!data.dates.labeled || !!data.dates.inTransit,
      isCurrent: (!!data.dates.labeled || !!data.dates.inTransit) && !data.dates.delivered,
    },
    {
      label: "Delivered",
      date: data.dates.delivered,
      isComplete: !!data.dates.delivered,
      isCurrent: !!data.dates.delivered,
    },
  ]

  // Calculate progress percentage
  const completedCount = steps.filter(s => s.isComplete).length
  const progressPercent = completedCount === 0 ? 0 : ((completedCount - 1) / (steps.length - 1)) * 100

  return (
    <div className="bg-muted/30 border-b border-border/50 dark:border-border/30">
      {/* Progress bar section */}
      <div className="pt-5 pb-2 px-8">
        {/* Steps container - dots and labels together */}
        <div className="relative">
          {/* Track line - positioned between first and last dot */}
          <div className="absolute top-[5px] left-[calc(12.5%-6px)] right-[calc(12.5%-6px)] h-[3px] bg-slate-200 dark:bg-slate-700 rounded-full" />
          {/* Filled track */}
          <div
            className="absolute top-[5px] left-[calc(12.5%-6px)] h-[3px] bg-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `calc(${progressPercent}% * 0.75)` }}
          />

          {/* Steps grid - 4 equal columns */}
          <div className="relative grid grid-cols-4">
            {steps.map((step) => (
              <div key={step.label} className="flex flex-col items-center">
                {/* Dot */}
                <div
                  className={`w-[13px] h-[13px] rounded-full border-2 z-10 ${
                    step.isComplete
                      ? "bg-emerald-500 border-emerald-500"
                      : "bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                  }`}
                />
                {/* Label */}
                <p className={`text-xs font-medium mt-2 ${step.isComplete ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {step.label}
                </p>
                {/* Date - only show if exists */}
                <p className="text-[10px] text-muted-foreground mt-0.5 h-[28px]">
                  {step.date ? format(new Date(step.date), "M/d/yyyy, h:mm a") : '\u00A0'}
                </p>
              </div>
            ))}
          </div>
        </div>

      </div>

      {/* View Timeline link - centered tab that connects to section divider */}
      {data.timeline.length > 0 && (
        <div className="relative flex justify-center pb-px">
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="relative inline-flex items-center gap-1 px-4 py-1 text-xs font-medium text-muted-foreground hover:text-foreground border-x border-t border-border/50 dark:border-border/30 rounded-t-md bg-background hover:bg-muted/20 transition-colors -mb-px z-10"
          >
            {isExpanded ? 'Hide Timeline Details' : 'View Timeline Details'}
            {isExpanded ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
          </button>
        </div>
      )}

      {/* Expanded detailed timeline - animated with grid */}
      {data.timeline.length > 0 && (
        <div
          className={`grid transition-all duration-300 ease-in-out ${
            isExpanded ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          }`}
        >
          <div className="overflow-hidden">
            <div className="px-6 pb-4 pt-2 border-t border-border/40 dark:border-border/20">
              <div className="relative">
                {/* Single continuous vertical line for ALL events */}
                {data.timeline.length > 1 && (
                  <div
                    className="absolute left-[4px] top-[10px] w-0.5 bg-emerald-200 dark:bg-emerald-800"
                    style={{ height: 'calc(100% - 20px)' }}
                  />
                )}

                {/* Render events with date headers inline */}
                {(() => {
                  let lastDateKey = ''
                  return data.timeline.map((event, index) => {
                    const badge = getEventStatusBadge(event.event)
                    const isLast = index === data.timeline.length - 1
                    const dateKey = format(new Date(event.timestamp), "MMMM do, yyyy")
                    const showDateHeader = dateKey !== lastDateKey
                    lastDateKey = dateKey

                    return (
                      <div key={`${event.event}-${event.timestamp}`}>
                        {/* Date header when date changes */}
                        {showDateHeader && (
                          <div className={`ml-6 ${index === 0 ? 'mb-3' : 'mt-6 mb-3'}`}>
                            <h4 className="text-sm font-semibold text-foreground">{dateKey}</h4>
                          </div>
                        )}

                        {/* Event row */}
                        <div className={`flex gap-3 ${isLast ? '' : 'mb-5'}`}>
                          {/* Timeline dot */}
                          <div className="flex flex-col items-center">
                            <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shrink-0 mt-1 z-10" />
                          </div>

                          {/* Event content */}
                          <div className="flex-1">
                            <p className="text-xs text-muted-foreground mb-0.5">
                              {format(new Date(event.timestamp), "h:mm a")} EST
                            </p>
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm text-foreground">{event.event}</p>
                              {badge && (
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}>
                                  {badge.label}
                                </span>
                              )}
                            </div>
                            {event.description && (
                              <p className="text-xs text-muted-foreground mt-0.5">{event.description}</p>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })
                })()}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}


// ============================================
// ISSUE ALERT COMPONENT
// ============================================

interface IssueAlertProps {
  data: ShipmentDetails
}

function IssueAlert({ data }: IssueAlertProps) {
  // Use issueInfo from API (derived from status_details on backend)
  const issueInfo = data.issueInfo
  if (!issueInfo) return null

  const isError = issueInfo.type === 'error'
  const hasAffectedItems = issueInfo.affectedItems && issueInfo.affectedItems.length > 0

  return (
    <div className={`rounded-lg p-4 ${isError ? 'bg-red-500/10 dark:bg-red-500/5' : 'bg-amber-500/10 dark:bg-amber-500/5'}`}>
      <div className="flex gap-3">
        <AlertTriangleIcon className={`h-5 w-5 shrink-0 ${isError ? 'text-red-500' : 'text-amber-500'}`} />
        <div className="space-y-1">
          <p className={`text-sm font-semibold ${isError ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
            {issueInfo.issueType}
          </p>
          <p className="text-sm text-muted-foreground">
            {issueInfo.description}
          </p>
          {hasAffectedItems && (
            <div className="pt-2">
              <p className="text-xs text-muted-foreground mb-1.5">Affected items:</p>
              <div className="space-y-1">
                {issueInfo.affectedItems!.map((item, idx) => (
                  <p key={idx} className="text-sm text-foreground">
                    • {item.name || item.sku}
                  </p>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ============================================
// MAIN COMPONENT
// ============================================

export function ShipmentDetailsDrawer({
  shipmentId,
  open,
  onOpenChange,
}: ShipmentDetailsDrawerProps) {
  const [data, setData] = React.useState<ShipmentDetails | null>(null)
  const [isLoading, setIsLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  // Fetch shipment details when opened
  React.useEffect(() => {
    if (open && shipmentId) {
      setIsLoading(true)
      setError(null)

      fetch(`/api/data/shipments/${shipmentId}`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load shipment")
          return res.json()
        })
        .then((data) => {
          setData(data)
          setIsLoading(false)
        })
        .catch((err) => {
          setError(err.message)
          setIsLoading(false)
        })
    }
  }, [open, shipmentId])

  // Reset when closed
  React.useEffect(() => {
    if (!open) {
      setData(null)
      setError(null)
    }
  }, [open])

  // Get tracking URL for the carrier
  const getTrackingUrl = (carrier: string, trackingId: string): string | null => {
    if (!trackingId) return null
    const carrierLower = carrier?.toLowerCase() || ''
    if (carrierLower.includes('ups')) return `https://www.ups.com/track?tracknum=${trackingId}`
    if (carrierLower.includes('fedex')) return `https://www.fedex.com/fedextrack/?trknbr=${trackingId}`
    if (carrierLower.includes('usps')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingId}`
    if (carrierLower.includes('dhl')) return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${trackingId}`
    if (carrierLower.includes('ontrac')) return `https://www.ontrac.com/tracking/?number=${trackingId}`
    if (carrierLower.includes('amazon')) return `https://track.amazon.com/tracking/${trackingId}`
    if (carrierLower.includes('veho')) return `https://track.shipveho.com/#/trackingId/${trackingId}`
    return null
  }

  // Format weight from oz to lbs and oz
  const formatWeight = (oz: number | null | undefined): string => {
    if (!oz) return "-"
    const lbs = Math.floor(oz / 16)
    const remainingOz = Math.round(oz % 16)
    return `${lbs} lb(s), ${remainingOz} oz(s)`
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl md:max-w-2xl lg:max-w-3xl p-0 flex flex-col gap-0"
      >
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="flex flex-col items-center gap-4">
              <JetpackLoader size="xl" />
              <p className="text-sm text-muted-foreground">Loading shipment details...</p>
            </div>
          </div>
        ) : error ? (
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="text-center">
              <p className="text-sm text-destructive mb-4">{error}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => onOpenChange(false)}
              >
                Close
              </Button>
            </div>
          </div>
        ) : data ? (
          <>
            {/* Header */}
            <div className="sticky top-0 z-10 bg-background border-b border-border/50 dark:border-border/30">
              <div className="flex items-center justify-between px-6 py-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3 mb-1">
                    <h2 className="text-lg font-semibold">
                      Shipment {data.metrics.totalShipments > 1 ? `1 of ${data.metrics.totalShipments}` : ''} - {data.shipmentId}
                    </h2>
                    <Badge
                      variant="outline"
                      className={`px-2 py-0.5 text-xs font-medium ${getStatusColors(data.status)}`}
                    >
                      {data.status}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>Order #{data.orderId}</span>
                    {data.storeOrderId && (
                      <>
                        <span>·</span>
                        <span>Store Order ID/PO No. {data.storeOrderId}</span>
                      </>
                    )}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0"
                  onClick={() => onOpenChange(false)}
                >
                  <XIcon className="h-4 w-4" />
                </Button>
              </div>
            </div>

            {/* Progress Timeline */}
            <ProgressTimeline data={data} />

            {/* Content */}
            <ScrollArea className="flex-1">
              <div className="p-5 space-y-4">

                {/* Issue Alert - shows for problematic statuses */}
                <IssueAlert data={data} />

                {/* Quick Stats Bar */}
                <div className="flex gap-2">
                  <div className="flex-auto bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 rounded-lg p-2.5 border border-blue-200/50 dark:border-blue-800/30">
                    <div className="text-[10px] uppercase tracking-wide text-blue-600 dark:text-blue-400 font-medium mb-0.5">Ship Option</div>
                    <div className="text-xs font-semibold text-blue-900 dark:text-blue-100 whitespace-nowrap">{data.shipping.carrierService || '-'}</div>
                  </div>
                  <div className="flex-auto bg-gradient-to-br from-orange-50 to-orange-100/50 dark:from-orange-950/30 dark:to-orange-900/20 rounded-lg p-2.5 border border-orange-200/50 dark:border-orange-800/30">
                    <div className="text-[10px] uppercase tracking-wide text-orange-600 dark:text-orange-400 font-medium mb-0.5">Carrier</div>
                    <div className="text-xs font-semibold text-orange-900 dark:text-orange-100 whitespace-nowrap">{getCarrierDisplayName(data.shipping.carrier) || '-'}</div>
                  </div>
                  <div className="flex-auto bg-gradient-to-br from-violet-50 to-violet-100/50 dark:from-violet-950/30 dark:to-violet-900/20 rounded-lg p-2.5 border border-violet-200/50 dark:border-violet-800/30">
                    <div className="text-[10px] uppercase tracking-wide text-violet-600 dark:text-violet-400 font-medium mb-0.5">Zone</div>
                    <div className="text-xs font-semibold text-violet-900 dark:text-violet-100 whitespace-nowrap">{data.shipping.zone || '-'}</div>
                  </div>
                  <div className="flex-auto bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-950/30 dark:to-amber-900/20 rounded-lg p-2.5 border border-amber-200/50 dark:border-amber-800/30">
                    <div className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-medium mb-0.5">Weight</div>
                    <div className="text-xs font-semibold text-amber-900 dark:text-amber-100 whitespace-nowrap">{data.package.billableWeightOz ? `${(data.package.billableWeightOz / 16).toFixed(1)} lb` : '-'}</div>
                  </div>
                  <div className="flex-auto bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/20 rounded-lg p-2.5 border border-emerald-200/50 dark:border-emerald-800/30">
                    <div className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-medium mb-0.5">Transit</div>
                    <div className="text-xs font-semibold text-emerald-900 dark:text-emerald-100 whitespace-nowrap">{data.metrics.transitTimeDays ? `${data.metrics.transitTimeDays} days` : '-'}</div>
                  </div>
                  <div className="flex-auto bg-gradient-to-br from-rose-50 to-rose-100/50 dark:from-rose-950/30 dark:to-rose-900/20 rounded-lg p-2.5 border border-rose-200/50 dark:border-rose-800/30">
                    <div className="text-[10px] uppercase tracking-wide text-rose-600 dark:text-rose-400 font-medium mb-0.5">Total Cost</div>
                    <div className="text-xs font-semibold text-rose-900 dark:text-rose-100 whitespace-nowrap">{data.billing.totalCost > 0 ? `$${(data.billing.totalCost - data.billing.totalRefunds).toFixed(2)}` : '-'}</div>
                  </div>
                </div>

                {/* ═══════════════════════════════════════════════════════════════
                    CARD-BASED LAYOUT - Professional, clean, organized
                ═══════════════════════════════════════════════════════════════ */}

                {/* ROW 1: Customer Information + Shipping Details (side by side) */}
                <div className="grid grid-cols-2 gap-4">
                  {/* Customer Information Card */}
                  <div className="rounded-lg border border-border/60 dark:border-border/30 bg-card">
                    <div className="px-4 py-3 border-b border-border/40 dark:border-border/20 bg-muted/30">
                      <h3 className="text-sm font-semibold text-foreground">Customer Information</h3>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Recipient Name</span>
                        <span className="text-sm text-foreground font-medium text-right">{data.customer.name || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Email</span>
                        <span className="text-sm text-foreground text-right truncate ml-4">{data.customer.email || '-'}</span>
                      </div>
                      <div className="flex justify-between items-start">
                        <span className="text-xs text-muted-foreground shrink-0">Address</span>
                        <div className="text-sm text-foreground text-right">
                          {data.customer.address.line1 && <div>{data.customer.address.line1}</div>}
                          {data.customer.address.line2 && <div>{data.customer.address.line2}</div>}
                          <div>
                            {data.customer.address.city}, {data.customer.address.state} {data.customer.address.zipCode}
                          </div>
                          {data.customer.address.country && <div>{data.customer.address.country}</div>}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Shipping Details Card */}
                  <div className="rounded-lg border border-border/60 dark:border-border/30 bg-card">
                    <div className="px-4 py-3 border-b border-border/40 dark:border-border/20 bg-muted/30">
                      <h3 className="text-sm font-semibold text-foreground">Shipping Details</h3>
                    </div>
                    <div className="p-4 space-y-3">
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Ship Option</span>
                        <span className="text-sm text-foreground font-medium">{data.shipping.carrierService || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Fulfillment Center</span>
                        <span className="text-sm text-foreground">{data.shipping.fulfillmentCenter || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Order Type</span>
                        <span className="text-sm text-foreground">{data.orderType || 'DTC'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Sales Channel</span>
                        <span className="text-sm text-foreground">{data.channelName || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Zone</span>
                        <span className="text-sm text-foreground">{data.shipping.zone || '-'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ROW 2: Shipment Breakdown Card (full width) */}
                <div className="rounded-lg border border-border/60 dark:border-border/30 bg-card">
                  <div className="px-4 py-3 border-b border-border/40 dark:border-border/20 bg-muted/30 flex items-center gap-2">
                    <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                    <h3 className="text-sm font-semibold text-foreground">Shipment Breakdown</h3>
                  </div>
                  <div className="p-4">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-3">
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Carrier</span>
                        <span className="text-sm text-foreground">{getCarrierDisplayName(data.shipping.carrier) || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Carrier Service</span>
                        <span className="text-sm text-foreground">{data.shipping.carrierService || '-'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Dimensions</span>
                        <span className="text-sm text-foreground">
                          {data.package.length ? `${data.package.length}" x ${data.package.width}" x ${data.package.height}"` : '-'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Actual Weight</span>
                        <span className="text-sm text-foreground">{formatWeight(data.package.actualWeightOz)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Tracking Details</span>
                        {data.trackingId ? (
                          <a
                            href={getTrackingUrl(data.shipping.carrier, data.trackingId) || '#'}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                          >
                            {data.trackingId}
                            <ExternalLinkIcon className="h-3 w-3" />
                          </a>
                        ) : (
                          <span className="text-sm text-foreground">-</span>
                        )}
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Destination Country</span>
                        <span className="text-sm text-foreground">{data.customer.address.country || 'US'}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ROW 3: Shipment Items Card */}
                {data.items.length > 0 && (
                  <div className="rounded-lg border border-border/60 dark:border-border/30 bg-card">
                    <div className="px-4 py-3 border-b border-border/40 dark:border-border/20 bg-muted/30">
                      <h3 className="text-sm font-semibold text-foreground">Shipment Items</h3>
                    </div>
                    <div className="divide-y divide-border/50">
                      {/* Table header */}
                      <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-muted/20">
                        <div className="col-span-6 text-xs font-medium text-muted-foreground">Product Name and SKU</div>
                        <div className="col-span-3 text-xs font-medium text-muted-foreground">Lot No. and Date</div>
                        <div className="col-span-3 text-xs font-medium text-muted-foreground text-right">Qty</div>
                      </div>
                      {/* Table rows */}
                      {data.items.map((item) => (
                        <div key={item.id} className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-muted/10">
                          <div className="col-span-6">
                            <p className="text-sm text-blue-600 dark:text-blue-400 font-medium">{item.name || item.sku}</p>
                            <p className="text-xs text-muted-foreground">#{item.sku}</p>
                          </div>
                          <div className="col-span-3">
                            {item.lotNumber ? (
                              <span className="text-sm text-foreground">{item.lotNumber}</span>
                            ) : (
                              <span className="text-sm text-muted-foreground italic">No Lot Number</span>
                            )}
                            {item.expirationDate && (
                              <p className="text-xs text-muted-foreground">{format(new Date(item.expirationDate), 'MM/dd/yyyy')}</p>
                            )}
                          </div>
                          <div className="col-span-3 text-right">
                            <span className="text-sm font-medium text-foreground">{item.quantity}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* ROW 4: Charges Card */}
                {data.transactions.length > 0 && (
                  <div className="rounded-lg border border-border/60 dark:border-border/30 bg-card">
                    <div className="px-4 py-3 border-b border-border/40 dark:border-border/20 bg-muted/30">
                      <h3 className="text-sm font-semibold text-foreground">Charges</h3>
                    </div>
                    <div className="divide-y divide-border/50">
                      {data.transactions.map((tx) => (
                        <div key={tx.id} className="flex items-center justify-between px-4 py-2.5">
                          <span className="text-sm text-foreground">{tx.feeType}</span>
                          <span className={`text-sm font-medium tabular-nums ${
                            tx.transactionType === "Refund" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"
                          }`}>
                            {tx.transactionType === "Refund" ? "−" : ""}${Math.abs(tx.billedAmount || tx.cost || 0).toFixed(2)}
                          </span>
                        </div>
                      ))}
                      <div className="flex items-center justify-between px-4 py-3 bg-muted/30">
                        <span className="text-sm font-semibold text-foreground">Total</span>
                        <span className="text-sm font-bold text-foreground tabular-nums">
                          ${(data.billing.totalCost - data.billing.totalRefunds).toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {/* ROW 5: Associated Returns Card */}
                <div className="rounded-lg border border-border/60 dark:border-border/30 bg-card">
                  <div className="px-4 py-3 border-b border-border/40 dark:border-border/20 bg-muted/30">
                    <h3 className="text-sm font-semibold text-foreground">Associated Returns</h3>
                  </div>
                  {data.returns.length > 0 ? (
                    <div className="divide-y divide-border/50">
                      {/* Table header */}
                      <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-muted/20">
                        <div className="col-span-2 text-xs font-medium text-muted-foreground">Return ID</div>
                        <div className="col-span-3 text-xs font-medium text-muted-foreground">Created</div>
                        <div className="col-span-2 text-xs font-medium text-muted-foreground">Return Type</div>
                        <div className="col-span-3 text-xs font-medium text-muted-foreground">Tracking #</div>
                        <div className="col-span-2 text-xs font-medium text-muted-foreground text-right">Status</div>
                      </div>
                      {data.returns.map((ret) => {
                        // Detect carrier for tracking URL
                        const detectedCarrier = ret.trackingNumber ? detectCarrierFromTracking(ret.trackingNumber) : null
                        const returnTrackingUrl = detectedCarrier ? getTrackingUrl(detectedCarrier, ret.trackingNumber) : null

                        return (
                          <div key={ret.id} className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-muted/10">
                            <div className="col-span-2">
                              <button
                                onClick={() => {
                                  onOpenChange(false)
                                  // Use window.location.href for full page navigation to ensure URL params are picked up
                                  window.location.href = `/dashboard/transactions?tab=returns&search=${ret.returnId}`
                                }}
                                className="text-sm text-blue-600 dark:text-blue-400 hover:underline font-medium"
                              >
                                {ret.returnId}
                              </button>
                            </div>
                            <div className="col-span-3 text-sm text-foreground">
                              {ret.insertDate ? format(new Date(ret.insertDate), 'MM/dd/yyyy') : '-'}
                            </div>
                            <div className="col-span-2 text-sm text-foreground">{ret.returnType || '-'}</div>
                            <div className="col-span-3">
                              {ret.trackingNumber ? (
                                returnTrackingUrl ? (
                                  <a
                                    href={returnTrackingUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-sm font-mono text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-1"
                                  >
                                    {ret.trackingNumber}
                                    <ExternalLinkIcon className="h-3 w-3" />
                                  </a>
                                ) : (
                                  <span className="text-sm text-foreground font-mono text-xs">{ret.trackingNumber}</span>
                                )
                              ) : (
                                <span className="text-sm text-muted-foreground">-</span>
                              )}
                            </div>
                            <div className="col-span-2 text-right">
                              <Badge variant="outline" className="text-xs">{ret.status}</Badge>
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No Associated Returns
                    </div>
                  )}
                </div>

                {/* ROW 6: Cartons Card (only if multiple) */}
                {data.cartons.length > 1 && (
                  <div className="rounded-lg border border-border/60 dark:border-border/30 bg-card">
                    <div className="px-4 py-3 border-b border-border/40 dark:border-border/20 bg-muted/30">
                      <h3 className="text-sm font-semibold text-foreground">Cartons ({data.cartons.length})</h3>
                    </div>
                    <div className="divide-y divide-border/50">
                      {/* Table header */}
                      <div className="grid grid-cols-12 gap-4 px-4 py-2 bg-muted/20">
                        <div className="col-span-2 text-xs font-medium text-muted-foreground">Carton</div>
                        <div className="col-span-4 text-xs font-medium text-muted-foreground">Tracking Number</div>
                        <div className="col-span-3 text-xs font-medium text-muted-foreground">Dimensions</div>
                        <div className="col-span-3 text-xs font-medium text-muted-foreground text-right">Weight</div>
                      </div>
                      {data.cartons.map((carton, index) => (
                        <div key={carton.id} className="grid grid-cols-12 gap-4 px-4 py-3 hover:bg-muted/10">
                          <div className="col-span-2 text-sm text-foreground font-medium">{index + 1}</div>
                          <div className="col-span-4 text-sm text-foreground font-mono text-xs">{carton.trackingNumber || '-'}</div>
                          <div className="col-span-3 text-sm text-foreground">
                            {carton.length ? `${carton.length}" x ${carton.width}" x ${carton.height}"` : '-'}
                          </div>
                          <div className="col-span-3 text-sm text-foreground text-right">
                            {carton.weight ? `${carton.weight} oz` : '-'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

              </div>
            </ScrollArea>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
