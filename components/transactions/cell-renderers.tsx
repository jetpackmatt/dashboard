"use client"

import * as React from "react"
import {
  AlertCircleIcon,
  BoxIcon,
  CheckCircle2Icon,
  CheckCircleIcon,
  ClockIcon,
  CopyIcon,
  DoorOpenIcon,
  EyeIcon,
  FileSpreadsheet,
  FileText,
  FileTextIcon,
  HandIcon,
  InboxIcon,
  LoaderIcon,
  PackageIcon,
  RotateCcwIcon,
  TagIcon,
  TruckIcon,
  XCircleIcon,
} from "lucide-react"
import { format, differenceInHours } from "date-fns"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { CellRenderer } from "./transactions-table"
import { getCarrierServiceDisplay } from "@/lib/utils/carrier-service-display"

// ============================================
// FEE TYPE DISPLAY NAME MAPPING
// Some fees have been rebranded - map DB values to display names
// ============================================
const FEE_TYPE_DISPLAY_NAMES: Record<string, string> = {
  'Inventory Placement Program Fee': 'MultiHub IQ Fee',
  'WRO Receiving Fee': 'Receiving Fee',
}

/**
 * Get the display name for a fee type (handles rebranding)
 * Use this everywhere fee types are shown to users or in invoices
 */
export function getFeeTypeDisplayName(feeType: string | null | undefined): string {
  if (!feeType) return ''
  return FEE_TYPE_DISPLAY_NAMES[feeType] || feeType
}

// ============================================
// UNFULFILLED ORDERS TYPES & RENDERERS
// ============================================

export interface UnfulfilledOrder {
  id: string
  orderId: string
  shipmentId: string
  storeOrderId: string
  customerName: string
  status: string
  orderDate: string
  slaDate: string | null
  itemCount: number
  orderType: string
  channelName: string
  // Optional columns
  totalShipments: number
  destCountry: string
  shipOption: string
  // Computed field (for export - also used in cell renderer)
  age?: number | null
  // Client identification (for admin badge)
  clientId?: string | null
}

// Calculate age in days from order date
function calculateAge(orderDate: string): number {
  if (!orderDate) return 0
  const hoursElapsed = differenceInHours(new Date(), new Date(orderDate))
  return hoursElapsed / 24
}

// Format age as "X.X days"
function formatAge(days: number): string {
  if (days < 1) {
    const hours = Math.round(days * 24)
    return `${hours}h`
  }
  return `${days.toFixed(1)}d`
}

// Get age color based on how old the order is (for unfulfilled orders)
function getAgeColor(days: number): string {
  if (days >= 5) return "text-red-500 font-medium"
  if (days >= 3) return "text-amber-500 font-medium"
  return ""
}

// Get age color for shipments - only black to red (at 8+ days)
function getShipmentsAgeColor(days: number): string {
  if (days >= 8) return "text-red-500 font-medium"
  return ""
}

// Status badge colors for unfulfilled orders - Complete processing status hierarchy
function getUnfulfilledStatusColors(status: string) {
  // EXCEPTION STATES (amber/red)
  // On Hold variants: Manual Hold, Invalid Address, Package Preference Not Set, Awaiting Reset, etc.
  if (status.includes("Out of Stock") || status === "Address Issue" ||
      status === "On Hold" || status.includes("Manual") ||
      status.includes("Invalid") || status.includes("Package Preference") ||
      status === "Awaiting Reset") {
    return "bg-amber-100/50 text-amber-900 border-amber-200/50 dark:bg-amber-900/15 dark:text-amber-500 dark:border-amber-800/20"
  }
  if (status === "Exception") {
    return "bg-red-100/50 text-red-900 border-red-200/50 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30"
  }
  if (status.includes("Late")) {
    return "bg-red-100/50 text-red-900 border-red-200/50 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30"
  }

  // PROCESSING STATES (progress through fulfillment)
  // Labelled - furthest along (violet)
  if (status === "Labelled") {
    return "bg-violet-100/50 text-violet-900 border-violet-200/50 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-800/30"
  }
  // Packed (indigo)
  if (status === "Packed") {
    return "bg-indigo-100/50 text-indigo-900 border-indigo-200/50 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800/30"
  }
  // Picked (cyan)
  if (status === "Picked") {
    return "bg-cyan-100/50 text-cyan-900 border-cyan-200/50 dark:bg-cyan-900/20 dark:text-cyan-400 dark:border-cyan-800/30"
  }
  // Pick In-Progress (sky)
  if (status === "Pick In-Progress") {
    return "bg-sky-100/50 text-sky-900 border-sky-200/50 dark:bg-sky-900/20 dark:text-sky-400 dark:border-sky-800/30"
  }
  // Awaiting Pick, Processing (blue)
  if (status === "Processing" || status.includes("Awaiting Pick")) {
    return "bg-blue-100/50 text-blue-900 border-blue-200/50 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/25"
  }
  // Import Review (amber)
  if (status === "Import Review") {
    return "bg-amber-100/50 text-amber-900 border-amber-200/50 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/30"
  }

  return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-800/20 dark:text-slate-400 dark:border-slate-700/30"
}

// Status icons for unfulfilled orders - Complete processing status hierarchy
function getUnfulfilledStatusIcon(status: string) {
  // EXCEPTION STATES
  // On Hold variants: Manual Hold, Invalid Address, Package Preference Not Set, Awaiting Reset, etc.
  if (status.includes("Out of Stock") || status === "Exception" || status === "Address Issue" ||
      status === "On Hold" || status.includes("Manual") ||
      status.includes("Invalid") || status.includes("Package Preference") ||
      status === "Awaiting Reset") {
    return <AlertCircleIcon className="h-3.5 w-3.5" />
  }
  if (status.includes("Late")) {
    return <XCircleIcon className="h-3.5 w-3.5" />
  }

  // PROCESSING STATES (progress through fulfillment)
  // Labelled - furthest along
  if (status === "Labelled") {
    return <TagIcon className="h-3.5 w-3.5" />
  }
  // Packed
  if (status === "Packed") {
    return <BoxIcon className="h-3.5 w-3.5" />
  }
  // Picked
  if (status === "Picked") {
    return <CheckCircleIcon className="h-3.5 w-3.5" />
  }
  // Pick In-Progress
  if (status === "Pick In-Progress") {
    return <HandIcon className="h-3.5 w-3.5" />
  }
  // Awaiting Pick, Processing
  if (status === "Processing" || status.includes("Awaiting Pick")) {
    return <ClockIcon className="h-3.5 w-3.5" />
  }
  // Import Review
  if (status === "Import Review") {
    return <EyeIcon className="h-3.5 w-3.5" />
  }

  return <PackageIcon className="h-3.5 w-3.5" />
}

// Supported channel logomarks (SVG files in /public/icons/channels/)
// Replace these SVGs with proper square logomarks from brand asset pages
const SUPPORTED_CHANNELS = [
  'shopify', 'amazon', 'walmart', 'ebay', 'etsy', 'wix',
  'squarespace', 'bigcommerce', 'woocommerce', 'target', 'tiktok', 'magento', 'shipbob'
]

// Channel icon component for store integrations (shared by unfulfilled and shipments)
// channelName now contains the real application_name from ShipBob's Channels API
// (e.g., "Shopify", "Amazon", "Walmartv2", "BigCommerce", etc.)
function ChannelIcon({ channelName }: { channelName: string }) {
  // Normalize the platform name for icon lookup (e.g., "Walmartv2" -> "walmart")
  const platformLower = channelName?.toLowerCase().replace(/v\d+$/, '') || ''

  // Display name for tooltip - capitalize first letter
  const displayName = channelName
    ? channelName.charAt(0).toUpperCase() + channelName.slice(1).replace(/v\d+$/, '')
    : ''

  // Use local SVG file if we have one for this platform
  if (SUPPORTED_CHANNELS.includes(platformLower)) {
    return (
      <img
        src={`/icons/channels/${platformLower}.svg`}
        alt={displayName}
        title={displayName}
        className="h-4 w-4 object-contain"
      />
    )
  }

  // Fallback to text abbreviation for unknown platforms
  return (
    <span className="text-xs font-medium text-muted-foreground" title={channelName}>
      {channelName?.slice(0, 3).toUpperCase() || '-'}
    </span>
  )
}

