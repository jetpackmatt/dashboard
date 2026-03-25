"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  CopyIcon,
  RefreshCwIcon,
  ExternalLinkIcon,
} from "lucide-react"
import { toast } from "sonner"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ClientBadge } from "@/components/transactions/client-badge"
import { getTrackingUrl, getCarrierDisplayName } from "@/components/transactions/cell-renderers"
import { ShipmentDetailsDrawer } from "@/components/shipment-details-drawer"
import { TrackingTimelineDrawer } from "./tracking-timeline-drawer"
import { TrackingLink } from "@/components/tracking-link"
import { useUserSettings } from "@/hooks/use-user-settings"
import { useTablePreferences } from "@/hooks/use-table-preferences"
import type { MonitoredShipment } from "@/app/dashboard/deliveryiq/page"
import type { QuickFilterValue } from "./quick-filters"

interface DeliveryIQTableProps {
  data: MonitoredShipment[]
  isLoading: boolean
  error: string | null
  showClientColumn: boolean
  activeFilter: QuickFilterValue
  onRefresh: () => void
  onFileClaim: (shipment: MonitoredShipment) => void
  filingClaimId: string | null // shipmentId currently being filed
}

// Format date for display
function formatDate(dateStr: string | null): React.ReactNode {
  if (!dateStr) return <span className="text-muted-foreground">-</span>
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return <span className="text-muted-foreground">-</span>
  }
}

// Days silent color coding
function getDaysSilentColor(days: number | null): string {
  if (days === null) return 'text-muted-foreground'
  if (days <= 3) return 'text-green-600 bg-green-50'
  if (days <= 7) return 'text-yellow-600 bg-yellow-50'
  if (days <= 14) return 'text-amber-600 bg-amber-50'
  if (days <= 19) return 'text-orange-600 bg-orange-50'
  return 'text-red-600 bg-red-50'
}

