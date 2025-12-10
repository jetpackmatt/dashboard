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
import { CellRenderer } from "./transactions-table"

// ShipBob merchant portal deep link helper
// Uses Text Fragments to scroll to and highlight the shipment row
const SHIPBOB_ORDERS_BASE = "https://web.shipbob.com/app/merchant/#/order-shipment-management/orders"
const SHIPBOB_PAGE_STATE = "eJyrViotTi3yTFGyMrYwMzY10FEqTk0sSs5QslIyNjI3sDAwMbZQ0lFKy8wpSS0qBoqqmjupGhlBFIWkVpQAOarGjhDRssSc0lSogJERXD9IxMgZSOYXpBYlluQXwZWkFoKY5i5ApFQLAF5fJMI="

function getShipBobOrderUrl(shipmentId: string): string {
  // Use Text Fragment to highlight the shipment ID in the table
  return `${SHIPBOB_ORDERS_BASE}?page-state=${SHIPBOB_PAGE_STATE}:~:text=${shipmentId}`
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
  return "text-muted-foreground"
}

// Get age color for shipments - only black to red (at 8+ days)
function getShipmentsAgeColor(days: number): string {
  if (days >= 8) return "text-red-500 font-medium"
  return "text-muted-foreground"
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
  orderId: (row) => (
    <div className="font-medium text-foreground truncate">
      {row.orderId}
    </div>
  ),

  shipmentId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.shipmentId)
      toast.success("Shipment ID copied")
    }
    return (
      <div className="flex items-center gap-1.5">
        {row.shipmentId ? (
          <a
            href={getShipBobOrderUrl(row.shipmentId)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm truncate"
          >
            {row.shipmentId}
          </a>
        ) : (
          <span>-</span>
        )}
        {row.shipmentId && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Copy Shipment ID"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },

  storeOrderId: (row) => (
    <div className="text-muted-foreground text-sm truncate">
      {row.storeOrderId || "-"}
    </div>
  ),

  status: (row) => (
    <Badge
      variant="outline"
      className={`gap-1 px-1.5 font-medium [&_svg]:size-3 whitespace-nowrap ${getUnfulfilledStatusColors(row.status)}`}
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
    row.channelName ? (
      <ChannelIcon channelName={row.channelName} />
    ) : <span>-</span>
  ),

  itemCount: (row) => (
    <div className="text-center">{row.itemCount}</div>
  ),

  orderType: (row) => (
    <Badge variant="outline" className="px-1.5 font-medium whitespace-nowrap bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-800/20 dark:text-slate-400 dark:border-slate-700/30">
      {row.orderType}
    </Badge>
  ),

  age: (row) => {
    if (!row.orderDate) return <span>-</span>
    const age = calculateAge(row.orderDate)
    return (
      <span className={`whitespace-nowrap ${getAgeColor(age)}`}>
        {formatAge(age)}
      </span>
    )
  },

  orderDate: (row) => {
    if (!row.orderDate) return <span>-</span>
    const d = new Date(row.orderDate)
    return (
      <span className="whitespace-nowrap text-sm">
        {format(d, "MMM d, yyyy, h:mm a")}
      </span>
    )
  },

  slaDate: (row) => {
    if (!row.slaDate) return <span>-</span>
    const slaDate = new Date(row.slaDate)
    const isOverdue = slaDate < new Date()
    return (
      <span className={`whitespace-nowrap text-sm ${isOverdue ? "text-red-500 font-medium" : ""}`}>
        {format(slaDate, "MMM d, h:mm a")}
      </span>
    )
  },

  // Optional columns
  totalShipments: (row) => (
    <div className="text-center">{row.totalShipments || 1}</div>
  ),

  destCountry: (row) => (
    <div className="truncate text-sm">{row.destCountry || "-"}</div>
  ),

  shipOption: (row) => (
    <div className="truncate text-sm">{row.shipOption || "-"}</div>
  ),
}

// ============================================
// SHIPMENTS TYPES & RENDERERS
// ============================================

// Carrier display names for proper formatting and brevity
const CARRIER_DISPLAY_NAMES: Record<string, string> = {
  'Amazon Shipping': 'Amazon',
  'BetterTrucks': 'BetterTrucks',
  'DHLExpress': 'DHL Express',
  'CirroECommerce': 'Cirro',
  'DhlEcs': 'DHL Ecom',
  'FedEx': 'FedEx',
  'FedExSmartPost': 'FedEx SP',
  'OSMWorldwide': 'OSM',
  'OnTrac': 'OnTrac',
  'ShipBob': 'ShipBob',
  'UPS': 'UPS',
  'USPS': 'USPS',
  'Veho': 'Veho',
}

// Get display name for carrier (falls back to original if not mapped)
export function getCarrierDisplayName(carrier: string): string {
  if (!carrier) return '-'
  return CARRIER_DISPLAY_NAMES[carrier] || carrier
}

export interface Shipment {
  id: string | number
  orderId: string
  shipmentId: string
  status: string
  customerName: string
  orderType: string
  qty: number
  cost: number
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

    default:
      return <LoaderIcon />
  }
}

// Cell renderers for shipments table
export const shipmentCellRenderers: Record<string, CellRenderer<Shipment>> = {
  orderId: (row) => (
    <div className="font-medium text-foreground truncate">
      {row.orderId}
    </div>
  ),

  shipmentId: (row) => {
    const handleCopy = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      navigator.clipboard.writeText(row.shipmentId)
      toast.success("Shipment ID copied")
    }
    return (
      <div className="flex items-center gap-1.5">
        {row.shipmentId ? (
          <a
            href={getShipBobOrderUrl(row.shipmentId)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm truncate"
          >
            {row.shipmentId}
          </a>
        ) : (
          <span>-</span>
        )}
        {row.shipmentId && (
          <button
            onClick={handleCopy}
            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
            title="Copy Shipment ID"
          >
            <CopyIcon className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    )
  },

  status: (row) => (
    <Badge
      variant="outline"
      className={`gap-1 px-1.5 font-medium [&_svg]:size-3 whitespace-nowrap ${getShipmentStatusColors(row.status)}`}
    >
      {getShipmentStatusIcon(row.status)}
      {row.status}
    </Badge>
  ),

  customerName: (row) => (
    <div className="truncate">
      {row.customerName}
    </div>
  ),

  cost: (row) => (
    <div className="font-medium">{row.cost != null ? `$${row.cost.toFixed(2)}` : '-'}</div>
  ),

  qty: (row) => (
    <div className="text-center">{row.qty}</div>
  ),

  orderType: (row) => (
    <Badge variant="outline" className="px-1.5 font-medium whitespace-nowrap bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-800/20 dark:text-slate-400 dark:border-slate-700/30">
      {row.orderType}
    </Badge>
  ),

  transitTime: (row) => {
    // Transit time = time from carrier pickup (event_intransit) to delivery
    // If delivered: use stored transit_time_days or calculate from dates
    // If in transit: calculate live from inTransitDate → now

    // If delivered and we have stored transit time, use it
    if (row.deliveredDate && row.transitTimeDays != null) {
      return (
        <span className="whitespace-nowrap text-muted-foreground">
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
      <span className="whitespace-nowrap text-muted-foreground">
        {days.toFixed(1)}d
      </span>
    )
  },

  importDate: (row) => {
    if (!row.importDate) return <span className="text-muted-foreground">-</span>
    const date = new Date(row.importDate)
    return (
      <span className="whitespace-nowrap text-sm">
        {date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}, {date.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })}
      </span>
    )
  },

  labelCreated: (row) => {
    if (!row.labelCreated) return <span className="text-muted-foreground">-</span>
    const date = new Date(row.labelCreated)
    return (
      <span className="whitespace-nowrap text-sm">
        {date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}, {date.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })}
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
      <div className="flex items-center gap-1.5">
        {trackingUrl ? (
          <a
            href={trackingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 text-sm truncate"
          >
            {row.trackingId}
          </a>
        ) : (
          <span className="text-sm truncate">{row.trackingId}</span>
        )}
        <button
          onClick={handleCopy}
          className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors"
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
    if (!dateStr) return <span>-</span>
    const date = new Date(dateStr)
    const isDelivered = !!deliveredDate
    return (
      <span className={`whitespace-nowrap text-sm ${isDelivered ? "text-emerald-600 dark:text-emerald-400" : ""}`}>
        {date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        })}, {date.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })}
      </span>
    )
  },

  // New columns
  age: (row) => {
    if (!row.labelCreated) return <span>-</span>
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
    <div className="font-medium truncate">{getCarrierDisplayName(row.carrier)}</div>
  ),

  channelName: (row) => (
    row.channelName ? (
      <ChannelIcon channelName={row.channelName} />
    ) : <span>-</span>
  ),

  destCountry: (row) => (
    <div className="truncate text-sm">{row.destCountry || "-"}</div>
  ),

  orderDate: (row) => {
    if (!row.orderDate) return <span>-</span>
    const date = new Date(row.orderDate)
    return (
      <span className="whitespace-nowrap text-sm">
        {date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}, {date.toLocaleTimeString("en-US", {
          hour: "numeric",
          minute: "2-digit",
          hour12: true,
        })}
      </span>
    )
  },

  fcName: (row) => (
    <div className="truncate text-sm">{row.fcName || "-"}</div>
  ),

  shipOption: (row) => (
    <div className="truncate text-sm">{row.shipOption || "-"}</div>
  ),

  deliveredDate: (row) => {
    if (!row.deliveredDate) return <span>-</span>
    const date = new Date(row.deliveredDate)
    return (
      <span className="whitespace-nowrap text-sm text-emerald-600 dark:text-emerald-400">
        {date.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </span>
    )
  },

  storeOrderId: (row) => (
    <div className="text-muted-foreground text-sm truncate">
      {row.storeOrderId || "-"}
    </div>
  ),
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

// ============================================
// ADDITIONAL SERVICES TYPES & RENDERERS
// (billing_shipment_fees table)
// ============================================

export interface AdditionalService {
  id: string
  referenceId: string
  feeType: string
  amount: number
  transactionDate: string
  invoiceNumber: string
  invoiceDate: string
  status: string
}

export const additionalServicesCellRenderers: Record<string, CellRenderer<AdditionalService>> = {
  referenceId: (row) => (
    <div className="font-medium text-foreground truncate">{row.referenceId || '-'}</div>
  ),
  feeType: (row) => (
    <div className="truncate">{row.feeType || '-'}</div>
  ),
  amount: (row) => (
    <div className="font-medium">{row.amount != null ? `$${row.amount.toFixed(2)}` : '-'}</div>
  ),
  transactionDate: (row) => (
    row.transactionDate ? (
      <span className="whitespace-nowrap text-sm">{format(new Date(row.transactionDate), "MMM d, yyyy")}</span>
    ) : <span>-</span>
  ),
  status: (row) => (
    <Badge variant="outline" className={`px-1.5 font-medium whitespace-nowrap ${getBillingStatusColors(row.status)}`}>
      {formatBillingStatus(row.status)}
    </Badge>
  ),
  invoiceNumber: (row) => (
    <div className="text-muted-foreground truncate">{row.invoiceNumber || '-'}</div>
  ),
  invoiceDate: (row) => (
    row.invoiceDate ? (
      <span className="whitespace-nowrap text-sm">{format(new Date(row.invoiceDate), "MMM d, yyyy")}</span>
    ) : <span>-</span>
  ),
}

// ============================================
// RETURNS TYPES & RENDERERS
// (billing_returns table)
// ============================================

export interface Return {
  id: string
  returnId: string
  originalOrderId: string
  trackingId: string
  transactionType: string
  returnStatus: string
  returnType: string
  returnCreationDate: string
  fcName: string
  amount: number
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
  returnId: (row) => (
    <div className="font-medium text-foreground truncate">{row.returnId || '-'}</div>
  ),
  originalOrderId: (row) => (
    <div className="truncate">{row.originalOrderId || '-'}</div>
  ),
  trackingId: (row) => (
    <div className="text-muted-foreground truncate">{row.trackingId || '-'}</div>
  ),
  transactionType: (row) => (
    <div className="truncate">{row.transactionType || '-'}</div>
  ),
  returnStatus: (row) => (
    row.returnStatus ? (
      <Badge variant="outline" className={`px-1.5 font-medium whitespace-nowrap ${getReturnStatusColors(row.returnStatus)}`}>
        {row.returnStatus}
      </Badge>
    ) : <span>-</span>
  ),
  returnType: (row) => (
    <div className="truncate">{row.returnType || '-'}</div>
  ),
  returnCreationDate: (row) => (
    row.returnCreationDate ? (
      <span className="whitespace-nowrap text-sm">{format(new Date(row.returnCreationDate), "MMM d, yyyy")}</span>
    ) : <span>-</span>
  ),
  fcName: (row) => (
    <div className="truncate">{row.fcName || '-'}</div>
  ),
  amount: (row) => (
    <div className="font-medium">{row.amount != null ? `$${row.amount.toFixed(2)}` : '-'}</div>
  ),
  status: (row) => (
    <Badge variant="outline" className={`px-1.5 font-medium whitespace-nowrap ${getBillingStatusColors(row.status)}`}>
      {formatBillingStatus(row.status)}
    </Badge>
  ),
}

// ============================================
// RECEIVING TYPES & RENDERERS
// (billing_receiving table)
// ============================================

export interface Receiving {
  id: string
  referenceId: string
  feeType: string
  amount: number
  transactionType: string
  transactionDate: string
  invoiceNumber: string
  invoiceDate: string
  status: string
}

export const receivingCellRenderers: Record<string, CellRenderer<Receiving>> = {
  referenceId: (row) => (
    <div className="font-medium text-foreground truncate">{row.referenceId || '-'}</div>
  ),
  feeType: (row) => (
    <div className="truncate">{row.feeType || '-'}</div>
  ),
  amount: (row) => (
    <div className="font-medium">{row.amount != null ? `$${row.amount.toFixed(2)}` : '-'}</div>
  ),
  transactionType: (row) => (
    <div className="truncate">{row.transactionType || '-'}</div>
  ),
  transactionDate: (row) => (
    row.transactionDate ? (
      <span className="whitespace-nowrap text-sm">{format(new Date(row.transactionDate), "MMM d, yyyy")}</span>
    ) : <span>-</span>
  ),
  status: (row) => (
    <Badge variant="outline" className={`px-1.5 font-medium whitespace-nowrap ${getBillingStatusColors(row.status)}`}>
      {formatBillingStatus(row.status)}
    </Badge>
  ),
  invoiceNumber: (row) => (
    <div className="text-muted-foreground truncate">{row.invoiceNumber || '-'}</div>
  ),
  invoiceDate: (row) => (
    row.invoiceDate ? (
      <span className="whitespace-nowrap text-sm">{format(new Date(row.invoiceDate), "MMM d, yyyy")}</span>
    ) : <span>-</span>
  ),
}

// ============================================
// STORAGE TYPES & RENDERERS
// (billing_storage table)
// ============================================

export interface Storage {
  id: string
  inventoryId: string
  chargeStartDate: string
  fcName: string
  locationType: string
  quantity: number
  ratePerMonth: number
  amount: number
  invoiceNumber: string
  invoiceDate: string
  status: string
  comment: string
}

export const storageCellRenderers: Record<string, CellRenderer<Storage>> = {
  inventoryId: (row) => (
    <div className="font-medium text-foreground truncate">{row.inventoryId || '-'}</div>
  ),
  fcName: (row) => (
    <div className="truncate">{row.fcName || '-'}</div>
  ),
  locationType: (row) => (
    <div className="truncate">{row.locationType || '-'}</div>
  ),
  chargeStartDate: (row) => (
    row.chargeStartDate ? (
      <span className="whitespace-nowrap text-sm">{format(new Date(row.chargeStartDate), "MMM d, yyyy")}</span>
    ) : <span>-</span>
  ),
  amount: (row) => (
    <div className="font-medium">{row.amount != null ? `$${row.amount.toFixed(2)}` : '-'}</div>
  ),
  status: (row) => (
    <Badge variant="outline" className={`px-1.5 font-medium whitespace-nowrap ${getBillingStatusColors(row.status)}`}>
      {formatBillingStatus(row.status)}
    </Badge>
  ),
  invoiceNumber: (row) => (
    <div className="text-muted-foreground truncate">{row.invoiceNumber || '-'}</div>
  ),
  invoiceDate: (row) => (
    row.invoiceDate ? (
      <span className="whitespace-nowrap text-sm">{format(new Date(row.invoiceDate), "MMM d, yyyy")}</span>
    ) : <span>-</span>
  ),
  comment: (row) => (
    <div className="truncate text-muted-foreground">{row.comment || '-'}</div>
  ),
}

// ============================================
// CREDITS TYPES & RENDERERS
// (billing_credits table)
// ============================================

export interface Credit {
  id: string
  referenceId: string
  transactionDate: string
  creditInvoiceNumber: string
  invoiceDate: string
  creditReason: string
  creditAmount: number
  status: string
}

export const creditsCellRenderers: Record<string, CellRenderer<Credit>> = {
  referenceId: (row) => (
    <div className="font-medium text-foreground truncate">{row.referenceId || '-'}</div>
  ),
  creditReason: (row) => (
    <div className="truncate">{row.creditReason || '-'}</div>
  ),
  creditAmount: (row) => (
    <div className="font-medium text-emerald-600 dark:text-emerald-400">
      {row.creditAmount != null ? `$${row.creditAmount.toFixed(2)}` : '-'}
    </div>
  ),
  transactionDate: (row) => (
    row.transactionDate ? (
      <span className="whitespace-nowrap text-sm">{format(new Date(row.transactionDate), "MMM d, yyyy")}</span>
    ) : <span>-</span>
  ),
  status: (row) => (
    <Badge variant="outline" className={`px-1.5 font-medium whitespace-nowrap ${getBillingStatusColors(row.status)}`}>
      {formatBillingStatus(row.status)}
    </Badge>
  ),
  creditInvoiceNumber: (row) => (
    <div className="text-muted-foreground truncate">{row.creditInvoiceNumber || '-'}</div>
  ),
  invoiceDate: (row) => (
    row.invoiceDate ? (
      <span className="whitespace-nowrap text-sm">{format(new Date(row.invoiceDate), "MMM d, yyyy")}</span>
    ) : <span>-</span>
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
  cost: number
}

// Use same status colors as shipments for consistency
function getShippedStatusColors(status: string) {
  return getShipmentStatusColors(status)
}

/**
 * Get carrier tracking URL for a given tracking ID
 * Supports all carriers in our database with verified tracking URLs
 */
function getTrackingUrl(carrier: string, trackingId: string): string | null {
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

  // OSM Worldwide - Parcel consolidator, use their official tracking
  if (carrierLower.includes('osm')) {
    return `https://www.osmworldwide.com/tracking/?TrackingNumbers=${trackingId}`
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
  orderId: (row) => (
    <div className="font-medium text-foreground truncate">{row.orderId}</div>
  ),
  storeOrderId: (row) => (
    <div className="text-muted-foreground text-sm truncate">{row.storeOrderId || "-"}</div>
  ),
  customerName: (row) => (
    <div className="truncate">{row.customerName}</div>
  ),
  status: (row) => (
    <Badge variant="outline" className={`gap-1 px-1.5 font-medium [&_svg]:size-3 whitespace-nowrap ${getShippedStatusColors(row.status)}`}>
      {getShipmentStatusIcon(row.status)}
      {row.status}
    </Badge>
  ),
  carrier: (row) => (
    <div>
      <div className="font-medium truncate">{getCarrierDisplayName(row.carrier)}</div>
      {row.carrierService && (
        <div className="text-xs text-muted-foreground truncate">{row.carrierService}</div>
      )}
    </div>
  ),
  trackingId: (row) => {
    const trackingUrl = getTrackingUrl(row.carrier, row.trackingId)
    if (!row.trackingId) return <span>-</span>
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
      <span className="whitespace-nowrap text-sm">{format(new Date(row.shippedDate), "MMM d, yyyy")}</span>
    ) : <span>-</span>
  ),
  deliveredDate: (row) => (
    row.deliveredDate ? (
      <span className="whitespace-nowrap text-sm text-emerald-600 dark:text-emerald-400">{format(new Date(row.deliveredDate), "MMM d, yyyy")}</span>
    ) : <span>-</span>
  ),
  itemCount: (row) => (
    <div className="text-center">{row.itemCount}</div>
  ),
  cost: (row) => (
    row.cost ? <div className="font-medium">${row.cost.toFixed(2)}</div> : <span>-</span>
  ),
}