// Cell renderers for unfulfilled orders table
export const unfulfilledCellRenderers: Record<string, CellRenderer<UnfulfilledOrder>> = {
  orderId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.orderId)
      toast.success("Order ID copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        <span className="truncate">{row.orderId || '-'}</span>
        {row.orderId && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
            title="Copy Order ID"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },

  shipmentId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.shipmentId)
      toast.success("Shipment ID copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        <span className="truncate">{row.shipmentId || "-"}</span>
        {row.shipmentId && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover/cell:opacity-100"
            title="Copy Shipment ID"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },

  storeOrderId: (row) => (
    <div className="text-muted-foreground truncate">
      {row.storeOrderId || "-"}
    </div>
  ),

  status: (row) => (
    <Badge
      variant="outline"
      className={`gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap ${getUnfulfilledStatusColors(row.status)}`}
    >
      {getUnfulfilledStatusIcon(row.status)}
      {row.status}
    </Badge>
  ),

  customerName: (row) => (
    <div className="truncate">
      {row.customerName}
    </div>
  ),

  channelName: (row) => (
    <div className="flex justify-center">
      {row.channelName ? (
        <ChannelIcon channelName={row.channelName} />
      ) : <span className="text-muted-foreground">-</span>}
    </div>
  ),

  itemCount: (row) => (
    <span>{row.itemCount}</span>
  ),

  orderType: (row) => (
    <Badge variant="outline" className="px-1.5 text-[11px] whitespace-nowrap bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-800/20 dark:text-slate-400 dark:border-slate-700/30">
      {row.orderType}
    </Badge>
  ),

  age: (row) => {
    if (!row.orderDate) return <span className="text-muted-foreground">-</span>
    const age = calculateAge(row.orderDate)
    return (
      <span className={`whitespace-nowrap ${getAgeColor(age)}`}>
        {formatAge(age)}
      </span>
    )
  },

  orderDate: (row) => {
    if (!row.orderDate) return <span className="text-muted-foreground">-</span>
    return (
      <span className="whitespace-nowrap">
        {formatTransactionDate(row.orderDate)}
      </span>
    )
  },

  slaDate: (row) => {
    if (!row.slaDate) return <span className="text-muted-foreground">-</span>
    const slaDate = new Date(row.slaDate)
    const isOverdue = slaDate < new Date()
    return (
      <span className={`whitespace-nowrap ${isOverdue ? "text-red-500 font-medium" : ""}`}>
        {formatTransactionDate(row.slaDate)}
      </span>
    )
  },

  // Optional columns
  totalShipments: (row) => (
    <div className="text-center">{row.totalShipments || 1}</div>
  ),

  destCountry: (row) => (
    <div className="truncate">{row.destCountry || "-"}</div>
  ),

  shipOption: (row) => (
    <div className="truncate">{row.shipOption || "-"}</div>
  ),
}

// ============================================
// SHIPMENTS TYPES & RENDERERS
// ============================================

// Carrier display names for proper formatting and brevity
// Maps raw DB carrier values to user-friendly display names
// Multiple DB values may map to the same display name (for consolidation)
const CARRIER_DISPLAY_NAMES: Record<string, string> = {
  'Amazon Shipping': 'Amazon',
  'APC ORD': 'APC',
  'APG eCommerce': 'APG',
  'BetterTrucks': 'BetterTrucks',
  'CanadaPost': 'Canada Post',
  'CirroECommerce': 'Cirro',
  // DHL consolidation: DHL + DHLExpress → "DHL Express"
  'DHL': 'DHL Express',
  'DHLExpress': 'DHL Express',
  // DHL Ecom consolidation: DhlEcs + DHL eCommerce MDW → "DHL Ecom"
  'DhlEcs': 'DHL Ecom',
  'DHL eCommerce MDW (Shipbob)': 'DHL Ecom',
  // FedEx consolidation: FedEx + FedExSmartPost → "FedEx"
  'FedEx': 'FedEx',
  'FedExSmartPost': 'FedEx',
  'OnTrac': 'OnTrac',
  'OSMWorldwide': 'OSM',
  'Passport': 'Passport',
  // PrePaid consolidation: PrePaid + PrePaid Freight → "Prepaid"
  'PrePaid': 'Prepaid',
  'PrePaid Freight': 'Prepaid',
  // ShipBob consolidation: ShipBob + ShipBob Freight → "ShipBob"
  'ShipBob': 'ShipBob',
  'ShipBob Freight': 'ShipBob',
  'UniUni': 'UniUni',
  'UPS': 'UPS',
  // UPS MI consolidation: UPSMI + upsmi + UPSMailInnovations → "UPS MI"
  'UPSMI': 'UPS MI',
  'upsmi': 'UPS MI',
  'UPSMailInnovations': 'UPS MI',
  'USPS': 'USPS',
  'Veho': 'Veho',
  // TrackingMore lowercase carrier codes (used in lost_in_transit_checks)
  'dhl': 'DHL Express',
  'amazon-us': 'Amazon',
  'usps': 'USPS',
  'ups': 'UPS',
  'fedex': 'FedEx',
  'ontrac': 'OnTrac',
  'gofoexpress': 'GoFo Express',
  'canada-post': 'Canada Post',
  'veho': 'Veho',
  'bettertrucks': 'BetterTrucks',
  'lasership': 'LaserShip',
  'tforce': 'TForce',
}

// Get display name for carrier (falls back to original if not mapped)
export function getCarrierDisplayName(carrier: string): string {
  if (!carrier) return '-'
  return CARRIER_DISPLAY_NAMES[carrier] || carrier
}

// Get unique display carriers from a list of raw carrier values
// Used to consolidate multiple DB values into single filter options
export function getUniqueDisplayCarriers(carriers: string[]): string[] {
  const displayNames = new Set<string>()
  for (const carrier of carriers) {
    if (carrier) {
      displayNames.add(getCarrierDisplayName(carrier))
    }
  }
  return [...displayNames].sort()
}

// Get all raw carrier values that map to a given display name
// Used for filtering - when user selects "DHL Express", we need to match both "DHL" and "DHLExpress"
export function getRawCarriersForDisplayName(displayName: string): string[] {
  const rawCarriers: string[] = []
  for (const [raw, display] of Object.entries(CARRIER_DISPLAY_NAMES)) {
    if (display === displayName) {
      rawCarriers.push(raw)
    }
  }
  // If no mapping found, assume the display name is also the raw name
  if (rawCarriers.length === 0) {
    rawCarriers.push(displayName)
  }
  return rawCarriers
}

export interface Shipment {
  id: string | number
  orderId: string
  shipmentId: string
  status: string
  customerName: string
  orderType: string
  qty: number
  charge: number
  importDate: string | null
  labelCreated: string | null  // When label was created (event_labeled)
  slaDate: string | null
  shippedDate: string | null
  deliveredDate: string | null
  inTransitDate: string | null  // When carrier picked up (event_intransit)
  transitTimeDays: number | null  // Stored transit time for delivered shipments
  channelName: string
  trackingId: string
  carrier: string
  // New optional fields for additional columns
  destCountry?: string
  orderDate?: string
  fcName?: string
  shipOption?: string
  storeOrderId?: string
  // Computed field (for export - also used in cell renderer)
  age?: number | null
  // Client identification (for admin badge)
  clientId?: string | null
  // Voided status (duplicate shipping transaction that was recreated)
  isVoided?: boolean
  // Claim eligibility status (for At Risk / File a Claim badges)
  claimEligibilityStatus?: 'at_risk' | 'eligible' | null
  claimDaysRemaining?: number | null
  // TrackingMore substatus for granular tracking info
  claimSubstatusCategory?: string | null
  claimLastScanDescription?: string | null
  claimLastScanDate?: string | null
  // Claim ticket info (from care_tickets - overrides eligibility status in UI)
  claimTicketNumber?: number | null
  claimTicketStatus?: string | null
  claimCreditAmount?: number | null
}

// ============================================
// TRACKINGMORE SUBSTATUS DISPLAY
// Convert substatus_category to user-friendly display names
// ============================================

