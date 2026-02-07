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
  SheetTitle,
} from "@/components/ui/sheet"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { JetpackLoader } from "@/components/jetpack-loader"
import { getCarrierDisplayName } from "./transactions/cell-renderers"
import { ClaimSubmissionDialog } from "./claims/claim-submission-dialog"
import { ClaimType, ClaimEligibilityResult, getClaimTypeLabel } from "@/lib/claims/eligibility"
import { getCarrierServiceDisplay } from "@/lib/utils/carrier-service-display"

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
    shipOptionName: string
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
    fulfillTimeDays: number | null
    fulfillTimeHours: number | null
    metSla: boolean | null
  }
  timeline: Array<{
    event: string
    timestamp: string
    description: string
    icon: string
    source?: 'shipment' | 'claim'
    claimStatus?: string
    invoiceId?: number | null
    jetpackInvoiceNumber?: string | null
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
    baseCharge?: number | null
    surcharge?: number | null
    totalCharge?: number | null
    insuranceCharge?: number | null
    isPreview?: boolean
  }>
  chargesBreakdown: {
    baseFulfillmentFees: number | null
    surcharges: number | null
    totalFulfillmentCost: number | null
    pickFees: number | null
    insurance: number | null
    subtotal: number | null
    taxes: number | null
    total: number | null
    isPreview: boolean
  }
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
  claimTicket: {
    id: string
    ticketNumber: number
    ticketType: string
    issueType: string | null
    status: string
    creditAmount: number | null
    currency: string
    description: string | null
    createdAt: string
    updatedAt: string
    resolvedAt: string | null
    reshipmentStatus: string | null
    reshipmentId: string | null
    events: Array<{
      status: string
      note: string
      createdAt: string
      createdBy: string
    }>
    jetpackInvoiceNumber: string | null
  } | null
  // Lookout IQ AI Assessment
  aiAssessment: {
    statusBadge: 'MOVING' | 'DELAYED' | 'WATCHLIST' | 'STALLED' | 'STUCK' | 'RETURNING' | 'LOST'
    riskLevel: 'low' | 'medium' | 'high' | 'critical'
    customerSentiment: string
    merchantAction: string
    reshipmentUrgency: number
    keyInsight: string
    nextMilestone: string
    confidence: number
  } | null
  claimEligibilityStatus: 'at_risk' | 'eligible' | 'claim_filed' | 'approved' | 'denied' | null
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

