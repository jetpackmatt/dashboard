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
  Loader2Icon,
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
import type { MonitoredShipment } from "@/app/dashboard/lookout/page"
import type { QuickFilterValue } from "./quick-filters"

interface LookoutTableProps {
  data: MonitoredShipment[]
  isLoading: boolean
  error: string | null
  showClientColumn: boolean
  activeFilter: QuickFilterValue
  onRefresh: () => void
}

// Format date for display
function formatDate(dateStr: string | null): string {
  if (!dateStr) return '-'
  try {
    const date = new Date(dateStr)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  } catch {
    return '-'
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
    case 'at_risk': return 'At Risk'
    case 'eligible': return 'Ready to File'
    case 'claim_filed': return 'Under Review' // Fallback if no care ticket status
    case 'approved': return 'Credit Approved'
    case 'denied': return 'Credit Denied'
    case 'missed_window': return 'Missed Window'
    default: return '-'
  }
}

export function LookoutTable({
  data,
  isLoading,
  error,
  showClientColumn,
  activeFilter,
  onRefresh,
}: LookoutTableProps) {
  // Show status column on 'all', 'archived', and 'claim_filed' tabs
  // For claim_filed, shows the actual care ticket status (Under Review, Credit Requested, etc.)
  const showStatusColumn = activeFilter === 'all' || activeFilter === 'archived' || activeFilter === 'claim_filed'

  // Pagination state
  const [page, setPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)

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

      // Handle null values
      if (aVal === null) aVal = sortDirection === 'asc' ? Infinity : -Infinity
      if (bVal === null) bVal = sortDirection === 'asc' ? Infinity : -Infinity

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
    if (sortField !== field) return null
    return sortDirection === 'asc'
      ? <ChevronUpIcon className="h-4 w-4" />
      : <ChevronDownIcon className="h-4 w-4" />
  }

  // Calculate pagination
  const totalPages = Math.ceil(sortedData.length / pageSize)
  const canPrevPage = page > 0
  const canNextPage = page < totalPages - 1

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
  const headerCellClass = "px-2 text-left align-middle text-xs font-medium text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer"

  return (
    <div className="flex flex-col h-full">
      {/* Table */}
      <div className="flex-1 overflow-y-auto min-h-0">
        <table style={{ tableLayout: 'fixed', width: '100%' }} className="text-sm">
          {/* Column widths depend on showClientColumn and showStatusColumn */}
          {showClientColumn && showStatusColumn && (
            <colgroup><col style={{ width: '6%' }} /><col style={{ width: '11%' }} /><col style={{ width: '14%' }} /><col style={{ width: '11%' }} /><col style={{ width: '10%' }} /><col style={{ width: '7%' }} /><col style={{ width: '10%' }} /><col style={{ width: '11%' }} /><col style={{ width: '20%' }} /></colgroup>
          )}
          {showClientColumn && !showStatusColumn && (
            <colgroup><col style={{ width: '6%' }} /><col style={{ width: '12%' }} /><col style={{ width: '16%' }} /><col style={{ width: '12%' }} /><col style={{ width: '11%' }} /><col style={{ width: '8%' }} /><col style={{ width: '12%' }} /><col style={{ width: '23%' }} /></colgroup>
          )}
          {!showClientColumn && showStatusColumn && (
            <colgroup><col style={{ width: '12%' }} /><col style={{ width: '15%' }} /><col style={{ width: '12%' }} /><col style={{ width: '11%' }} /><col style={{ width: '7%' }} /><col style={{ width: '11%' }} /><col style={{ width: '12%' }} /><col style={{ width: '20%' }} /></colgroup>
          )}
          {!showClientColumn && !showStatusColumn && (
            <colgroup><col style={{ width: '14%' }} /><col style={{ width: '17%' }} /><col style={{ width: '13%' }} /><col style={{ width: '12%' }} /><col style={{ width: '8%' }} /><col style={{ width: '13%' }} /><col style={{ width: '23%' }} /></colgroup>
          )}
          <thead className="sticky top-0 bg-[#fcfcfc] dark:bg-zinc-900 z-10">
            <tr className="h-11">
              {/* Client badge prefix column - no header, fixed width, only shown for admins viewing all */}
              {showClientColumn && (
                <th className="pl-4 lg:pl-6 pr-2 align-middle"></th>
              )}
              <th
                className={cn(headerCellClass, !showClientColumn && "pl-4 lg:pl-6")}
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
                onClick={() => handleSort('daysSilent')}
              >
                <div className="flex items-center gap-1">
                  Silent
                  <SortIndicator field="daysSilent" />
                </div>
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
              <th
                className={cn(headerCellClass, "pr-4 lg:pr-6")}
              >
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              // Loading skeleton rows matching TransactionsTable
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={`loading-${i}`} className="h-12 dark:bg-[hsl(220,8%,8%)]">
                  {showClientColumn && <td className="pl-4 lg:pl-6 pr-2 align-middle"><div className="h-5 w-6 animate-pulse bg-muted/40 rounded" /></td>}
                  <td className={cn("px-2", !showClientColumn && "pl-4 lg:pl-6")}><div className="h-4 w-full animate-pulse bg-muted/40 rounded" /></td>
                  <td className="px-2"><div className="h-4 w-full animate-pulse bg-muted/40 rounded" /></td>
                  <td className="px-2"><div className="h-4 w-full animate-pulse bg-muted/40 rounded" /></td>
                  <td className="px-2"><div className="h-4 w-full animate-pulse bg-muted/40 rounded" /></td>
                  <td className="px-2"><div className="h-4 w-full animate-pulse bg-muted/40 rounded" /></td>
                  <td className="px-2"><div className="h-4 w-full animate-pulse bg-muted/40 rounded" /></td>
                  {showStatusColumn && <td className="px-2"><div className="h-4 w-full animate-pulse bg-muted/40 rounded" /></td>}
                  <td className="px-2 pr-4 lg:pr-6"><div className="h-4 w-full animate-pulse bg-muted/40 rounded" /></td>
                </tr>
              ))
            ) : paginatedData.length === 0 ? (
              <tr>
                <td colSpan={(showClientColumn ? 1 : 0) + 6 + (showStatusColumn ? 1 : 0) + 1} className="h-24 text-center text-muted-foreground">
                  No monitored shipments found
                </td>
              </tr>
            ) : (
              paginatedData.map((shipment) => {
                const trackingUrl = getTrackingUrl(shipment.trackingNumber, shipment.carrier)

                return (
                  <tr
                    key={shipment.id}
                    className="h-12 border-b border-border/50 dark:bg-[hsl(220,8%,8%)] dark:hover:bg-[hsl(220,8%,10%)] hover:bg-muted/30 cursor-pointer"
                    onClick={() => handleRowClick(shipment.trackingNumber, shipment.carrier)}
                  >
                    {/* Client badge prefix - first column, no click propagation needed */}
                    {showClientColumn && (
                      <td className="pl-4 lg:pl-6 pr-2 align-middle">
                        <ClientBadge clientId={shipment.clientId} />
                      </td>
                    )}
                    <td className={cn("px-2 align-middle overflow-hidden whitespace-nowrap", !showClientColumn && "pl-4 lg:pl-6")} onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleShipmentIdClick(shipment.shipmentId)
                          }}
                          className="font-mono text-xs truncate text-indigo-600 hover:text-indigo-800 hover:underline underline-offset-2 transition-colors"
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
                            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                            title="Copy Shipment ID"
                          >
                            <CopyIcon className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="pl-2 pr-4 align-middle overflow-hidden whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1.5">
                        <button
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleTrackingClick(shipment.trackingNumber, shipment.carrier)
                          }}
                          className="font-mono text-xs truncate text-indigo-600 hover:text-indigo-800 hover:underline underline-offset-2 transition-colors"
                          title="View tracking timeline"
                        >
                          {shipment.trackingNumber}
                        </button>
                        {shipment.trackingNumber && (
                          <button
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              navigator.clipboard.writeText(shipment.trackingNumber)
                              toast.success("Tracking # copied")
                            }}
                            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
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
                    <td className="px-2 align-middle text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                      {formatDate(shipment.shipDate)}
                    </td>
                    <td className="px-2 align-middle text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap">
                      {formatDate(shipment.lastScanDate)}
                    </td>
                    <td className="px-2 align-middle">
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-mono",
                          getDaysSilentColor(shipment.daysSilent)
                        )}
                      >
                        {shipment.daysSilent ?? '-'}
                      </Badge>
                    </td>
                    <td className="px-2 align-middle overflow-hidden text-ellipsis whitespace-nowrap">
                      {getCarrierDisplayName(shipment.carrier || '')}
                    </td>
                    {showStatusColumn && (
                      <td className="px-2 align-middle" onClick={(e) => e.stopPropagation()}>
                        <Badge
                          variant="outline"
                          className={cn("text-xs", getStatusColor(shipment.claimEligibilityStatus, shipment.careTicketStatus))}
                        >
                          {getStatusLabel(shipment.claimEligibilityStatus, shipment.careTicketStatus)}
                        </Badge>
                      </td>
                    )}
                    <td className="px-2 pr-4 lg:pr-6 align-middle" onClick={(e) => e.stopPropagation()}>
                      {(() => {
                        const showFileClaim = shipment.claimEligibilityStatus === 'eligible'
                        // Use daysSilent (which we display) as fallback for daysInTransit
                        const transitDays = shipment.daysInTransit ?? shipment.daysSilent ?? 0
                        const showTrackingCheck = transitDays >= 8
                        const bothButtons = showFileClaim && showTrackingCheck

                        if (!showFileClaim && !showTrackingCheck) return null

                        return (
                          <div className="inline-flex items-center">
                            {showFileClaim && (
                              <Button
                                variant="destructive"
                                size="sm"
                                className={cn(
                                  "h-7 px-3 text-xs font-medium",
                                  bothButtons && "rounded-r-none border-r-0"
                                )}
                              >
                                File Claim
                              </Button>
                            )}
                            {showTrackingCheck && (
                              <Button
                                variant="outline"
                                size="sm"
                                className={cn(
                                  "h-7 px-3 text-xs font-medium",
                                  bothButtons && "rounded-l-none"
                                )}
                              >
                                Tracking Check
                              </Button>
                            )}
                          </div>
                        )
                      })()}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination - stays at bottom via flexbox (flex-shrink-0) */}
      {!isLoading && sortedData.length > 0 && (
        <div className="flex-shrink-0 bg-background py-3 px-4 lg:px-6 flex items-center justify-between border-t border-border/40">
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