// Substatus display for AT RISK shipments (not yet eligible for claim)
// These should be neutral/informative, not alarming - package may still be moving
const SUBSTATUS_DISPLAY_NAMES: Record<string, { label: string; color: string; icon: 'clock' | 'alert' | 'truck' | 'return' | 'customs' | 'damaged' }> = {
  'awaiting_pickup': { label: 'Awaiting Pickup', color: 'amber', icon: 'clock' },
  // For at_risk: these are "potentially delayed" not "lost" - use neutral labels
  'lost_no_scan': { label: 'No Recent Scans', color: 'amber', icon: 'clock' },
  'lost_in_transit': { label: 'Tracking Stalled', color: 'amber', icon: 'clock' },
  'returned': { label: 'Returned to Sender', color: 'blue', icon: 'return' },
  'address_issue': { label: 'Address Issue', color: 'amber', icon: 'alert' },
  'customs_hold': { label: 'Customs Hold', color: 'amber', icon: 'customs' },
  'damaged': { label: 'Damaged', color: 'red', icon: 'damaged' },
  'carrier_delay': { label: 'Carrier Delay', color: 'amber', icon: 'truck' },
  'prepaid_label': { label: 'Prepaid Label', color: 'slate', icon: 'clock' },
}

// Substatus display for ELIGIBLE shipments (can file a claim)
// These can use stronger language since claim threshold has been met
const SUBSTATUS_ELIGIBLE_DISPLAY_NAMES: Record<string, { label: string; color: string; icon: 'clock' | 'alert' | 'truck' | 'return' | 'customs' | 'damaged' }> = {
  'awaiting_pickup': { label: 'Never Picked Up', color: 'red', icon: 'alert' },
  'lost_no_scan': { label: 'Lost - No Scans', color: 'red', icon: 'alert' },
  'lost_in_transit': { label: 'Lost in Transit', color: 'red', icon: 'alert' },
  'returned': { label: 'Returned to Sender', color: 'blue', icon: 'return' },
  'address_issue': { label: 'Undeliverable', color: 'red', icon: 'alert' },
  'customs_hold': { label: 'Stuck in Customs', color: 'red', icon: 'customs' },
  'damaged': { label: 'Damaged', color: 'red', icon: 'damaged' },
  'carrier_delay': { label: 'Severely Delayed', color: 'red', icon: 'alert' },
  'prepaid_label': { label: 'Prepaid Label', color: 'slate', icon: 'clock' },
}

function getSubstatusColors(substatus: string, isEligible: boolean = false) {
  const configMap = isEligible ? SUBSTATUS_ELIGIBLE_DISPLAY_NAMES : SUBSTATUS_DISPLAY_NAMES
  const config = configMap[substatus]
  if (!config) {
    return isEligible
      ? "bg-red-100/50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30"
      : "bg-amber-100/50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/30"
  }
  switch (config.color) {
    case 'red':
      return "bg-red-100/50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30"
    case 'amber':
      return "bg-amber-100/50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/30"
    case 'blue':
      return "bg-blue-100/50 text-blue-700 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/30"
    case 'slate':
    default:
      return "bg-slate-100/50 text-slate-700 border-slate-200 dark:bg-slate-900/20 dark:text-slate-400 dark:border-slate-800/30"
  }
}

function getSubstatusIcon(substatus: string, isEligible: boolean = false) {
  const configMap = isEligible ? SUBSTATUS_ELIGIBLE_DISPLAY_NAMES : SUBSTATUS_DISPLAY_NAMES
  const config = configMap[substatus]
  if (!config) return isEligible ? <AlertCircleIcon className="h-3.5 w-3.5" /> : <ClockIcon className="h-3.5 w-3.5" />
  switch (config.icon) {
    case 'alert': return <AlertCircleIcon className="h-3.5 w-3.5" />
    case 'truck': return <TruckIcon className="h-3.5 w-3.5" />
    case 'return': return <RotateCcwIcon className="h-3.5 w-3.5" />
    case 'customs': return <BoxIcon className="h-3.5 w-3.5" />
    case 'damaged': return <XCircleIcon className="h-3.5 w-3.5" />
    case 'clock':
    default: return <ClockIcon className="h-3.5 w-3.5" />
  }
}

function getSubstatusDisplayName(substatus: string, isEligible: boolean = false): string {
  const configMap = isEligible ? SUBSTATUS_ELIGIBLE_DISPLAY_NAMES : SUBSTATUS_DISPLAY_NAMES
  return configMap[substatus]?.label || substatus?.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) || 'Unknown'
}

// Format last scan date for tooltip display (e.g., "Jan 12, 2025")
function formatLastScanDate(dateStr: string | null | undefined): string | null {
  if (!dateStr) return null
  try {
    const date = new Date(dateStr)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
  } catch {
    return null
  }
}

// Status colors for shipments - Complete ShipBob status hierarchy
function getShipmentStatusColors(status: string) {
  switch (status) {
    // REFUNDED (red - billing refund recorded)
    case "Refunded":
      return "bg-red-100/50 text-red-900 border-red-200/50 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30"

    // DELIVERED
    case "Delivered":
      return "bg-emerald-100/50 text-emerald-900 border-emerald-200/50 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/30"

    // SHIPPED - In Motion (orange)
    case "Out for Delivery":
    case "In Transit":
      return "bg-orange-100/60 text-orange-900 border-orange-200/60 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800/30"

    // SHIPPED - Awaiting carrier (blue - waiting in staging bin)
    case "Awaiting Carrier":
      return "bg-blue-100/50 text-blue-900 border-blue-200/50 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/30"

    // SHIPPED - Basic shipped (blue)
    case "Shipped":
      return "bg-blue-100/50 text-blue-900 border-blue-200/50 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/30"

    // PROCESSING - Labelled (violet)
    case "Labelled":
      return "bg-violet-100/50 text-violet-900 border-violet-200/50 dark:bg-violet-900/20 dark:text-violet-400 dark:border-violet-800/30"

    // PROCESSING - Packed (indigo)
    case "Packed":
      return "bg-indigo-100/50 text-indigo-900 border-indigo-200/50 dark:bg-indigo-900/20 dark:text-indigo-400 dark:border-indigo-800/30"

    // PROCESSING - Picked (cyan)
    case "Picked":
      return "bg-cyan-100/50 text-cyan-900 border-cyan-200/50 dark:bg-cyan-900/20 dark:text-cyan-400 dark:border-cyan-800/30"

    // PROCESSING - Pick In-Progress (sky)
    case "Pick In-Progress":
      return "bg-sky-100/50 text-sky-900 border-sky-200/50 dark:bg-sky-900/20 dark:text-sky-400 dark:border-sky-800/30"

    // PROCESSING - Awaiting Pick (slate)
    case "Awaiting Pick":
    case "Processing":
      return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-800/20 dark:text-slate-400 dark:border-slate-700/25"

    // IMPORT REVIEW (amber)
    case "Import Review":
      return "bg-amber-100/50 text-amber-900 border-amber-200/50 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/30"

    // EXCEPTIONS (red)
    case "Action Required":
    case "Cancelled":
    case "Delivery Attempted":
    case "Exception":
      return "bg-red-100/50 text-red-900 border-red-200/50 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30"

    // OUT OF STOCK (amber warning)
    case "Out of Stock":
      return "bg-amber-100/50 text-amber-900 border-amber-200/50 dark:bg-amber-900/15 dark:text-amber-500 dark:border-amber-800/20"

    // CLAIM (red - has a care ticket claim)
    case "Claim":
      return "bg-red-100/50 text-red-900 border-red-200/50 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30"

    default:
      return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-800/20 dark:text-slate-400 dark:border-slate-700/30"
  }
}