// Watch reason badge styling
function getWatchReasonStyle(reason: string | null): { color: string; label: string } {
  switch (reason) {
    case 'SLOW': return { color: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Slow' }
    case 'STALLED': return { color: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Stalled' }
    case 'CUSTOMS': return { color: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Customs' }
    case 'PICKUP': return { color: 'bg-teal-100 text-teal-700 border-teal-200', label: 'Pickup' }
    case 'DELIVERY ISSUE': return { color: 'bg-rose-100 text-rose-700 border-rose-200', label: 'Delivery Issue' }
    case 'NEEDS ACTION': return { color: 'bg-orange-100 text-orange-700 border-orange-200', label: 'Needs Action' }
    case 'STUCK': return { color: 'bg-red-100 text-red-700 border-red-200', label: 'Stuck' }
    case 'NO SCANS': return { color: 'bg-red-100 text-red-700 border-red-200', label: 'No Scans' }
    case 'RETURNING': return { color: 'bg-purple-100 text-purple-700 border-purple-200', label: 'Returning' }
    default: return { color: 'bg-gray-100 text-gray-500 border-gray-200', label: '-' }
  }
}

// Determine the specific action needed from tracking description and AI assessment
function getActionNeeded(shipment: MonitoredShipment): { color: string; label: string } {
  const scanDesc = (shipment.lastScanDescription || '').toLowerCase()
  const merchantAction = (shipment.aiAssessment?.merchantAction || '').toLowerCase()
  const combined = `${scanDesc} ${merchantAction}`

  // Address issues
  if (/address.*(correct|invalid|incorrect|insufficient|wrong|update|incomplete)|incorrect.*address|bad.*address|undeliverable.*address/i.test(combined)) {
    return { color: 'bg-orange-100 text-orange-700 border-orange-200', label: 'Fix Address' }
  }
  // Customs duties / payment
  if (/dut(y|ies).*required|payment.*required|customs.*payment|pay.*dut/i.test(combined)) {
    return { color: 'bg-amber-100 text-amber-700 border-amber-200', label: 'Pay Duties' }
  }
  // Documentation needed
  if (/document.*(required|needed|missing)|additional.*doc|provide.*doc|customs.*doc/i.test(combined)) {
    return { color: 'bg-blue-100 text-blue-700 border-blue-200', label: 'Provide Docs' }
  }
  // Reschedule delivery
  if (/reschedule|redelivery|schedule.*delivery|delivery.*attempt|failed.*deliver|business.*closed|no.*access/i.test(combined)) {
    return { color: 'bg-rose-100 text-rose-700 border-rose-200', label: 'Reschedule Delivery' }
  }
  // Hold for instructions / carrier needs input
  if (/hold.*instruction|instruction.*requested|contact.*carrier|carrier.*instruction|awaiting.*instruction/i.test(combined)) {
    return { color: 'bg-purple-100 text-purple-700 border-purple-200', label: 'Contact Carrier' }
  }
  // Contact customer
  if (/contact.*customer|customer.*contact|recipient.*unavailable|refused/i.test(combined)) {
    return { color: 'bg-teal-100 text-teal-700 border-teal-200', label: 'Contact Customer' }
  }
  // Restricted / access issue
  if (/restricted|security|gated|no.*safe.*place/i.test(combined)) {
    return { color: 'bg-slate-100 text-slate-600 border-slate-200', label: 'Access Issue' }
  }
  // Fallback — generic action needed
  return { color: 'bg-orange-100 text-orange-700 border-orange-200', label: 'Review Required' }
}

// Claim status badge colors - supports both claim eligibility status and care ticket status
function getStatusColor(claimStatus: string | null, careTicketStatus: string | null): string {
  // For filed claims, use the care ticket status for coloring
  if (claimStatus === 'claim_filed' && careTicketStatus) {
    switch (careTicketStatus) {
      case 'Under Review': return 'bg-blue-100 text-blue-700 border-blue-200'
      case 'Credit Requested': return 'bg-purple-100 text-purple-700 border-purple-200'
      case 'Credit Approved': return 'bg-green-100 text-green-700 border-green-200'
      case 'Credit Denied': return 'bg-gray-100 text-gray-700 border-gray-200'
      case 'Resolved': return 'bg-emerald-100 text-emerald-700 border-emerald-200'
      default: return 'bg-blue-100 text-blue-700 border-blue-200'
    }
  }

  // For non-filed statuses, use the claim eligibility status
  switch (claimStatus) {
    case 'at_risk': return 'bg-amber-100 text-amber-700 border-amber-200'
    case 'eligible': return 'bg-red-100 text-red-700 border-red-200'
    case 'claim_filed': return 'bg-blue-100 text-blue-700 border-blue-200'
    case 'approved': return 'bg-green-100 text-green-700 border-green-200'
    case 'denied': return 'bg-gray-100 text-gray-700 border-gray-200'
    case 'missed_window': return 'bg-slate-100 text-slate-600 border-slate-200'
    default: return 'bg-gray-100 text-gray-500 border-gray-200'
  }
}

// Get display label for status - shows actual care ticket status for filed claims
function getStatusLabel(claimStatus: string | null, careTicketStatus: string | null): string {
  // For filed claims, show the care ticket status
  if (claimStatus === 'claim_filed' && careTicketStatus) {
    // Map "Resolved" to "Credit Applied" for display
    if (careTicketStatus === 'Resolved') {
      return 'Credit Applied'
    }
    return careTicketStatus
  }

  // For approved/denied from lost_in_transit_checks (archived items)
  switch (claimStatus) {
    case 'at_risk': return 'On Watch'
    case 'eligible': return 'Ready to File'
    case 'claim_filed': return 'Under Review' // Fallback if no care ticket status
    case 'approved': return 'Credit Approved'
    case 'denied': return 'Credit Denied'
    case 'missed_window': return 'Missed Window'
    default: return 'Unknown'
  }
}

export function DeliveryIQTable({
  data,
  isLoading,
  error,
  showClientColumn,
  activeFilter,
  onRefresh,
  onFileClaim,
  filingClaimId,
}: DeliveryIQTableProps) {
  // Show status column on 'all', 'archived', and 'claim_filed' tabs
  // For claim_filed, shows the actual care ticket status (Under Review, Credit Requested, etc.)
  const showStatusColumn = activeFilter === 'all' || activeFilter === 'archived' || activeFilter === 'claim_filed'
  // Needs Action tab swaps "Silent / Reason" for "Action Needed"
  const isNeedsActionTab = activeFilter === 'needs_action'

  // Global default page size
  const { settings: userSettings } = useUserSettings()
  const deliveryiqPrefs = useTablePreferences('deliveryiq', userSettings.defaultPageSize)

  // Pagination state
  const [page, setPage] = React.useState(0)
  const pageSize = deliveryiqPrefs.pageSize
  const setPageSize = deliveryiqPrefs.setPageSize

  // Sorting state
  const [sortField, setSortField] = React.useState<string>('daysSilent')
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('desc')

  // Selected shipment for drawer
  const [selectedShipmentId, setSelectedShipmentId] = React.useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  // Tracking timeline drawer state
  const [selectedTracking, setSelectedTracking] = React.useState<{ number: string; carrier: string } | null>(null)
  const [timelineDrawerOpen, setTimelineDrawerOpen] = React.useState(false)

  // Reset page when data changes
  React.useEffect(() => {
    setPage(0)
  }, [data.length])

  // Sort data
  const sortedData = React.useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      let aVal: any = a[sortField as keyof MonitoredShipment]
      let bVal: any = b[sortField as keyof MonitoredShipment]

      // Handle null values — push nulls to end regardless of direction
      if (aVal === null && bVal === null) return 0
      if (aVal === null) return 1
      if (bVal === null) return -1

      if (typeof aVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal)
      }

      return sortDirection === 'asc' ? aVal - bVal : bVal - aVal
    })
    return sorted
  }, [data, sortField, sortDirection])

  // Paginate data
  const paginatedData = React.useMemo(() => {
    const start = page * pageSize
    return sortedData.slice(start, start + pageSize)
  }, [sortedData, page, pageSize])

  // Handle sort
  const handleSort = (field: string) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
  }

  // Handle row click - opens tracking timeline drawer
  const handleRowClick = (trackingNumber: string, carrier: string) => {
    setSelectedTracking({ number: trackingNumber, carrier })
    setTimelineDrawerOpen(true)
  }

  // Handle shipment ID click - opens shipment details drawer
  const handleShipmentIdClick = (shipmentId: string) => {
    setSelectedShipmentId(shipmentId)
    setDrawerOpen(true)
  }

  // Handle tracking number click - opens timeline drawer (same as row click)
  const handleTrackingClick = (trackingNumber: string, carrier: string) => {
    setSelectedTracking({ number: trackingNumber, carrier })
    setTimelineDrawerOpen(true)
  }

  // Render sort indicator
  const SortIndicator = ({ field }: { field: string }) => {
    if (sortField === field) {
      return sortDirection === 'asc'
        ? <ChevronUpIcon className="h-3 w-3 flex-shrink-0 text-foreground" />
        : <ChevronDownIcon className="h-3 w-3 flex-shrink-0 text-foreground" />
    }
    return <ChevronDownIcon className="h-3 w-3 flex-shrink-0 opacity-0 group-hover/th:opacity-40 transition-opacity" />
  }

  // Calculate pagination
  const totalPages = Math.ceil(sortedData.length / pageSize)
  const canPrevPage = page > 0
  const canNextPage = page < totalPages - 1

  // Total column count for colSpan (must be before early returns — hooks can't be conditional)
  // Columns: [client?] shipmentId tracking customer shipDate lastScan silent+reason carrier [status?] actions
  const totalColSpan = (showClientColumn ? 1 : 0) + 8 + (showStatusColumn ? 1 : 0)

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
        <p className="text-sm mb-4">Failed to load data: {error}</p>
        <Button variant="outline" size="sm" onClick={onRefresh}>
          <RefreshCwIcon className="h-4 w-4 mr-2" />
          Try Again
        </Button>
      </div>
    )
  }

  // Common header cell styles matching TransactionsTable
  const headerCellBase = "group/th text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors"
  const headerCellClass = cn(headerCellBase, "px-2")

  return (
    <div className="flex flex-col">
      {/* Table */}
      <div>
        <table className="w-full text-[13px] font-roboto" style={{ tableLayout: 'auto' }}>
          {/* Equal-width column hints — all columns get the same proportion */}
          {(() => {
            const colCount = (showClientColumn ? 1 : 0) + 8 + (showStatusColumn ? 1 : 0)
            const pct = `${(100 / colCount).toFixed(1)}%`
            return (
              <colgroup>
                {showClientColumn && <col style={{ width: pct }} />}
                <col style={{ width: pct }} />{/* Shipment ID */}
                <col style={{ width: pct }} />{/* Tracking # */}
                <col style={{ width: pct }} />{/* Customer */}
                <col style={{ width: pct }} />{/* Ship Date */}
                <col style={{ width: pct }} />{/* Last Scan */}
                <col style={{ width: pct }} />{/* Silent + Reason (shared) */}
                <col style={{ width: pct }} />{/* Carrier */}
                {showStatusColumn && <col style={{ width: pct }} />}{/* Status */}
                <col style={{ width: pct }} />{/* Actions */}
              </colgroup>
            )
          })()}
          <thead className="sticky top-[71px] bg-zinc-100 dark:bg-zinc-800 z-10">
            <tr className="h-[45px]">
              {showClientColumn && (
                <th className="pl-[26px] lg:pl-[34px] pr-1 align-middle"></th>
              )}
              <th
                className={cn(headerCellBase, showClientColumn ? "px-2" : "pl-[26px] lg:pl-[34px] pr-2")}
                onClick={() => handleSort('shipmentId')}
              >
                <div className="flex items-center gap-1">
                  Shipment ID
                  <SortIndicator field="shipmentId" />
                </div>
              </th>
              <th
                className={headerCellClass}
                onClick={() => handleSort('trackingNumber')}
              >
                <div className="flex items-center gap-1">
                  Tracking #
                  <SortIndicator field="trackingNumber" />
                </div>
              </th>
              <th
                className={headerCellClass}
                onClick={() => handleSort('customerName')}
              >
                <div className="flex items-center gap-1">
                  Customer
                  <SortIndicator field="customerName" />
                </div>
              </th>
              <th
                className={headerCellClass}
                onClick={() => handleSort('shipDate')}
              >
                <div className="flex items-center gap-1">
                  Ship Date
                  <SortIndicator field="shipDate" />
                </div>
              </th>
              <th
                className={headerCellClass}
                onClick={() => handleSort('lastScanDate')}
              >
                <div className="flex items-center gap-1">
                  Last Scan
                  <SortIndicator field="lastScanDate" />
                </div>
              </th>
              <th
                className={headerCellClass}
              >
                {isNeedsActionTab ? (
                  <div className="flex items-center gap-1">
                    Action Needed
                  </div>
                ) : (
                  <div className="flex items-center">
                    <span className="flex items-center gap-1 cursor-pointer" onClick={() => handleSort('daysSilent')}>
                      Silent
                      <SortIndicator field="daysSilent" />
                    </span>
                    <span className="text-zinc-300 dark:text-zinc-600 mx-[5px]">/</span>
                    <span className="flex items-center gap-1 cursor-pointer" onClick={() => handleSort('watchReason')}>
                      Reason
                      <SortIndicator field="watchReason" />
                    </span>
                  </div>
                )}
              </th>
              <th
                className={headerCellClass}
                onClick={() => handleSort('carrier')}
              >
                <div className="flex items-center gap-1">
                  Carrier
                  <SortIndicator field="carrier" />
                </div>
              </th>
              {showStatusColumn && (
                <th
                  className={headerCellClass}
                  onClick={() => handleSort('claimEligibilityStatus')}
                >
                  <div className="flex items-center gap-1">
                    Status
                    <SortIndicator field="claimEligibilityStatus" />
                  </div>
                </th>
              )}
              <th className={cn(headerCellBase, "pl-2 pr-[26px] lg:pr-[34px]")}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              null
            ) : paginatedData.length === 0 ? (
              <tr>
                <td colSpan={totalColSpan} className="h-24 text-center text-muted-foreground">
                  No monitored shipments found
                </td>
              </tr>
            ) : (
              paginatedData.map((shipment) => {
                const trackingUrl = getTrackingUrl(shipment.trackingNumber, shipment.carrier)

                return (
                  <tr
                    key={shipment.id}
                    className="h-[45px] border-b border-border/50 dark:bg-[hsl(220,8%,8%)] dark:hover:bg-[hsl(220,8%,10%)] hover:bg-muted/30 cursor-pointer"
                    onClick={() => handleRowClick(shipment.trackingNumber, shipment.carrier)}
                  >
                    {showClientColumn && (
                      <td className="pl-[26px] lg:pl-[34px] pr-1 align-middle overflow-hidden">
                        <ClientBadge clientId={shipment.clientId} />
                      </td>
                    )}
                    <td className={cn("align-middle overflow-hidden whitespace-nowrap", showClientColumn ? "px-2" : "pl-[26px] lg:pl-[34px] pr-2")} onClick={(e) => e.stopPropagation()}>
                      <div className="group/cell flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleShipmentIdClick(shipment.shipmentId)
                          }}
                          className="font-mono truncate text-indigo-600 hover:text-indigo-800 hover:underline underline-offset-2 transition-colors"
                          title="View shipment details"
                        >
                          {shipment.shipmentId}
                        </button>
                        {shipment.shipmentId && (
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              navigator.clipboard.writeText(shipment.shipmentId)
                              toast.success("Shipment ID copied")
                            }}
                            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
                            title="Copy Shipment ID"
                          >
                            <CopyIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-2 align-middle overflow-hidden" onClick={(e) => e.stopPropagation()}>
                      <div className="group/cell flex items-center gap-1.5">
                        <div className="truncate min-w-0 font-mono" title={shipment.trackingNumber}>
                          <TrackingLink
                            trackingNumber={shipment.trackingNumber}
                            carrier={shipment.carrier}
                            className="text-indigo-600 hover:text-indigo-800 hover:underline underline-offset-2 transition-colors"
                          >
                            {shipment.trackingNumber}
                          </TrackingLink>
                        </div>
                        {shipment.trackingNumber && (
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              navigator.clipboard.writeText(shipment.trackingNumber)
                              toast.success("Tracking # copied")
                            }}
                            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
                            title="Copy Tracking #"
                          >
                            <CopyIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
                        {trackingUrl && (
                          <a
                            href={trackingUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                          >
                            <ExternalLinkIcon className="h-3.5 w-3.5" />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-2 align-middle overflow-hidden whitespace-nowrap text-ellipsis">
                      <div className="truncate" style={{ maxWidth: 'clamp(60px, 8vw, 180px)' }} title={shipment.customerName || ''}>
                        {shipment.customerName || <span className="text-muted-foreground">-</span>}
                      </div>
                    </td>
                    <td className="px-2 align-middle text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                      {formatDate(shipment.shipDate)}
                    </td>
                    <td className="px-2 align-middle text-muted-foreground whitespace-nowrap overflow-hidden text-ellipsis">
                      {formatDate(shipment.lastScanDate)}
                    </td>
                    <td className="px-2 align-middle whitespace-nowrap overflow-hidden">
                      {isNeedsActionTab ? (
                        <div className="inline-flex items-center gap-2">
                          {(() => {
                            const action = getActionNeeded(shipment)
                            return (
                              <Badge variant="outline" className={cn("text-[11px]", action.color)}>
                                {action.label}
                              </Badge>
                            )
                          })()}
                        </div>
                      ) : (
                        <div className="inline-flex items-center gap-[30px]">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[11px] font-mono",
                              getDaysSilentColor(shipment.daysSilent)
                            )}
                          >
                            {shipment.daysSilent ?? '-'}
                          </Badge>
                          {shipment.watchReason ? (() => {
                            const style = getWatchReasonStyle(shipment.watchReason)
                            return (
                              <Badge variant="outline" className={cn("text-[11px]", style.color)}>
                                {style.label}
                              </Badge>
                            )
                          })() : null}
                        </div>
                      )}
                    </td>
                    <td className="px-2 align-middle whitespace-nowrap overflow-hidden text-ellipsis">
                      {getCarrierDisplayName(shipment.carrier || '')}
                    </td>
                    {showStatusColumn && (
                      <td className="px-2 align-middle whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <Badge
                          variant="outline"
                          className={cn("text-[11px]", getStatusColor(shipment.claimEligibilityStatus, shipment.careTicketStatus))}
                        >
                          {getStatusLabel(shipment.claimEligibilityStatus, shipment.careTicketStatus)}
                        </Badge>
                      </td>
                    )}
                    <td className="px-2 pr-[26px] lg:pr-[34px] align-middle whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <TrackingLink
                          trackingNumber={shipment.trackingNumber}
                          carrier={shipment.carrier}
                          className="px-2 py-0.5 rounded text-[11px] font-medium text-blue-600 hover:bg-blue-100 hover:text-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/50 dark:hover:text-blue-300 transition-colors"
                        >
                          Track
                        </TrackingLink>
                        {shipment.claimEligibilityStatus === 'eligible' && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              onFileClaim(shipment)
                            }}
                            disabled={filingClaimId === shipment.shipmentId}
                            className={cn(
                              "px-2 py-0.5 rounded text-[11px] font-medium transition-colors",
                              filingClaimId === shipment.shipmentId
                                ? "text-muted-foreground cursor-wait"
                                : "text-orange-600 hover:bg-orange-100 hover:text-orange-800 dark:text-orange-400 dark:hover:bg-orange-900/50 dark:hover:text-orange-300"
                            )}
                          >
                            {filingClaimId === shipment.shipmentId ? 'Filing...' : 'Claim'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
        {/* Pagination */}
        {!isLoading && sortedData.length > 0 && (
          <div className="bg-background py-3 px-6 lg:px-8 flex items-center justify-between border-t border-border/40">
            <div className="text-sm text-muted-foreground">
              {paginatedData.length.toLocaleString()} of {sortedData.length.toLocaleString()} shipments
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(0)}
                disabled={!canPrevPage}
              >
                <ChevronsLeftIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p - 1)}
                disabled={!canPrevPage}
              >
                <ChevronLeftIcon className="h-4 w-4" />
              </Button>
              <span className="text-sm px-2">
                Page {page + 1} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(p => p + 1)}
                disabled={!canNextPage}
              >
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage(totalPages - 1)}
                disabled={!canNextPage}
              >
                <ChevronsRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Shipment Details Drawer */}
      <ShipmentDetailsDrawer
        shipmentId={selectedShipmentId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />

      {/* Tracking Timeline Drawer */}
      <TrackingTimelineDrawer
        trackingNumber={selectedTracking?.number || null}
        carrier={selectedTracking?.carrier || null}
        open={timelineDrawerOpen}
        onOpenChange={setTimelineDrawerOpen}
      />
    </div>
  )
}