// Get status badge for timeline events (supports both shipment and claim events)
function getEventStatusBadge(event: string, source?: 'shipment' | 'claim'): { label: string; color: string } | null {
  const eventLower = event.toLowerCase()

  // Claim-related badges (distinct styling to differentiate from shipment events)
  if (source === 'claim') {
    if (eventLower.includes('claim filed')) return { label: 'Claim Filed', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' }
    if (eventLower.includes('under review')) return { label: 'Under Review', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' }
    if (eventLower.includes('credit requested')) return { label: 'Credit Requested', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' }
    if (eventLower.includes('credit approved')) return { label: 'Credit Approved', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
    if (eventLower.includes('credit denied')) return { label: 'Credit Denied', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' }
    if (eventLower.includes('resolved')) return { label: 'Resolved', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' }
    // Default claim badge
    return { label: 'Claim', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400' }
  }

  // Shipment-related badges
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
                    const isClaimEvent = event.source === 'claim'
                    const badge = getEventStatusBadge(event.event, event.source)
                    const isLast = index === data.timeline.length - 1
                    const dateKey = format(new Date(event.timestamp), "MMMM do, yyyy")
                    const showDateHeader = dateKey !== lastDateKey
                    lastDateKey = dateKey

                    return (
                      <div key={`${event.event}-${event.timestamp}-${index}`}>
                        {/* Date header when date changes */}
                        {showDateHeader && (
                          <div className={`ml-6 ${index === 0 ? 'mb-3' : 'mt-6 mb-3'}`}>
                            <h4 className="text-sm font-semibold text-foreground">{dateKey}</h4>
                          </div>
                        )}

                        {/* Event row */}
                        <div className={`flex gap-3 ${isLast ? '' : 'mb-5'}`}>
                          {/* Timeline dot - rose for claims, emerald for shipment events */}
                          <div className="flex flex-col items-center">
                            <div className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 z-10 ${
                              isClaimEvent ? 'bg-rose-500' : 'bg-emerald-500'
                            }`} />
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
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {event.description}
                                {event.jetpackInvoiceNumber && (
                                  <button
                                    onClick={async (e) => {
                                      e.stopPropagation()
                                      try {
                                        const res = await fetch(`/api/invoices/${event.jetpackInvoiceNumber}/files?type=pdf`)
                                        const data = await res.json()
                                        if (data.pdfUrl) {
                                          window.open(data.pdfUrl, '_blank')
                                        }
                                      } catch (err) {
                                        console.error('Failed to get invoice PDF:', err)
                                      }
                                    }}
                                    className="ml-1 text-blue-600 dark:text-blue-400 hover:underline inline-flex items-center gap-0.5"
                                  >
                                    View Invoice
                                    <ExternalLinkIcon className="h-2.5 w-2.5" />
                                  </button>
                                )}
                              </p>
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
// LOOKOUT IQ ASSESSMENT ALERT COMPONENT
// ============================================

interface AIAssessmentAlertProps {
  data: ShipmentDetails
}

function AIAssessmentAlert({ data }: AIAssessmentAlertProps) {
  const assessment = data.aiAssessment
  if (!assessment) return null

  // Badge colors based on status
  const badgeColors: Record<string, string> = {
    MOVING: 'bg-lime-100 text-lime-700 border-lime-200',
    DELAYED: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    WATCHLIST: 'bg-amber-100 text-amber-700 border-amber-200',
    STALLED: 'bg-orange-100 text-orange-700 border-orange-200',
    STUCK: 'bg-red-100 text-red-600 border-red-200',
    RETURNING: 'bg-purple-100 text-purple-700 border-purple-200',
    LOST: 'bg-red-100 text-red-700 border-red-200',
  }

  const riskColors: Record<string, string> = {
    low: 'bg-green-100 text-green-700 border-green-200',
    medium: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    high: 'bg-orange-100 text-orange-700 border-orange-200',
    critical: 'bg-red-100 text-red-700 border-red-200',
  }

  return (
    <div className="rounded-lg border border-indigo-200 bg-indigo-50 p-4 dark:border-indigo-800 dark:bg-indigo-950/30">
      <div className="flex items-start gap-3">
        <svg
          className="h-5 w-5 text-indigo-600 dark:text-indigo-400 mt-0.5 shrink-0"
          fill="currentColor"
          viewBox="0 0 24 24"
        >
          <path d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
        <div className="flex-1 space-y-3">
          {/* Header with badge */}
          <div className="flex items-center justify-between">
            <span className="font-medium text-indigo-900 dark:text-indigo-100">
              Delivery IQ Assessment
            </span>
            <div className="flex items-center gap-2">
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${badgeColors[assessment.statusBadge] || 'bg-gray-100'}`}>
                {assessment.statusBadge}
              </span>
              <span className={`px-2 py-0.5 text-xs font-medium rounded-full border ${riskColors[assessment.riskLevel] || ''}`}>
                {assessment.riskLevel} risk
              </span>
            </div>
          </div>

          {/* Key insight */}
          <p className="text-sm text-indigo-800 dark:text-indigo-200">
            {assessment.keyInsight}
          </p>

          {/* Customer perspective */}
          <div className="rounded bg-indigo-100/50 p-2 dark:bg-indigo-900/30">
            <p className="text-xs font-medium text-indigo-700 dark:text-indigo-300 mb-1">
              Customer Perspective
            </p>
            <p className="text-sm text-indigo-800 dark:text-indigo-200">
              {assessment.customerSentiment}
            </p>
          </div>

          {/* Recommendation */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400">
              Recommendation:
            </span>
            <span className="px-2 py-0.5 text-xs font-medium rounded-full border border-indigo-300 bg-indigo-100/50 text-indigo-700 dark:border-indigo-700 dark:bg-indigo-900/50 dark:text-indigo-300">
              {assessment.merchantAction}
            </span>
            {assessment.reshipmentUrgency > 60 && (
              <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-red-100 text-red-700 border border-red-200 dark:bg-red-900/50 dark:text-red-300 dark:border-red-800">
                Reshipment urgency: {assessment.reshipmentUrgency}%
              </span>
            )}
          </div>

          {/* Next milestone */}
          <p className="text-xs text-indigo-600 dark:text-indigo-400">
            <span className="font-medium">Next:</span> {assessment.nextMilestone}
          </p>
        </div>
      </div>
    </div>
  )
}

// ============================================
// CLAIM DROPDOWN COMPONENT (for header)
// ============================================

interface ClaimDropdownProps {
  eligibility: ClaimEligibilityResult | null
  isLoadingEligibility: boolean
  onSubmitClaim: (claimType: ClaimType) => void
}

function ClaimDropdown({ eligibility, isLoadingEligibility, onSubmitClaim }: ClaimDropdownProps) {
  const [hoveredItem, setHoveredItem] = React.useState<{ type: ClaimType; rect: DOMRect } | null>(null)

  // Don't show anything while loading or if no eligibility data
  if (isLoadingEligibility || !eligibility) return null

  const claimTypes: ClaimType[] = ['lostInTransit', 'damage', 'incorrectItems', 'incorrectQuantity']
  const hasEligibleClaim = claimTypes.some(type => eligibility.eligibility[type].eligible)

  // Hide entirely if no claims are eligible
  if (!hasEligibleClaim) return null

  // Helper to get the reason why a claim type is not eligible
  const getIneligibleReason = (type: ClaimType): string => {
    const info = eligibility.eligibility[type]
    if (info.eligible) return ''

    if (type === 'lostInTransit') {
      if (eligibility.isDelivered) {
        return 'Package has been delivered'
      }
      const requiredDays = eligibility.isInternational ? 20 : 15
      const daysRemaining = eligibility.daysSinceLastUpdate !== null
        ? requiredDays - eligibility.daysSinceLastUpdate
        : requiredDays
      return `Requires ${requiredDays} days of inactivity (${Math.max(0, daysRemaining)} days remaining)`
    }

    // For damage, incorrect items, incorrect quantity - requires delivery
    return 'Package must be delivered first'
  }

  const handleMouseEnter = (type: ClaimType, event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect()
    setHoveredItem({ type, rect })
  }

  const handleMouseLeave = () => {
    setHoveredItem(null)
  }

  return (
    <>
      <DropdownMenu onOpenChange={(open) => !open && setHoveredItem(null)}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-8"
          >
            Submit a Claim
            <ChevronDownIcon className="ml-2 h-3.5 w-3.5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {claimTypes.map((type) => {
            const isEligible = eligibility.eligibility[type].eligible

            if (isEligible) {
              return (
                <DropdownMenuItem
                  key={type}
                  onClick={() => onSubmitClaim(type)}
                >
                  {getClaimTypeLabel(type)}
                </DropdownMenuItem>
              )
            }

            // Ineligible item
            return (
              <div
                key={type}
                className="px-2 py-1.5 text-sm opacity-50 cursor-not-allowed"
                onMouseEnter={(e) => handleMouseEnter(type, e)}
                onMouseLeave={handleMouseLeave}
              >
                <div className="flex items-center justify-between">
                  <span>{getClaimTypeLabel(type)}</span>
                  <AlertTriangleIcon className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </div>
            )
          })}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Portal tooltip - rendered outside dropdown to avoid clipping */}
      {hoveredItem && (
        <div
          className="fixed pointer-events-none"
          style={{
            top: hoveredItem.rect.top - 8,
            left: hoveredItem.rect.left,
            width: hoveredItem.rect.width,
            transform: 'translateY(-100%)',
            zIndex: 99999,
          }}
        >
          <div className="bg-slate-900 text-white text-xs px-2 py-1.5 rounded-md shadow-lg">
            {getIneligibleReason(hoveredItem.type)}
          </div>
        </div>
      )}
    </>
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

  // Claim dialog state
  const [claimDialogOpen, setClaimDialogOpen] = React.useState(false)
  const [selectedClaimType, setSelectedClaimType] = React.useState<ClaimType | undefined>()
  const [eligibility, setEligibility] = React.useState<ClaimEligibilityResult | null>(null)
  const [isLoadingEligibility, setIsLoadingEligibility] = React.useState(false)

  // Fetch shipment details when opened
  React.useEffect(() => {
    if (open && shipmentId) {
      setIsLoading(true)
      setIsLoadingEligibility(true)
      setError(null)

      // Fetch shipment details
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

      // Fetch claim eligibility (separate request, non-blocking)
      fetch(`/api/data/shipments/${shipmentId}/claim-eligibility`)
        .then((res) => {
          if (!res.ok) throw new Error("Failed to load eligibility")
          return res.json()
        })
        .then((eligibilityData) => {
          setEligibility(eligibilityData)
        })
        .catch((err) => {
          console.error('Eligibility fetch error:', err)
          setEligibility(null)
        })
        .finally(() => {
          setIsLoadingEligibility(false)
        })
    }
  }, [open, shipmentId])

  // Reset when closed
  React.useEffect(() => {
    if (!open) {
      setData(null)
      setError(null)
      setEligibility(null)
      setClaimDialogOpen(false)
      setSelectedClaimType(undefined)
    }
  }, [open])

  // Handle submit claim from drawer
  const handleSubmitClaim = (claimType: ClaimType) => {
    setSelectedClaimType(claimType)
    setClaimDialogOpen(true)
  }

  const handleClaimDialogClose = (dialogOpen: boolean) => {
    setClaimDialogOpen(dialogOpen)
    if (!dialogOpen) {
      setSelectedClaimType(undefined)
    }
  }

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
        <SheetTitle className="sr-only">Shipment Details</SheetTitle>
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
                <div className="flex items-center gap-2 shrink-0">
                  {/* Claim Dropdown - only shows if at least one claim type is eligible */}
                  <ClaimDropdown
                    eligibility={eligibility}
                    isLoadingEligibility={isLoadingEligibility}
                    onSubmitClaim={handleSubmitClaim}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => onOpenChange(false)}
                  >
                    <XIcon className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Progress Timeline */}
            <ProgressTimeline data={data} />

            {/* Content */}
            <ScrollArea className="flex-1">
              <div className="p-5 space-y-4">

                {/* Delivery IQ Assessment Alert - shows for monitored shipments */}
                <AIAssessmentAlert data={data} />

                {/* Issue Alert - shows for problematic statuses */}
                <IssueAlert data={data} />

                {/* Claim Status Card - shows when a claim is filed */}
                {data.claimTicket && (
                  <div className={`rounded-lg p-4 ${
                    data.claimTicket.status === 'Credit Approved' || data.claimTicket.status === 'Resolved'
                      ? 'bg-emerald-500/10 dark:bg-emerald-500/5 border border-emerald-200/50 dark:border-emerald-800/30'
                      : data.claimTicket.status === 'Credit Denied'
                        ? 'bg-red-500/10 dark:bg-red-500/5 border border-red-200/50 dark:border-red-800/30'
                        : 'bg-amber-500/10 dark:bg-amber-500/5 border border-amber-200/50 dark:border-amber-800/30'
                  }`}>
                    {/* Two-column layout: Info on left, Timeline on right */}
                    <div className="flex gap-6">
                      {/* Left side: Header and details */}
                      <div className="flex-1 min-w-0">
                        <p className={`text-sm font-semibold ${
                          data.claimTicket.status === 'Credit Approved' || data.claimTicket.status === 'Resolved'
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : data.claimTicket.status === 'Credit Denied'
                              ? 'text-red-700 dark:text-red-400'
                              : 'text-amber-700 dark:text-amber-400'
                        }`}>
                          A {data.claimTicket.issueType || 'Claim'} Claim has been filed
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Claim #{data.claimTicket.ticketNumber}
                        </p>
                        {data.claimTicket.creditAmount != null && data.claimTicket.creditAmount > 0 && (
                          <p className="text-sm font-semibold text-emerald-600 dark:text-emerald-400 mt-2">
                            Credit: ${data.claimTicket.creditAmount.toFixed(2)} {data.claimTicket.currency}
                          </p>
                        )}
                        {data.claimTicket.status === 'Resolved' && data.claimTicket.jetpackInvoiceNumber && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation()
                              try {
                                const res = await fetch(`/api/invoices/${data.claimTicket!.jetpackInvoiceNumber}/files?type=pdf`)
                                const responseData = await res.json()
                                if (responseData.pdfUrl) {
                                  window.open(responseData.pdfUrl, '_blank')
                                }
                              } catch (err) {
                                console.error('Failed to get invoice PDF:', err)
                              }
                            }}
                            className="text-xs text-blue-600 dark:text-blue-400 hover:underline mt-2 block"
                          >
                            View Invoice <ExternalLinkIcon className="inline h-3 w-3" />
                          </button>
                        )}
                        {data.claimTicket.reshipmentStatus && (
                          <p className="text-xs text-muted-foreground mt-2">
                            Reshipment: {data.claimTicket.reshipmentStatus}
                            {data.claimTicket.reshipmentId && ` (#${data.claimTicket.reshipmentId})`}
                          </p>
                        )}
                      </div>

                      {/* Right side: Mini Timeline */}
                      {data.claimTicket.events && data.claimTicket.events.length > 0 && (
                        <div className="w-56 shrink-0">
                          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Activity</div>
                          <div className="relative pl-3 border-l-2 border-slate-200 dark:border-slate-700 space-y-2.5">
                            {data.claimTicket.events.slice(0, 4).map((event, idx) => {
                              const dotColor = event.status === 'Resolved' || event.status === 'Credit Approved'
                                ? 'bg-emerald-500 border-emerald-500'
                                : event.status === 'Credit Denied'
                                  ? 'bg-red-500 border-red-500'
                                  : event.status === 'Credit Requested'
                                    ? 'bg-amber-400 border-amber-400'
                                    : event.status === 'Under Review'
                                      ? 'bg-blue-500 border-blue-500'
                                      : event.status === 'Input Required'
                                        ? 'bg-red-500 border-red-500'
                                        : 'bg-slate-400 border-slate-400'
                              return (
                                <div key={idx} className="relative">
                                  {/* Timeline dot */}
                                  <div className={`absolute -left-[15px] top-0.5 w-2 h-2 rounded-full border-2 ${
                                    idx === 0 ? dotColor : 'bg-background border-slate-300 dark:border-slate-600'
                                  }`} />
                                  <div>
                                    <div className="flex items-baseline justify-between gap-2">
                                      <span className={`text-[11px] font-medium ${
                                        idx === 0 ? 'text-foreground' : 'text-muted-foreground/70'
                                      }`}>
                                        {event.status}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground/60 tabular-nums shrink-0">
                                        {new Date(event.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                                      </span>
                                    </div>
                                    {event.note && (
                                      <p className="text-[10px] text-muted-foreground/70 mt-0.5 leading-tight line-clamp-2">
                                        {event.note}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* Quick Stats Bar */}
                <div className="flex gap-2">
                  <div className="flex-auto bg-gradient-to-br from-blue-50 to-blue-100/50 dark:from-blue-950/30 dark:to-blue-900/20 rounded-lg p-2.5 border border-blue-200/50 dark:border-blue-800/30">
                    <div className="text-[10px] uppercase tracking-wide text-blue-600 dark:text-blue-400 font-medium mb-0.5">Ship Option</div>
                    <div className="text-xs font-semibold text-blue-900 dark:text-blue-100 whitespace-nowrap">{data.shipping.shipOptionName || '-'}</div>
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
                    <div className="text-[10px] uppercase tracking-wide text-amber-600 dark:text-amber-400 font-medium mb-0.5">Billed Weight</div>
                    <div className="text-xs font-semibold text-amber-900 dark:text-amber-100 whitespace-nowrap">{data.package.billableWeightOz ? `${(data.package.billableWeightOz / 16).toFixed(1)} lb` : '-'}</div>
                  </div>
                  <div className="flex-auto bg-gradient-to-br from-cyan-50 to-cyan-100/50 dark:from-cyan-950/30 dark:to-cyan-900/20 rounded-lg p-2.5 border border-cyan-200/50 dark:border-cyan-800/30">
                    <div className="text-[10px] uppercase tracking-wide text-cyan-600 dark:text-cyan-400 font-medium mb-0.5">Fulfill Time</div>
                    <div className="text-xs font-semibold text-cyan-900 dark:text-cyan-100 whitespace-nowrap flex items-center gap-1">
                      {data.metrics.fulfillTimeDays !== null && data.metrics.fulfillTimeDays !== undefined ? (
                        <>
                          {data.metrics.fulfillTimeHours !== null && data.metrics.fulfillTimeHours < 24
                            ? `${data.metrics.fulfillTimeHours} hours`
                            : `${data.metrics.fulfillTimeDays} days`}
                          {data.metrics.metSla && (
                            <svg className="h-3.5 w-3.5 text-green-500" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                            </svg>
                          )}
                        </>
                      ) : '-'}
                    </div>
                  </div>
                  <div className="flex-auto bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-950/30 dark:to-emerald-900/20 rounded-lg p-2.5 border border-emerald-200/50 dark:border-emerald-800/30">
                    <div className="text-[10px] uppercase tracking-wide text-emerald-600 dark:text-emerald-400 font-medium mb-0.5">Transit Time</div>
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
                        <span className="text-sm text-foreground font-medium">{data.shipping.shipOptionName || '-'}</span>
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
                        <span className="text-xs text-muted-foreground">Service</span>
                        <span className="text-sm text-foreground">{getCarrierServiceDisplay(data.shipping.carrierService, data.shipping.carrier) || '-'}</span>
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
                        <span className="text-xs text-muted-foreground">Dimensional Weight</span>
                        <span className="text-sm text-foreground">{formatWeight(data.package.dimWeightOz)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-xs text-muted-foreground">Billable Weight</span>
                        <span className="text-sm font-medium text-foreground">{formatWeight(data.package.billableWeightOz)}</span>
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
                              <>
                                <span className="text-sm text-foreground">{item.lotNumber}</span>
                                {item.expirationDate && (
                                  <p className="text-xs text-muted-foreground">Exp: {format(new Date(item.expirationDate), 'MMM d, yyyy')}</p>
                                )}
                              </>
                            ) : (
                              <span className="text-sm text-muted-foreground italic">-</span>
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

                {/* ROW 4: Charges Card - Redesigned for clarity */}
                {data.transactions.length > 0 && (
                  <div className="rounded-lg border border-border/60 dark:border-border/30 bg-card overflow-hidden">
                    {/* Header with preview indicator */}
                    <div className="px-4 py-3 border-b border-border/40 dark:border-border/20 bg-muted/30 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <svg className="h-4 w-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <h3 className="text-sm font-semibold text-foreground">Charges <span className="font-normal text-muted-foreground">(USD)</span></h3>
                      </div>
                      {data.chargesBreakdown.isPreview && data.chargesBreakdown.total !== null && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                          <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          Estimated
                        </span>
                      )}
                    </div>

                    {data.chargesBreakdown.total !== null ? (
                      <div className="divide-y divide-border/30">
                        {/* SECTION: Fulfillment Charges */}
                        {(data.chargesBreakdown.baseFulfillmentFees !== null || data.chargesBreakdown.surcharges !== null) && (
                          <div className="bg-gradient-to-r from-blue-50/50 to-transparent dark:from-blue-950/20 dark:to-transparent">
                            <div className="px-4 py-2 border-b border-border/20">
                              <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Fulfillment</span>
                            </div>
                            <div className="px-4 py-1">
                              {data.chargesBreakdown.baseFulfillmentFees !== null && (
                                <div className="flex items-center justify-between py-1.5 pr-[11px]">
                                  <span className="text-sm text-muted-foreground">Base Fulfillment</span>
                                  <span className="text-sm tabular-nums text-foreground text-right w-14">
                                    ${data.chargesBreakdown.baseFulfillmentFees.toFixed(2)}
                                  </span>
                                </div>
                              )}
                              {data.chargesBreakdown.surcharges !== null && (
                                <div className="flex items-center justify-between py-1.5 pr-[11px]">
                                  <span className="text-sm text-muted-foreground">Carrier Surcharges</span>
                                  <span className="text-sm tabular-nums text-foreground text-right w-14">
                                    ${data.chargesBreakdown.surcharges.toFixed(2)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Fulfillment subtotal */}
                        {data.chargesBreakdown.totalFulfillmentCost !== null && (
                          <div className="px-4 py-2">
                            <div className="flex items-center justify-end">
                              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-border/50 bg-muted/30">
                                <span className="text-xs text-muted-foreground">Fulfillment</span>
                                <span className="text-sm font-semibold tabular-nums text-foreground w-14 text-right">
                                  ${data.chargesBreakdown.totalFulfillmentCost.toFixed(2)}
                                </span>
                              </span>
                            </div>
                          </div>
                        )}

                        {/* SECTION: Additional Fees */}
                        {(data.chargesBreakdown.pickFees !== null || (data.chargesBreakdown.insurance !== null && data.chargesBreakdown.insurance > 0)) && (
                          <div className="bg-gradient-to-r from-violet-50/50 to-transparent dark:from-violet-950/20 dark:to-transparent">
                            <div className="px-4 py-2 border-b border-border/20">
                              <span className="text-xs font-semibold uppercase tracking-wider text-violet-600 dark:text-violet-400">Additional Fees</span>
                            </div>
                            <div className="px-4 py-1">
                              {data.chargesBreakdown.pickFees !== null && (
                                <div className="flex items-center justify-between py-1.5 pr-[11px]">
                                  <span className="text-sm text-muted-foreground">Pick Fees</span>
                                  <span className="text-sm tabular-nums text-foreground text-right w-14">
                                    ${data.chargesBreakdown.pickFees.toFixed(2)}
                                  </span>
                                </div>
                              )}
                              {data.chargesBreakdown.insurance !== null && data.chargesBreakdown.insurance > 0 && (
                                <div className="flex items-center justify-between py-1.5 pr-[11px]">
                                  <span className="text-sm text-muted-foreground">Insurance</span>
                                  <span className="text-sm tabular-nums text-foreground text-right w-14">
                                    ${data.chargesBreakdown.insurance.toFixed(2)}
                                  </span>
                                </div>
                              )}
                            </div>
                          </div>
                        )}

                        {/* Subtotal (before taxes) */}
                        {data.chargesBreakdown.subtotal !== null && (
                          <div className="px-4 py-2">
                            <div className="flex items-center justify-end">
                              <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-border/50 bg-muted/30">
                                <span className="text-xs text-muted-foreground">Subtotal</span>
                                <span className="text-sm font-semibold tabular-nums text-foreground w-14 text-right">
                                  ${data.chargesBreakdown.subtotal.toFixed(2)}
                                </span>
                              </span>
                            </div>
                          </div>
                        )}

                        {/* SECTION: Taxes (if any) */}
                        {data.chargesBreakdown.taxes !== null && data.chargesBreakdown.taxes > 0 && (
                          <div className="bg-gradient-to-r from-blue-50/50 to-transparent dark:from-blue-950/20 dark:to-transparent">
                            <div className="px-4 py-2 border-b border-border/20">
                              <span className="text-xs font-semibold uppercase tracking-wider text-blue-600 dark:text-blue-400">Taxes</span>
                            </div>
                            <div className="px-4 py-1">
                              <div className="flex items-center justify-between py-1.5 pr-[11px]">
                                <span className="text-sm text-muted-foreground">Sales Tax</span>
                                <span className="text-sm tabular-nums text-foreground text-right w-14">
                                  ${data.chargesBreakdown.taxes.toFixed(2)}
                                </span>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* SECTION: Refunds (if any) */}
                        {data.transactions.some(tx => tx.transactionType === "Refund") && (
                          <div className="bg-gradient-to-r from-emerald-50/50 to-transparent dark:from-emerald-950/20 dark:to-transparent">
                            <div className="px-4 py-2 border-b border-border/20">
                              <span className="text-xs font-semibold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">Refunds</span>
                            </div>
                            <div className="px-4 py-1">
                              {data.transactions
                                .filter(tx => tx.transactionType === "Refund")
                                .map((tx) => (
                                  <div key={tx.id} className="flex items-center justify-between py-1.5 pr-[11px]">
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm text-muted-foreground">{tx.feeType}</span>
                                      <span className="text-xs text-muted-foreground/70">
                                        {tx.chargeDate ? format(new Date(tx.chargeDate), 'M/d') : ''}
                                      </span>
                                    </div>
                                    <span className="text-sm tabular-nums text-emerald-600 dark:text-emerald-400 text-right w-14">
                                      −${Math.abs(tx.billedAmount || tx.cost || 0).toFixed(2)}
                                    </span>
                                  </div>
                                ))}
                            </div>
                          </div>
                        )}

                        {/* TOTAL */}
                        <div className="px-4 py-3">
                          <div className="flex items-center justify-end">
                            <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-emerald-200/50 bg-emerald-100/50 dark:bg-emerald-900/15 dark:border-emerald-800/50">
                              <span className="text-xs text-muted-foreground">Grand Total</span>
                              <span className="text-sm font-semibold tabular-nums text-foreground w-20 text-right">
                                ${data.chargesBreakdown.total.toFixed(2)}
                              </span>
                            </span>
                          </div>
                          {/* Show net after refunds if different */}
                          {data.transactions.some(tx => tx.transactionType === "Refund") && (() => {
                            const refundTotal = data.transactions
                              .filter(tx => tx.transactionType === "Refund")
                              .reduce((sum, tx) => sum + Math.abs(tx.billedAmount || tx.cost || 0), 0)
                            const netTotal = data.chargesBreakdown.total! - refundTotal
                            return (
                              <div className="flex items-center justify-end mt-2">
                                <span className="inline-flex items-center gap-2 px-2.5 py-1 rounded-md border border-emerald-200/50 bg-emerald-100/50 dark:bg-emerald-900/15 dark:border-emerald-800/50">
                                  <span className="text-xs text-muted-foreground">Net</span>
                                  <span className="text-sm font-semibold tabular-nums text-foreground w-14 text-right">
                                    ${netTotal.toFixed(2)}
                                  </span>
                                </span>
                              </div>
                            )
                          })()}
                        </div>

                        {/* Transaction Details Expandable (for reshipments, multiple charges) */}
                        {data.transactions.filter(tx => tx.transactionType !== "Refund").length > 1 && (
                          <details className="group">
                            <summary className="px-4 py-2 cursor-pointer hover:bg-muted/20 flex items-center justify-between text-xs text-muted-foreground">
                              <span>View {data.transactions.filter(tx => tx.transactionType !== "Refund").length} individual transactions</span>
                              <ChevronDownIcon className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
                            </summary>
                            <div className="border-t border-border/30 bg-muted/10">
                              <div className="px-4 py-2 grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground border-b border-border/20">
                                <div className="col-span-3">Date</div>
                                <div className="col-span-5">Type</div>
                                <div className="col-span-4 text-right">Amount</div>
                              </div>
                              {data.transactions
                                .filter(tx => tx.transactionType !== "Refund")
                                .sort((a, b) => new Date(a.chargeDate).getTime() - new Date(b.chargeDate).getTime())
                                .map((tx, idx) => (
                                  <div key={tx.id} className="px-4 py-2 grid grid-cols-12 gap-2 text-xs hover:bg-muted/20">
                                    <div className="col-span-3 text-muted-foreground">
                                      {tx.chargeDate ? format(new Date(tx.chargeDate), 'MMM d, yyyy') : '-'}
                                    </div>
                                    <div className="col-span-5 text-foreground flex items-center gap-1.5">
                                      {tx.feeType}
                                      {idx > 0 && tx.feeType === 'Shipping' && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                                          Reshipment
                                        </span>
                                      )}
                                      {tx.isPreview && (
                                        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                                          Est.
                                        </span>
                                      )}
                                    </div>
                                    <div className="col-span-4 text-right tabular-nums text-foreground">
                                      ${(tx.billedAmount || tx.cost || 0).toFixed(2)}
                                    </div>
                                  </div>
                                ))}
                            </div>
                          </details>
                        )}
                      </div>
                    ) : (
                      /* No breakdown data yet - show pending state */
                      <div className="px-4 py-8 text-center">
                        <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-muted/50 mb-3">
                          <svg className="h-5 w-5 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </div>
                        <p className="text-sm text-muted-foreground">Charges are being calculated</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">Cost data syncs daily</p>
                      </div>
                    )}
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

      {/* Claim Submission Dialog */}
      <ClaimSubmissionDialog
        open={claimDialogOpen}
        onOpenChange={handleClaimDialogClose}
        shipmentId={shipmentId || undefined}
        preselectedClaimType={selectedClaimType}
      />
    </Sheet>
  )
}