// Status icons for shipments - Complete ShipBob status hierarchy
function getShipmentStatusIcon(status: string) {
  switch (status) {
    // REFUNDED (billing refund recorded)
    case "Refunded":
      return <RotateCcwIcon />

    // DELIVERED
    case "Delivered":
      return <CheckCircle2Icon />

    // SHIPPED - In Motion
    case "Out for Delivery":
      return <DoorOpenIcon />
    case "In Transit":
      return <TruckIcon />

    // SHIPPED - Awaiting carrier pickup (sitting in staging bin)
    case "Awaiting Carrier":
      return <InboxIcon />

    // SHIPPED - Basic shipped
    case "Shipped":
      return <PackageIcon />

    // PROCESSING - Labelled
    case "Labelled":
      return <TagIcon />

    // PROCESSING - Packed
    case "Packed":
      return <BoxIcon />

    // PROCESSING - Picked
    case "Picked":
      return <CheckCircleIcon />

    // PROCESSING - Pick In-Progress
    case "Pick In-Progress":
      return <HandIcon />

    // PROCESSING - Awaiting Pick
    case "Awaiting Pick":
    case "Processing":
      return <ClockIcon />

    // IMPORT REVIEW
    case "Import Review":
      return <EyeIcon />

    // EXCEPTIONS
    case "Action Required":
    case "Delivery Attempted":
    case "Cancelled":
    case "Exception":
      return <AlertCircleIcon />

    // OUT OF STOCK
    case "Out of Stock":
      return <AlertCircleIcon />

    // CLAIM
    case "Claim":
      return <FileTextIcon />

    default:
      return <LoaderIcon />
  }
}

// Cell renderers for shipments table
export const shipmentCellRenderers: Record<string, CellRenderer<Shipment>> = {
  orderId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.orderId)
      toast.success("Order ID copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        <span className="truncate">{row.orderId || '-'}</span>
        {row.orderId && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
            title="Copy Order ID"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },

  shipmentId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.shipmentId)
      toast.success("Shipment ID copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        <span className="truncate">{row.shipmentId || "-"}</span>
        {row.shipmentId && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover/cell:opacity-100"
            title="Copy Shipment ID"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },

  status: (row) => {
    // Show Voided badge for duplicate shipping transactions that were recreated
    if (row.isVoided) {
      return <VoidedBadge />
    }

    // Priority 1: Show "Claim" status if a claim has been filed
    // This takes precedence over eligibility status since the claim is in progress
    if (row.claimTicketStatus) {
      const ticketStatus = row.claimTicketStatus
      const ticketNumber = row.claimTicketNumber

      // Build tooltip text based on status
      let tooltipText = `Ticket #${ticketNumber}`
      if (ticketStatus === 'Credit Approved' || ticketStatus === 'Resolved') {
        tooltipText = row.claimCreditAmount
          ? `Ticket #${ticketNumber} - $${row.claimCreditAmount.toFixed(2)} credited`
          : `Ticket #${ticketNumber} - Credit applied`
      } else if (ticketStatus === 'Credit Requested') {
        tooltipText = `Ticket #${ticketNumber} - Awaiting approval`
      } else if (ticketStatus === 'Credit Denied') {
        tooltipText = `Ticket #${ticketNumber} - Claim denied`
      } else {
        tooltipText = `Ticket #${ticketNumber} - ${ticketStatus}`
      }

      return (
        <TooltipProvider>
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap bg-red-100/50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30"
              >
                <FileTextIcon className="h-3.5 w-3.5" />
                Claim
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-popover text-popover-foreground border shadow-md">
              <p className="text-sm">{tooltipText}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    }

    // Priority 2: Show claim eligibility badges before normal status
    // "File a Claim" - eligible for Lost in Transit claim
    // Show specific substatus with stronger language since claim threshold is met
    // Note: Click handler is added via createShipmentCellRenderers() for interactive version
    if (row.claimEligibilityStatus === 'eligible') {
      const substatus = row.claimSubstatusCategory
      const lastScan = row.claimLastScanDescription
      const lastScanDate = formatLastScanDate(row.claimLastScanDate)

      // Show specific status if available, with eligible=true for stronger labels
      if (substatus) {
        const displayName = getSubstatusDisplayName(substatus, true)
        const colors = getSubstatusColors(substatus, true)
        const icon = getSubstatusIcon(substatus, true)

        return (
          <TooltipProvider>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={`gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap ${colors}`}
                >
                  {icon}
                  {displayName}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-popover text-popover-foreground border shadow-md max-w-xs">
                <div className="text-sm">
                  {lastScanDate && <p className="text-muted-foreground mb-1">Last scan: {lastScanDate}</p>}
                  {lastScan && <p className="mb-1">{lastScan}</p>}
                  <p className="font-medium text-red-600 dark:text-red-400">Eligible to file a claim</p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      }

      // Fallback to generic "File a Claim" if no substatus
      return (
        <Badge
          variant="outline"
          className="gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap bg-red-100/50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30"
        >
          <AlertCircleIcon className="h-3.5 w-3.5" />
          File a Claim
        </Badge>
      )
    }

    // "At Risk" - show granular TrackingMore substatus with tooltip for details
    if (row.claimEligibilityStatus === 'at_risk') {
      const daysRemaining = row.claimDaysRemaining ?? 0
      const substatus = row.claimSubstatusCategory
      const lastScan = row.claimLastScanDescription

      // If we have a substatus from TrackingMore, show that instead of generic "At Risk"
      // Pass isEligible=false for neutral/non-alarming labels
      if (substatus) {
        const displayName = getSubstatusDisplayName(substatus, false)
        const colors = getSubstatusColors(substatus, false)
        const icon = getSubstatusIcon(substatus, false)

        return (
          <TooltipProvider>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className={`gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap ${colors}`}
                >
                  {icon}
                  {displayName}
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-popover text-popover-foreground border shadow-md max-w-xs">
                <div className="text-sm">
                  {lastScan && <p className="mb-1">{lastScan}</p>}
                  <p className="text-muted-foreground">
                    {daysRemaining > 0
                      ? `Eligible for claim in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`
                      : 'Checking eligibility...'}
                  </p>
                </div>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      }

      // Fallback to generic "At Risk" if no substatus
      return (
        <TooltipProvider>
          <Tooltip delayDuration={300}>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className="gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap bg-amber-100/50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/30"
              >
                <ClockIcon className="h-3.5 w-3.5" />
                At Risk
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="bg-popover text-popover-foreground border shadow-md">
              <p className="text-sm">
                {daysRemaining > 0
                  ? `Check back in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} to file a claim`
                  : 'Eligibility check in progress'}
              </p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )
    }

    return (
      <Badge
        variant="outline"
        className={`gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap ${getShipmentStatusColors(row.status)}`}
      >
        {getShipmentStatusIcon(row.status)}
        {row.status}
      </Badge>
    )
  },

  customerName: (row) => (
    <div className="truncate">
      {row.customerName}
    </div>
  ),

  charge: (row) => (
    <div>{row.charge != null ? `$${row.charge.toFixed(2)}` : <span className="text-muted-foreground">-</span>}</div>
  ),

  qty: (row) => (
    <div className="text-center">{row.qty}</div>
  ),

  orderType: (row) => (
    <Badge variant="outline" className="px-1.5 text-[11px] whitespace-nowrap bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-800/20 dark:text-slate-400 dark:border-slate-700/30">
      {row.orderType}
    </Badge>
  ),

  transitTimeDays: (row) => {
    // Transit time = time from carrier pickup (event_intransit) to delivery
    // If delivered: use stored transit_time_days or calculate from dates
    // If in transit: calculate live from inTransitDate → now

    // If delivered and we have stored transit time, use it
    if (row.deliveredDate && row.transitTimeDays != null) {
      return (
        <span className="whitespace-nowrap">
          {row.transitTimeDays.toFixed(1)}d
        </span>
      )
    }

    // Need inTransitDate to calculate
    if (!row.inTransitDate) return <span className="text-muted-foreground">-</span>

    const inTransitDate = new Date(row.inTransitDate)
    const endDate = row.deliveredDate ? new Date(row.deliveredDate) : new Date()
    const days = (endDate.getTime() - inTransitDate.getTime()) / (1000 * 60 * 60 * 24)

    // For in-transit shipments (not delivered yet), show in blue
    if (!row.deliveredDate) {
      return (
        <span className="whitespace-nowrap text-blue-600 dark:text-blue-400">
          {days.toFixed(1)}d
        </span>
      )
    }

    return (
      <span className="whitespace-nowrap">
        {days.toFixed(1)}d
      </span>
    )
  },

  importDate: (row) => {
    if (!row.importDate) return <span className="text-muted-foreground">-</span>
    return (
      <span className="whitespace-nowrap">
        {formatTransactionDate(row.importDate)}
      </span>
    )
  },

  labelCreated: (row) => {
    if (!row.labelCreated) return <span className="text-muted-foreground">-</span>
    return (
      <span className="whitespace-nowrap">
        {formatTransactionDate(row.labelCreated)}
      </span>
    )
  },

  trackingId: (row) => {
    const trackingUrl = getTrackingUrl(row.carrier, row.trackingId)
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.trackingId)
      toast.success("Tracking ID copied")
    }
    if (!row.trackingId) return <span className="text-muted-foreground">-</span>
    return (
      <div className="group/cell flex items-center gap-1.5">
        {trackingUrl ? (
          <a
            href={trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 truncate"
          >
            {row.trackingId}
          </a>
        ) : (
          <span className="truncate">{row.trackingId}</span>
        )}
        <button
          onClick={handleCopy}
          className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover/cell:opacity-100"
          title="Copy Tracking ID"
        >
          <CopyIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  },

  slaDate: (row) => {
    const deliveredDate = row.deliveredDate
    const slaDate = row.slaDate
    const dateStr = deliveredDate || slaDate
    if (!dateStr) return <span className="text-muted-foreground">-</span>
    const isDelivered = !!deliveredDate
    return (
      <span className={`whitespace-nowrap ${isDelivered ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
        {formatTransactionDate(dateStr)}
      </span>
    )
  },

  // New columns
  age: (row) => {
    if (!row.labelCreated) return <span className="text-muted-foreground">-</span>
    // Calculate age from label creation (event_labeled) to delivered date (or now if not delivered)
    const startDate = new Date(row.labelCreated)
    const endDate = row.deliveredDate ? new Date(row.deliveredDate) : new Date()
    const hoursElapsed = differenceInHours(endDate, startDate)
    const days = hoursElapsed / 24
    return (
      <span className={`whitespace-nowrap ${getShipmentsAgeColor(days)}`}>
        {formatAge(days)}
      </span>
    )
  },

  carrier: (row) => (
    <div className="truncate">{getCarrierDisplayName(row.carrier)}</div>
  ),

  channelName: (row) => (
    <div className="flex justify-center">
      {row.channelName ? (
        <ChannelIcon channelName={row.channelName} />
      ) : <span className="text-muted-foreground">-</span>}
    </div>
  ),

  destCountry: (row) => (
    <div className="truncate">{row.destCountry || "-"}</div>
  ),

  orderDate: (row) => {
    if (!row.orderDate) return <span className="text-muted-foreground">-</span>
    return (
      <span className="whitespace-nowrap">
        {formatTransactionDate(row.orderDate)}
      </span>
    )
  },

  fcName: (row) => (
    <div className="truncate">{row.fcName || "-"}</div>
  ),

  shipOption: (row) => (
    <div className="truncate">{row.shipOption || "-"}</div>
  ),

  deliveredDate: (row) => {
    if (!row.deliveredDate) return <span className="text-muted-foreground">-</span>
    return (
      <span className="whitespace-nowrap text-emerald-600 dark:text-emerald-400">
        {formatTransactionDate(row.deliveredDate)}
      </span>
    )
  },

  storeOrderId: (row) => (
    <div className="text-muted-foreground truncate">
      {row.storeOrderId || "-"}
    </div>
  ),
}

/**
 * Factory function to create shipment cell renderers with click handlers
 * Use this when you need interactive "File a Claim" badges
 */
export function createShipmentCellRenderers(options?: {
  onFileClaimClick?: (shipmentId: string) => void
}): Record<string, CellRenderer<Shipment>> {
  return {
    ...shipmentCellRenderers,
    // Override status renderer with interactive version
    status: (row) => {
      // Show Voided badge for duplicate shipping transactions that were recreated
      if (row.isVoided) {
        return <VoidedBadge />
      }

      // Priority 1: Show "Claim" status if a claim has been filed
      // This takes precedence over eligibility status since the claim is in progress
      if (row.claimTicketStatus) {
        const ticketStatus = row.claimTicketStatus
        const ticketNumber = row.claimTicketNumber

        // Build tooltip text based on status
        let tooltipText = `Ticket #${ticketNumber}`
        if (ticketStatus === 'Credit Approved' || ticketStatus === 'Resolved') {
          tooltipText = row.claimCreditAmount
            ? `Ticket #${ticketNumber} - $${row.claimCreditAmount.toFixed(2)} credited`
            : `Ticket #${ticketNumber} - Credit applied`
        } else if (ticketStatus === 'Credit Requested') {
          tooltipText = `Ticket #${ticketNumber} - Awaiting approval`
        } else if (ticketStatus === 'Credit Denied') {
          tooltipText = `Ticket #${ticketNumber} - Claim denied`
        } else {
          tooltipText = `Ticket #${ticketNumber} - ${ticketStatus}`
        }

        return (
          <TooltipProvider>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap bg-red-100/50 text-red-700 border-red-200 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30"
                >
                  <FileTextIcon className="h-3.5 w-3.5" />
                  Claim
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-popover text-popover-foreground border shadow-md">
                <p className="text-sm">{tooltipText}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      }

      // Priority 2: Show claim eligibility badges before normal status
      // "File a Claim" - eligible for Lost in Transit claim (clickable)
      // Show specific substatus with stronger language since claim threshold is met
      if (row.claimEligibilityStatus === 'eligible') {
        const substatus = row.claimSubstatusCategory
        const lastScan = row.claimLastScanDescription
        const lastScanDate = formatLastScanDate(row.claimLastScanDate)

        // Show specific status if available, with eligible=true for stronger labels
        if (substatus) {
          const displayName = getSubstatusDisplayName(substatus, true)
          const colors = getSubstatusColors(substatus, true)
          const icon = getSubstatusIcon(substatus, true)

          return (
            <TooltipProvider>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={`gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap cursor-pointer hover:opacity-80 ${colors}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      options?.onFileClaimClick?.(row.shipmentId)
                    }}
                  >
                    {icon}
                    {displayName}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-popover text-popover-foreground border shadow-md max-w-xs">
                  <div className="text-sm">
                    {lastScanDate && <p className="text-muted-foreground mb-1">Last scan: {lastScanDate}</p>}
                    {lastScan && <p className="mb-1">{lastScan}</p>}
                    <p className="font-medium text-red-600 dark:text-red-400">Click to file a claim</p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        }

        // Fallback to generic "File a Claim" if no substatus
        return (
          <Badge
            variant="outline"
            className="gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap cursor-pointer bg-red-100/50 text-red-700 border-red-200 hover:bg-red-200/50 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30 dark:hover:bg-red-900/30"
            onClick={(e) => {
              e.stopPropagation()
              options?.onFileClaimClick?.(row.shipmentId)
            }}
          >
            <AlertCircleIcon className="h-3.5 w-3.5" />
            File a Claim
          </Badge>
        )
      }

      // "At Risk" - show granular TrackingMore substatus with tooltip for details
      if (row.claimEligibilityStatus === 'at_risk') {
        const daysRemaining = row.claimDaysRemaining ?? 0
        const substatus = row.claimSubstatusCategory
        const lastScan = row.claimLastScanDescription

        // If we have a substatus from TrackingMore, show that instead of generic "At Risk"
        // Pass isEligible=false for neutral/non-alarming labels
        if (substatus) {
          const displayName = getSubstatusDisplayName(substatus, false)
          const colors = getSubstatusColors(substatus, false)
          const icon = getSubstatusIcon(substatus, false)

          return (
            <TooltipProvider>
              <Tooltip delayDuration={300}>
                <TooltipTrigger asChild>
                  <Badge
                    variant="outline"
                    className={`gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap ${colors}`}
                  >
                    {icon}
                    {displayName}
                  </Badge>
                </TooltipTrigger>
                <TooltipContent side="top" className="bg-popover text-popover-foreground border shadow-md max-w-xs">
                  <div className="text-sm">
                    {lastScan && <p className="mb-1">{lastScan}</p>}
                    <p className="text-muted-foreground">
                      {daysRemaining > 0
                        ? `Eligible for claim in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''}`
                        : 'Checking eligibility...'}
                    </p>
                  </div>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        }

        // Fallback to generic "At Risk" if no substatus
        return (
          <TooltipProvider>
            <Tooltip delayDuration={300}>
              <TooltipTrigger asChild>
                <Badge
                  variant="outline"
                  className="gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap bg-amber-100/50 text-amber-700 border-amber-200 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/30"
                >
                  <ClockIcon className="h-3.5 w-3.5" />
                  At Risk
                </Badge>
              </TooltipTrigger>
              <TooltipContent side="top" className="bg-popover text-popover-foreground border shadow-md">
                <p className="text-sm">
                  {daysRemaining > 0
                    ? `Check back in ${daysRemaining} day${daysRemaining !== 1 ? 's' : ''} to file a claim`
                    : 'Eligibility check in progress'}
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )
      }

      return (
        <Badge
          variant="outline"
          className={`gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap ${getShipmentStatusColors(row.status)}`}
        >
          {getShipmentStatusIcon(row.status)}
          {row.status}
        </Badge>
      )
    },
  }
}

// ============================================
// BILLING STATUS COLORS (shared across billing tabs)
// ============================================

function getBillingStatusColors(status: string) {
  const statusLower = status?.toLowerCase() || ''
  if (statusLower === 'invoiced') {
    return "bg-emerald-100/50 text-emerald-900 border-emerald-200/50 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/30"
  }
  if (statusLower === 'pending') {
    return "bg-amber-100/50 text-amber-900 border-amber-200/50 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/30"
  }
  if (statusLower === 'credited') {
    return "bg-blue-100/50 text-blue-900 border-blue-200/50 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/30"
  }
  return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-800/20 dark:text-slate-400 dark:border-slate-700/30"
}

// Format status for display (capitalize first letter)
function formatBillingStatus(status: string): string {
  if (!status) return '-'
  return status.charAt(0).toUpperCase() + status.slice(1).toLowerCase()
}

/**
 * Format a date/time string for transaction tables.
 * - Within last 12 months: "Oct 24, 2:30 PM" (no year)
 * - Older than 12 months: "Oct 24, 2024 2:30 PM" (with year)
 * - Date-only strings (no time): show date only without time
 */
function formatTransactionDate(dateStr: string): string {
  if (!dateStr) return '-'

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const now = new Date()
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate())

  // Check if this is a date-only string (no time component)
  const hasTime = dateStr.includes('T') && !dateStr.endsWith('T00:00:00.000Z') && !dateStr.endsWith('T00:00:00Z')

  // Parse the date
  const date = new Date(dateStr)
  const isWithinLast12Months = date >= twelveMonthsAgo

  const monthName = months[date.getMonth()]
  const day = date.getDate()
  const year = date.getFullYear()

  // Format time if present
  let timeStr = ''
  if (hasTime) {
    const hours = date.getHours()
    const minutes = date.getMinutes()
    const ampm = hours >= 12 ? 'PM' : 'AM'
    const hour12 = hours % 12 || 12
    timeStr = minutes > 0 ? `, ${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}` : `, ${hour12} ${ampm}`
  }

  if (isWithinLast12Months) {
    return `${monthName} ${day}${timeStr}`
  } else {
    return `${monthName} ${day}, ${year}${timeStr}`
  }
}

/**
 * Legacy format for date-only display (no time).
 * Used for invoice dates and other date-only fields.
 * - Within last 12 months: "Oct 24" (no year)
 * - Older than 12 months: "Oct 24, 2024" (with year)
 */
function formatDateFixed(dateStr: string): string {
  if (!dateStr) return '-'

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const now = new Date()
  const twelveMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 12, now.getDate())

  // Extract just the YYYY-MM-DD part to avoid timezone issues
  const datePart = dateStr.split('T')[0]
  const [year, month, day] = datePart.split('-')
  const dateObj = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))

  const isWithinLast12Months = dateObj >= twelveMonthsAgo
  const monthName = months[parseInt(month) - 1]
  const dayNum = parseInt(day)

  if (isWithinLast12Months) {
    return `${monthName} ${dayNum}`
  } else {
    return `${monthName} ${dayNum}, ${year}`
  }
}

// ============================================
// PENDING BADGE COMPONENT
// Shows a "Pending" badge matching the status column style for uninvoiced items
// ============================================

function PendingBadge() {
  return (
    <Badge
      variant="outline"
      className="px-1.5 text-[11px] whitespace-nowrap bg-amber-100/50 text-amber-900 border-amber-200/50 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/30"
    >
      Pending
    </Badge>
  )
}

// ============================================
// VOIDED BADGE COMPONENT
// Shows a "Voided" badge for duplicate shipping transactions that were recreated
// ============================================

function VoidedBadge() {
  return (
    <Badge
      variant="outline"
      className="px-1.5 text-[11px] whitespace-nowrap bg-gray-100/50 text-gray-600 border-gray-200/50 dark:bg-gray-900/20 dark:text-gray-400 dark:border-gray-800/30"
    >
      Voided
    </Badge>
  )
}

// ============================================
// CLICKABLE INVOICE CELL WITH DROPDOWN
// Fetches invoice files and shows PDF/XLS download menu
// ============================================

interface InvoiceCellProps {
  invoiceNumber: string
}

function InvoiceCell({ invoiceNumber }: InvoiceCellProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [isLoading, setIsLoading] = React.useState(false)
  const [urls, setUrls] = React.useState<{ pdfUrl: string | null; xlsUrl: string | null } | null>(null)

  if (!invoiceNumber) {
    return <PendingBadge />
  }

  async function handleOpenChange(open: boolean) {
    setIsOpen(open)
    if (open && !urls) {
      setIsLoading(true)
      try {
        const response = await fetch(`/api/invoices/${invoiceNumber}/files`)
        if (response.ok) {
          const data = await response.json()
          setUrls({ pdfUrl: data.pdfUrl, xlsUrl: data.xlsUrl })
        } else {
          toast.error('Failed to load invoice files')
        }
      } catch {
        toast.error('Failed to load invoice files')
      } finally {
        setIsLoading(false)
      }
    }
  }

  function handleDownload(url: string | null, type: string) {
    if (!url) {
      toast.error(`${type} file not available`)
      return
    }
    window.open(url, '_blank')
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={handleOpenChange}>
      <DropdownMenuTrigger asChild>
        <button className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline truncate text-left">
          {invoiceNumber}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {isLoading ? (
          <DropdownMenuItem disabled>
            <LoaderIcon className="h-4 w-4 mr-2 animate-spin" />
            Loading...
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={() => handleDownload(urls?.pdfUrl || null, 'PDF')}>
              <FileText className="h-4 w-4 mr-2" />
              View PDF
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownload(urls?.xlsUrl || null, 'XLSX')}>
              <FileSpreadsheet className="h-4 w-4 mr-2" />
              View XLSX
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ============================================
// ADDITIONAL SERVICES TYPES & RENDERERS
// (transactions table - shipment fees)
// ============================================

export interface AdditionalService {
  id: string
  clientId?: string
  referenceId: string
  feeType: string
  charge: number
  transactionDate: string
  invoiceNumber: string
  invoiceDate: string
  status: string
}

export const additionalServicesCellRenderers: Record<string, CellRenderer<AdditionalService>> = {
  referenceId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.referenceId)
      toast.success("Reference ID copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        <span className="truncate">{row.referenceId || '-'}</span>
        {row.referenceId && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
            title="Copy Reference ID"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },
  feeType: (row) => (
    <div className="truncate">{getFeeTypeDisplayName(row.feeType) || '-'}</div>
  ),
  charge: (row) => (
    <div>{row.charge != null ? `$${row.charge.toFixed(2)}` : <span className="text-muted-foreground">-</span>}</div>
  ),
  transactionDate: (row) => (
    <span className="whitespace-nowrap">{formatTransactionDate(row.transactionDate)}</span>
  ),
  status: (row) => (
    <Badge variant="outline" className={`px-1.5 text-[11px] whitespace-nowrap ${getBillingStatusColors(row.status)}`}>
      {formatBillingStatus(row.status)}
    </Badge>
  ),
  invoiceNumber: (row) => (
    <InvoiceCell invoiceNumber={row.invoiceNumber} />
  ),
  invoiceDate: (row) => (
    row.invoiceDate ? (
      <span className="whitespace-nowrap">{formatDateFixed(row.invoiceDate)}</span>
    ) : <PendingBadge />
  ),
}

// ============================================
// RETURNS TYPES & RENDERERS
// (transactions table - returns)
// ============================================

export interface Return {
  id: string
  clientId?: string
  returnId: string
  originalShipmentId: string
  trackingNumber: string
  returnStatus: string
  returnType: string
  returnCreationDate: string
  fcName: string
  charge: number
  invoiceNumber: string
  invoiceDate: string
  status: string
}

// Return status colors (different from billing status)
function getReturnStatusColors(status: string) {
  const statusLower = status?.toLowerCase() || ''
  if (statusLower === 'completed' || statusLower === 'processed') {
    return "bg-emerald-100/50 text-emerald-900 border-emerald-200/50 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/30"
  }
  if (statusLower === 'in transit' || statusLower === 'processing') {
    return "bg-blue-100/50 text-blue-900 border-blue-200/50 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/30"
  }
  if (statusLower === 'pending' || statusLower === 'awaiting') {
    return "bg-amber-100/50 text-amber-900 border-amber-200/50 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/30"
  }
  return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-800/20 dark:text-slate-400 dark:border-slate-700/30"
}

export const returnsCellRenderers: Record<string, CellRenderer<Return>> = {
  returnId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.returnId)
      toast.success("Return ID copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        <span className="truncate">{row.returnId || '-'}</span>
        {row.returnId && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
            title="Copy Return ID"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },
  originalShipmentId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.originalShipmentId)
      toast.success("Shipment ID copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        {row.originalShipmentId ? (
          <>
            <span className="truncate">{row.originalShipmentId}</span>
            <button
              onClick={handleCopy}
              className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover/cell:opacity-100"
              title="Copy Shipment ID"
            >
              <CopyIcon className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </div>
    )
  },
  trackingNumber: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.trackingNumber)
      toast.success("Tracking # copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        {row.trackingNumber ? (
          <>
            <span className="text-muted-foreground truncate">{row.trackingNumber}</span>
            <button
              onClick={handleCopy}
              className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors opacity-0 group-hover/cell:opacity-100"
              title="Copy Tracking #"
            >
              <CopyIcon className="h-3.5 w-3.5" />
            </button>
          </>
        ) : (
          <span className="text-muted-foreground">-</span>
        )}
      </div>
    )
  },
  returnStatus: (row) => (
    row.returnStatus ? (
      <Badge variant="outline" className={`px-1.5 text-[11px] whitespace-nowrap ${getReturnStatusColors(row.returnStatus)}`}>
        {row.returnStatus}
      </Badge>
    ) : <span className="text-muted-foreground">-</span>
  ),
  returnType: (row) => (
    <div className="truncate">{row.returnType || '-'}</div>
  ),
  returnCreationDate: (row) => (
    <span className="whitespace-nowrap">{formatTransactionDate(row.returnCreationDate)}</span>
  ),
  fcName: (row) => (
    <div className="truncate">{row.fcName || '-'}</div>
  ),
  charge: (row) => (
    <div>{row.charge != null ? `$${row.charge.toFixed(2)}` : <span className="text-muted-foreground">-</span>}</div>
  ),
  status: (row) => (
    <Badge variant="outline" className={`px-1.5 text-[11px] whitespace-nowrap ${getBillingStatusColors(row.status)}`}>
      {formatBillingStatus(row.status)}
    </Badge>
  ),
  invoiceNumber: (row) => (
    <InvoiceCell invoiceNumber={row.invoiceNumber} />
  ),
  invoiceDate: (row) => (
    row.invoiceDate ? (
      <span className="whitespace-nowrap">{formatDateFixed(row.invoiceDate)}</span>
    ) : <PendingBadge />
  ),
}

// ============================================
// RECEIVING TYPES & RENDERERS
// (transactions table - receiving, joined with receiving_orders)
// ============================================

export interface Receiving {
  id: string
  clientId?: string
  wroId: string
  receivingStatus: string
  contents: string
  feeType: string
  charge: number
  transactionDate: string
  invoiceNumber: string
  invoiceDate: string
  isPending?: boolean  // true if WRO hasn't been billed yet
}

// Receiving status colors (similar to return status)
function getReceivingStatusColors(status: string) {
  const statusLower = status?.toLowerCase() || ''
  if (statusLower === 'completed' || statusLower === 'received') {
    return "bg-emerald-100/50 text-emerald-900 border-emerald-200/50 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800/30"
  }
  if (statusLower === 'processing' || statusLower === 'in progress') {
    return "bg-blue-100/50 text-blue-900 border-blue-200/50 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800/30"
  }
  if (statusLower === 'awaiting' || statusLower === 'pending') {
    return "bg-amber-100/50 text-amber-900 border-amber-200/50 dark:bg-amber-900/20 dark:text-amber-400 dark:border-amber-800/30"
  }
  return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-800/20 dark:text-slate-400 dark:border-slate-700/30"
}

// Format PascalCase status strings (e.g., "InternalTransfer" -> "Internal Transfer")
// Also handles specific shortening for display
function formatReceivingStatus(status: string): string {
  if (!status) return ''
  // First convert PascalCase to spaced words
  let formatted = status.replace(/([a-z])([A-Z])/g, '$1 $2')
  // Shorten specific long statuses for better table display
  if (formatted === 'Partially Arrived At Hub') {
    formatted = 'Partially Arrived'
  }
  return formatted
}

export const receivingCellRenderers: Record<string, CellRenderer<Receiving>> = {
  transactionDate: (row) => (
    <span className="whitespace-nowrap">{formatTransactionDate(row.transactionDate)}</span>
  ),
  wroId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.wroId)
      toast.success("WRO ID copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        <span className="truncate">{row.wroId || '-'}</span>
        {row.wroId && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
            title="Copy WRO ID"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },
  receivingStatus: (row) => (
    row.receivingStatus ? (
      <Badge variant="outline" className={`px-1.5 text-[11px] whitespace-nowrap ${getReceivingStatusColors(row.receivingStatus)}`}>
        {formatReceivingStatus(row.receivingStatus)}
      </Badge>
    ) : <span className="text-muted-foreground">-</span>
  ),
  contents: (row) => {
    const contents = row.contents || '-'
    if (contents === '-') {
      return <div className="text-muted-foreground">-</div>
    }
    return (
      <TooltipProvider>
        <Tooltip delayDuration={300}>
          <TooltipTrigger asChild>
            <div className="truncate cursor-help text-muted-foreground hover:text-foreground transition-colors">
              {contents}
            </div>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs bg-popover text-popover-foreground border shadow-md">
            <p className="text-sm whitespace-pre-wrap">{contents}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  },
  feeType: (row) => (
    <div className="truncate">{getFeeTypeDisplayName(row.feeType) || '-'}</div>
  ),
  charge: (row) => (
    row.isPending ? (
      <PendingBadge />
    ) : (
      <div>{row.charge != null ? `$${row.charge.toFixed(2)}` : <span className="text-muted-foreground">-</span>}</div>
    )
  ),
  invoiceNumber: (row) => (
    <InvoiceCell invoiceNumber={row.invoiceNumber} />
  ),
  invoiceDate: (row) => (
    row.invoiceDate ? (
      <span className="whitespace-nowrap">{formatDateFixed(row.invoiceDate)}</span>
    ) : <PendingBadge />
  ),
}

// ============================================
// STORAGE TYPES & RENDERERS
// (transactions table - storage)
// ============================================

export interface Storage {
  id: string
  clientId?: string
  inventoryId: string
  chargeStartDate: string
  fcName: string
  locationType: string
  quantity: number
  ratePerMonth: number
  charge: number
  invoiceNumber: string
  invoiceDate: string
  status: string
  comment: string
}

export const storageCellRenderers: Record<string, CellRenderer<Storage>> = {
  inventoryId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.inventoryId)
      toast.success("Inventory ID copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        <span className="truncate">{row.inventoryId || '-'}</span>
        {row.inventoryId && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
            title="Copy Inventory ID"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },
  fcName: (row) => (
    <div className="truncate">{row.fcName || '-'}</div>
  ),
  locationType: (row) => (
    <div className="truncate">{row.locationType || '-'}</div>
  ),
  chargeStartDate: (row) => (
    <span className="whitespace-nowrap">{formatTransactionDate(row.chargeStartDate)}</span>
  ),
  charge: (row) => (
    <div>{row.charge != null ? `$${row.charge.toFixed(2)}` : <span className="text-muted-foreground">-</span>}</div>
  ),
  status: (row) => (
    <Badge variant="outline" className={`px-1.5 text-[11px] whitespace-nowrap ${getBillingStatusColors(row.status)}`}>
      {formatBillingStatus(row.status)}
    </Badge>
  ),
  invoiceNumber: (row) => (
    <InvoiceCell invoiceNumber={row.invoiceNumber} />
  ),
  invoiceDate: (row) => (
    row.invoiceDate ? (
      <span className="whitespace-nowrap">{formatDateFixed(row.invoiceDate)}</span>
    ) : <PendingBadge />
  ),
  comment: (row) => (
    <div className="truncate text-muted-foreground">{row.comment || '-'}</div>
  ),
}

// ============================================
// CREDITS TYPES & RENDERERS
// (transactions table - credits)
// ============================================

export interface Credit {
  id: string
  clientId?: string
  referenceId: string
  transactionDate: string
  sbTicketReference: string
  creditInvoiceNumber: string
  invoiceDate: string
  creditReason: string
  creditAmount: number
  status: string
}

export const creditsCellRenderers: Record<string, CellRenderer<Credit>> = {
  referenceId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.referenceId)
      toast.success("Reference ID copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        <span>{row.referenceId || '-'}</span>
        {row.referenceId && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
            title="Copy Reference ID"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },
  sbTicketReference: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.sbTicketReference)
      toast.success("Ticket # copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        <span>{row.sbTicketReference || '-'}</span>
        {row.sbTicketReference && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
            title="Copy Ticket #"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },
  creditReason: (row) => (
    <div className="truncate">{row.creditReason || '-'}</div>
  ),
  creditAmount: (row) => (
    <div className="text-emerald-600 dark:text-emerald-400">
      {row.creditAmount != null ? `$${row.creditAmount.toFixed(2)}` : <span className="text-muted-foreground">-</span>}
    </div>
  ),
  transactionDate: (row) => (
    <span className="whitespace-nowrap">{formatTransactionDate(row.transactionDate)}</span>
  ),
  status: (row) => (
    <Badge variant="outline" className={`px-1.5 text-[11px] whitespace-nowrap ${getBillingStatusColors(row.status)}`}>
      {formatBillingStatus(row.status)}
    </Badge>
  ),
  creditInvoiceNumber: (row) => (
    <InvoiceCell invoiceNumber={row.creditInvoiceNumber} />
  ),
  invoiceDate: (row) => (
    row.invoiceDate ? (
      <span className="whitespace-nowrap">{formatDateFixed(row.invoiceDate)}</span>
    ) : <PendingBadge />
  ),
}

// ============================================
// SHIPPED ORDERS TYPES & RENDERERS
// ============================================

export interface ShippedOrder {
  id: number
  orderId: string
  storeOrderId: string
  customerName: string
  status: string
  carrier: string
  carrierService: string
  trackingId: string
  shippedDate: string | null
  deliveredDate: string | null
  itemCount: number
  charge: number
}

// Use same status colors as shipments for consistency
function getShippedStatusColors(status: string) {
  return getShipmentStatusColors(status)
}

/**
 * Get carrier tracking URL for a given tracking ID
 * Supports all carriers in our database with verified tracking URLs
 */
export function getTrackingUrl(carrier: string, trackingId: string): string | null {
  if (!trackingId) return null
  const carrierLower = carrier?.toLowerCase() || ''

  // UPS
  if (carrierLower.includes('ups')) {
    return `https://www.ups.com/track?tracknum=${trackingId}`
  }

  // FedEx (including FedExSmartPost - handed off to USPS for final delivery)
  if (carrierLower.includes('fedex')) {
    return `https://www.fedex.com/fedextrack/?trknbr=${trackingId}`
  }

  // USPS
  if (carrierLower.includes('usps')) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingId}`
  }

  // DHL Express & DHL eCommerce Solutions
  if (carrierLower.includes('dhl')) {
    // DHL eCommerce uses different tracking
    if (carrierLower.includes('ecs') || carrierLower.includes('ecommerce')) {
      return `https://webtrack.dhlglobalmail.com/?trackingnumber=${trackingId}`
    }
    // DHL Express - use global tracking with submit param
    return `https://www.dhl.com/global-en/home/tracking/tracking-express.html?submit=1&tracking-id=${trackingId}`
  }

  // Veho - Regional last-mile carrier (hash-based routing)
  if (carrierLower.includes('veho')) {
    return `https://track.shipveho.com/#/trackingId/${trackingId}`
  }

  // OnTrac - West Coast regional carrier (merged with LaserShip)
  if (carrierLower.includes('ontrac') || carrierLower.includes('lasership')) {
    return `https://www.ontrac.com/tracking/?number=${trackingId}`
  }

  // Amazon Shipping - TBA/TBC/TBM tracking numbers
  if (carrierLower.includes('amazon')) {
    return `https://track.amazon.com/tracking/${trackingId}`
  }

  // BetterTrucks - Regional carrier
  if (carrierLower.includes('bettertrucks') || carrierLower.includes('better trucks')) {
    return `https://tracking.bettertrucks.com/tracking?trackingNumber=${trackingId}`
  }

  // OSM Worldwide - Parcel consolidator that hands off to USPS for final delivery
  // Use USPS tracking since their portal doesn't provide useful tracking info
  if (carrierLower.includes('osm')) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingId}`
  }

  // Cirro eCommerce / Cirro Parcel (Pitney Bowes) - use their track portal
  if (carrierLower.includes('cirro')) {
    return `https://www.cirrotrack.com/parcelTracking?id=${trackingId}`
  }

  // UniUni - Canadian regional carrier
  if (carrierLower.includes('uniuni')) {
    return `https://www.uniuni.com/tracking?no=${trackingId}`
  }

  // ShipBob internal / PrePaid - no external tracking URL
  if (carrierLower.includes('shipbob') || carrierLower.includes('prepaid')) {
    return null
  }

  return null
}

export const shippedCellRenderers: Record<string, CellRenderer<ShippedOrder>> = {
  orderId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.orderId)
      toast.success("Order ID copied")
    }
    return (
      <div className="group/cell flex items-center gap-1.5">
        <span className="truncate">{row.orderId || '-'}</span>
        {row.orderId && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
            title="Copy Order ID"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },
  storeOrderId: (row) => (
    <div className="text-muted-foreground truncate">{row.storeOrderId || "-"}</div>
  ),
  customerName: (row) => (
    <div className="truncate">{row.customerName}</div>
  ),
  status: (row) => (
    <Badge variant="outline" className={`gap-1 px-1.5 text-[11px] [&_svg]:size-3 whitespace-nowrap ${getShippedStatusColors(row.status)}`}>
      {getShipmentStatusIcon(row.status)}
      {row.status}
    </Badge>
  ),
  carrier: (row) => (
    <div>
      <div className="truncate">{getCarrierDisplayName(row.carrier)}</div>
      {row.carrierService && (
        <div className="text-xs text-muted-foreground truncate">{getCarrierServiceDisplay(row.carrierService, row.carrier)}</div>
      )}
    </div>
  ),
  trackingId: (row) => {
    const trackingUrl = getTrackingUrl(row.carrier, row.trackingId)
    if (!row.trackingId) return <span className="text-muted-foreground">-</span>
    return trackingUrl ? (
      <a
        href={trackingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 truncate block"
      >
        {row.trackingId}
      </a>
    ) : (
      <span className="truncate block">{row.trackingId}</span>
    )
  },
  shippedDate: (row) => (
    row.shippedDate ? (
      <span className="whitespace-nowrap">{formatTransactionDate(row.shippedDate)}</span>
    ) : <span className="text-muted-foreground">-</span>
  ),
  deliveredDate: (row) => (
    row.deliveredDate ? (
      <span className="whitespace-nowrap text-emerald-600 dark:text-emerald-400">{formatTransactionDate(row.deliveredDate)}</span>
    ) : <span className="text-muted-foreground">-</span>
  ),
  itemCount: (row) => (
    <div className="text-center">{row.itemCount}</div>
  ),
  charge: (row) => (
    row.charge ? <div>${row.charge.toFixed(2)}</div> : <span className="text-muted-foreground">-</span>
  ),
}
