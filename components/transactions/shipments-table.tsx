"use client"

import * as React from "react"
import { format, startOfDay, endOfDay } from "date-fns"
import { DateRange } from "react-day-picker"

import { SHIPMENTS_TABLE_CONFIG } from "@/lib/table-config"
import { TransactionsTable, PrefixColumn } from "./transactions-table"
import { Shipment, createShipmentCellRenderers } from "./cell-renderers"
import { ShipmentDetailsDrawer } from "@/components/shipment-details-drawer"
import { ClaimSubmissionDialog } from "@/components/claims/claim-submission-dialog"
import { CreateTicketDialog } from "@/components/care/create-ticket-dialog"
import { ClientBadge } from "./client-badge"
import { useClient } from "@/components/client-context"
import { useWatchlist } from "@/hooks/use-watchlist"
import { useCareTicketSheet } from "@/components/care/ticket-sheet"
import { exportData, ExportFormat, ExportScope } from "@/lib/export"
import { SHIPMENTS_INVOICE_COLUMNS, toExportMapping } from "@/lib/export-configs"
import { useExport } from "@/components/export-context"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"

interface ShipmentsTableProps {
  clientId: string
  // Column visibility from column selector
  userColumnVisibility?: Record<string, boolean>
  // Column order from drag-to-reorder
  columnOrder?: string[]
  onColumnOrderChange?: (order: string[]) => void
  // Filter state from parent (DataTable) - arrays for multi-select
  statusFilter?: string[]
  ageFilter?: string[]
  typeFilter?: string[]
  channelFilter?: string[]
  carrierFilter?: string[]
  destinationFilter?: string[]
  fcFilter?: string[]
  dateRange?: DateRange
  // Search query for real-time search
  searchQuery?: string
  // Callback to notify parent of available channels
  onChannelsChange?: (channels: string[]) => void
  // Callback to notify parent of available carriers
  onCarriersChange?: (carriers: string[]) => void
  // Callback to notify parent of available FCs
  onFcsChange?: (fcs: string[]) => void
  // Callback to notify parent of available destinations
  onDestinationsChange?: (countries: string[], statesByCountry: Record<string, string[]>) => void
  // Callback to notify parent of loading state changes
  onLoadingChange?: (isLoading: boolean) => void
  // Pre-fetched data for instant initial render (optional)
  initialData?: Shipment[]
  initialTotalCount?: number
  // Page size persistence
  initialPageSize?: number
  onPageSizeChange?: (pageSize: number) => void
  // Export handler registration
  onExportTriggerReady?: (trigger: (options: { format: ExportFormat; scope: ExportScope }) => void) => void
  // Watchlist filter: if provided, only show these shipment IDs
  watchlistIds?: string[]
  // Notes filter: if true, only show shipments with notes
  hasNotes?: boolean
  // Callback to notify parent of noted shipment count (supports functional updates)
  onNotedCountChange?: (countOrUpdater: number | ((prev: number) => number)) => void
}

export function ShipmentsTable({
  clientId,
  userColumnVisibility = {},
  columnOrder,
  onColumnOrderChange,
  statusFilter = [],
  ageFilter = [],
  typeFilter = [],
  channelFilter = [],
  carrierFilter = [],
  destinationFilter = [],
  fcFilter = [],
  dateRange,
  searchQuery = "",
  onChannelsChange,
  onCarriersChange,
  onFcsChange,
  onDestinationsChange,
  onLoadingChange,
  initialData,
  initialTotalCount = 0,
  initialPageSize = 50,
  onPageSizeChange,
  onExportTriggerReady,
  watchlistIds,
  hasNotes,
  onNotedCountChange,
}: ShipmentsTableProps) {
  // Check if admin/care viewing all clients (for client badge prefix column)
  const { effectiveIsAdmin, effectiveIsCareUser, effectiveIsCareAdmin, selectedClientId, clients } = useClient()
  const isAdminOrCare = effectiveIsAdmin || effectiveIsCareUser
  const showClientBadge = (effectiveIsAdmin || effectiveIsCareUser) && !selectedClientId

  // Use initial data if provided, otherwise start empty
  const hasInitialData = initialData && initialData.length > 0
  const [data, setData] = React.useState<Shipment[]>(initialData || [])
  const [isLoading, setIsLoading] = React.useState(!hasInitialData)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [totalCount, setTotalCount] = React.useState(initialTotalCount)

  // Track if we've used the initial data (to skip first fetch)
  const [usedInitialData, setUsedInitialData] = React.useState(hasInitialData)

  // Global export context (progress bar persists across navigation)
  const { startStreamingExport } = useExport()

  // Shipment details drawer state
  const [selectedShipmentId, setSelectedShipmentId] = React.useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  // Claim submission dialog state
  const [claimShipmentId, setClaimShipmentId] = React.useState<string | null>(null)
  const [claimDialogOpen, setClaimDialogOpen] = React.useState(false)

  // Ticket dialog state (admin/care: opens CreateTicketDialog with shipment pre-filled)
  const [ticketDialogOpen, setTicketDialogOpen] = React.useState(false)
  const [ticketShipmentId, setTicketShipmentId] = React.useState<string | null>(null)

  // Reship dialog state
  const [reshipDialogOpen, setReshipDialogOpen] = React.useState(false)
  const [reshipTargetId, setReshipTargetId] = React.useState<string | null>(null)
  const [reshipInput, setReshipInput] = React.useState("")
  const [reshipSaving, setReshipSaving] = React.useState(false)

  // Note dialog state
  const [noteDialogOpen, setNoteDialogOpen] = React.useState(false)
  const [noteTargetId, setNoteTargetId] = React.useState<string | null>(null)
  const [noteInput, setNoteInput] = React.useState("")
  const [noteSaving, setNoteSaving] = React.useState(false)

  // Care ticket slide-up panel
  const { openTicket, prefetchTickets } = useCareTicketSheet()

  // Watchlist hook — filter to current client
  const { isWatched, toggleWatch } = useWatchlist(clientId)

  // Wrap toggleWatch with toast feedback
  const handleWatchlistToggle = React.useCallback((shipmentId: string) => {
    const wasWatched = isWatched(shipmentId)
    toggleWatch(shipmentId, clientId)
    if (wasWatched) {
      toast("Removed from Watchlist", { description: `Shipment ${shipmentId}` })
    } else {
      toast("Added to Watchlist", { description: `Shipment ${shipmentId}` })
    }
  }, [isWatched, toggleWatch, clientId])

  // Handle "File a Claim" badge click
  const handleFileClaimClick = React.useCallback((shipmentId: string) => {
    setClaimShipmentId(shipmentId)
    setClaimDialogOpen(true)
  }, [])

  // Handle "Ticket" click (admin/care)
  const handleTicketClick = React.useCallback((shipmentId: string) => {
    setTicketShipmentId(shipmentId)
    setTicketDialogOpen(true)
  }, [])

  // Handle "Mark as Reshipped" click
  const handleMarkReshipClick = React.useCallback((shipmentId: string) => {
    setReshipTargetId(shipmentId)
    setReshipInput("")
    setReshipDialogOpen(true)
  }, [])

  // Handle "Add a Note" click
  const handleAddNoteClick = React.useCallback((shipmentId: string) => {
    setNoteTargetId(shipmentId)
    setNoteInput("")
    setNoteDialogOpen(true)
  }, [])

  // Create cell renderers with role-based action handlers
  const cellRenderers = React.useMemo(
    () => createShipmentCellRenderers({
      onFileClaimClick: handleFileClaimClick,
      onTicketClick: handleTicketClick,
      onClaimTicketClick: openTicket,
      onMarkReshipClick: handleMarkReshipClick,
      onAddNoteClick: handleAddNoteClick,
      onWatchlistToggle: handleWatchlistToggle,
      isWatched,
      isAdminOrCare,
    }),
    [handleFileClaimClick, handleTicketClick, openTicket, handleMarkReshipClick, handleAddNoteClick, handleWatchlistToggle, isWatched, isAdminOrCare]
  )

  // Pagination state - use initialPageSize from props for persistence
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSizeState] = React.useState(initialPageSize)

  // Sorting state - default to label created descending (newest first)
  const [sortField, setSortField] = React.useState<string>('labelCreated')
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('desc')

  // Wrap setPageSize to notify parent for persistence
  const setPageSize = React.useCallback((size: number) => {
    setPageSizeState(size)
    onPageSizeChange?.(size)
  }, [onPageSizeChange])

  // Sync pageSize when initialPageSize changes (e.g., after localStorage loads)
  React.useEffect(() => {
    if (initialPageSize !== pageSize) {
      setPageSizeState(initialPageSize)
    }
  }, [initialPageSize]) // eslint-disable-line react-hooks/exhaustive-deps

  // Extract platform types from initial data on mount
  // channelName now contains real application_name from API (e.g., "Shopify", "Amazon")
  React.useEffect(() => {
    if (hasInitialData && initialData && onChannelsChange) {
      const platforms = [...new Set(
        initialData
          .map(d => d.channelName)
          .filter(Boolean)
      )] as string[]
      if (platforms.length > 0) {
        onChannelsChange(platforms)
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Notify parent of loading state changes
  React.useEffect(() => {
    onLoadingChange?.(isLoading || isPageLoading)
  }, [isLoading, isPageLoading, onLoadingChange])

  // Fetch data with server-side date filtering
  const fetchData = React.useCallback(async (page: number, size: number) => {
    const isInitialLoad = page === 0 && data.length === 0 && !hasInitialData

    if (isInitialLoad) {
      setIsLoading(true)
    } else {
      setIsPageLoading(true)
    }
    setError(null)

    try {
      const offset = page * size

      // Build query params
      const params = new URLSearchParams({
        clientId,
        limit: size.toString(),
        offset: offset.toString(),
      })

      // Add date range filter (server-side filtering on order_import_date)
      if (dateRange?.from) {
        params.set('startDate', format(startOfDay(dateRange.from), 'yyyy-MM-dd'))
        if (dateRange.to) {
          params.set('endDate', format(endOfDay(dateRange.to), 'yyyy-MM-dd'))
        }
      }

      // Add status filter
      if (statusFilter.length > 0) {
        params.set('status', statusFilter.join(','))
      }

      // Add type filter (server-side)
      if (typeFilter.length > 0) {
        params.set('type', typeFilter.join(','))
      }

      // Add channel filter (server-side)
      if (channelFilter.length > 0) {
        params.set('channel', channelFilter.join(','))
      }

      // Add carrier filter (server-side)
      if (carrierFilter.length > 0) {
        params.set('carrier', carrierFilter.join(','))
      }

      // Add FC/origin filter (server-side)
      if (fcFilter.length > 0) {
        params.set('fc', fcFilter.join(','))
      }

      // Add destination filter (server-side - country and country:state pairs)
      if (destinationFilter.length > 0) {
        params.set('destination', destinationFilter.join(','))
      }

      // Add age filter (server-side - API handles fetching all records and filtering)
      if (ageFilter.length > 0) {
        params.set('age', ageFilter.join(','))
      }

      // Add search query (server-side)
      if (searchQuery) {
        params.set('search', searchQuery)
      }

      // Add watchlist filter
      if (watchlistIds && watchlistIds.length > 0) {
        params.set('watchlist', watchlistIds.join(','))
      }

      // Add notes filter
      if (hasNotes) {
        params.set('hasNotes', 'true')
      }

      // Add sort params - map column ID to database column via sortKey
      if (sortField) {
        const sortColumn = SHIPMENTS_TABLE_CONFIG.columns.find(c => c.id === sortField)
        const dbSortKey = sortColumn?.sortKey || sortField
        params.set('sortField', dbSortKey)
        // Age is inverted: ascending age (youngest) = descending event_labeled (newest dates)
        const effectiveDirection = sortField === 'age'
          ? (sortDirection === 'asc' ? 'desc' : 'asc')
          : sortDirection
        params.set('sortDirection', effectiveDirection)
      }

      const response = await fetch(`/api/data/shipments?${params.toString()}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`)
      }

      const result = await response.json()
      let filteredData = result.data || []

      // Extract unique platform types for filter dropdown and notify parent
      // channelName now contains real application_name from API (e.g., "Shopify", "Amazon")
      // IMPORTANT: Only update channel options when NO channel filter is active
      // Otherwise, filtered data only contains selected channels, causing other options to disappear
      if (channelFilter.length === 0) {
        const platforms = [...new Set(
          filteredData
            .map((d: Shipment) => d.channelName)
            .filter(Boolean)
        )]
        if (platforms.length > 0 && onChannelsChange) {
          onChannelsChange(platforms as string[])
        }
      }

      // Extract unique carriers from API response and notify parent
      // IMPORTANT: Only update carrier options when NO carrier filter is active
      // Otherwise, the dropdown loses unselected options
      if (carrierFilter.length === 0) {
        const carriers = result.carriers || [...new Set(filteredData.map((d: Shipment) => d.carrier).filter(Boolean))]
        if (carriers.length > 0 && onCarriersChange) {
          onCarriersChange(carriers as string[])
        }
      }

      // Extract unique FCs from API response and notify parent
      if (fcFilter.length === 0) {
        const fcs = result.fcs || [...new Set(filteredData.map((d: Shipment) => d.fcName).filter(Boolean))]
        if (fcs.length > 0 && onFcsChange) {
          onFcsChange(fcs as string[])
        }
      }

      // Extract unique destinations from API response and notify parent
      if (destinationFilter.length === 0 && onDestinationsChange) {
        const destinations = result.destinations || [...new Set(filteredData.map((d: Shipment) => d.destCountry).filter(Boolean))]
        const destStates = result.destinationStates || {}
        if (destinations.length > 0) {
          onDestinationsChange(destinations as string[], destStates as Record<string, string[]>)
        }
      }

      // All filtering (including age) is done server-side
      setData(filteredData)
      setTotalCount(result.totalCount || 0)

      // Prefetch care ticket data for shipments with filed claims (instant slide-up)
      const ticketIds = filteredData
        .map((r: Shipment) => r.claimTicketId)
        .filter((id): id is string => !!id)
      if (ticketIds.length > 0) prefetchTickets(ticketIds)

      // Report noted shipment count to parent
      if (onNotedCountChange && result.notedShipmentCount !== undefined) {
        onNotedCountChange(result.notedShipmentCount)
      }
    } catch (err) {
      console.error('Error fetching shipments:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setData([])
    } finally {
      setIsLoading(false)
      setIsPageLoading(false)
    }
  }, [clientId, data.length, hasInitialData, statusFilter, ageFilter, typeFilter, channelFilter, carrierFilter, destinationFilter, fcFilter, dateRange, searchQuery, sortField, sortDirection, watchlistIds, hasNotes, onChannelsChange, onCarriersChange, onFcsChange, onDestinationsChange, prefetchTickets])

  // Prefetch care tickets from initial data on mount
  React.useEffect(() => {
    if (initialData && initialData.length > 0) {
      const ticketIds = initialData
        .map(r => r.claimTicketId)
        .filter((id): id is string => !!id)
      if (ticketIds.length > 0) prefetchTickets(ticketIds)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Initial load and on filter/page change
  React.useEffect(() => {
    // Skip the first fetch if we have initial data
    if (usedInitialData) {
      setUsedInitialData(false)
      return
    }
    fetchData(pageIndex, pageSize)
  }, [clientId, pageIndex, pageSize, statusFilter, ageFilter, typeFilter, channelFilter, carrierFilter, destinationFilter, fcFilter, dateRange, searchQuery, sortField, sortDirection, watchlistIds, hasNotes]) // eslint-disable-line react-hooks/exhaustive-deps

  // Save reshipment (defined after fetchData so we can refresh)
  const handleReshipSave = React.useCallback(async () => {
    if (!reshipTargetId || !reshipInput.trim()) return
    setReshipSaving(true)
    try {
      const res = await fetch(`/api/data/shipments/${reshipTargetId}/reshipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reshipmentId: reshipInput.trim() }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to save')
      }
      toast.success('Marked as reshipped')
      setReshipDialogOpen(false)
      fetchData(pageIndex, pageSize)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save reshipment')
    } finally {
      setReshipSaving(false)
    }
  }, [reshipTargetId, reshipInput, fetchData, pageIndex, pageSize])

  // Save note
  const handleNoteSave = React.useCallback(async () => {
    if (!noteTargetId || !noteInput.trim()) return
    setNoteSaving(true)
    try {
      const res = await fetch(`/api/data/shipments/${noteTargetId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteInput.trim() }),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error || 'Failed to save')
      }
      toast.success('Note added')
      setNoteDialogOpen(false)
      // Optimistically update noteCount on the row and tally
      const row = data.find(r => r.shipmentId === noteTargetId)
      if (row && (row.noteCount ?? 0) === 0) {
        onNotedCountChange?.((prev: number) => prev + 1)
      }
      setData(prev => prev.map(r =>
        r.shipmentId === noteTargetId
          ? { ...r, noteCount: (r.noteCount ?? 0) + 1 }
          : r
      ))
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add note')
    } finally {
      setNoteSaving(false)
    }
  }, [noteTargetId, noteInput, onNotedCountChange])

  // Reset page when filter or sort changes
  React.useEffect(() => {
    setPageIndex(0)
  }, [statusFilter, ageFilter, typeFilter, channelFilter, carrierFilter, destinationFilter, fcFilter, dateRange, searchQuery, sortField, sortDirection, watchlistIds, hasNotes])

  // Handle page changes
  const handlePageChange = React.useCallback((newPageIndex: number, newPageSize: number) => {
    if (newPageSize !== pageSize) {
      setPageSize(newPageSize)
      setPageIndex(0)
    } else {
      setPageIndex(newPageIndex)
    }
  }, [pageSize])

  // Handle row click to open shipment details drawer
  const handleRowClick = React.useCallback((row: Shipment) => {
    setSelectedShipmentId(row.shipmentId)
    setDrawerOpen(true)
  }, [])

  // Handle sort changes
  const handleSortChange = React.useCallback((field: string, direction: 'asc' | 'desc') => {
    setSortField(field)
    setSortDirection(direction)
  }, [])

  // Export handler - streams progress for 'all' (via global context), uses current data for 'current'
  const handleExport = React.useCallback(async (options: { format: ExportFormat; scope: ExportScope }) => {
    const { format: exportFormat, scope } = options

    if (scope === 'all') {
      // Delegate to global export context (survives navigation)
      startStreamingExport({
        url: '/api/data/shipments/export',
        body: {
          clientId,
          startDate: dateRange?.from ? format(startOfDay(dateRange.from), 'yyyy-MM-dd') : undefined,
          endDate: dateRange?.to ? format(endOfDay(dateRange.to), 'yyyy-MM-dd') : undefined,
          status: statusFilter.length > 0 ? statusFilter : undefined,
          type: typeFilter.length > 0 ? typeFilter : undefined,
          channel: channelFilter.length > 0 ? channelFilter : undefined,
          carrier: carrierFilter.length > 0 ? carrierFilter : undefined,
          fc: fcFilter.length > 0 ? fcFilter : undefined,
          age: ageFilter.length > 0 ? ageFilter : undefined,
          search: searchQuery || undefined,
          format: exportFormat,
        },
        source: 'Shipments',
        totalCount,
      })
      return
    }

    // Export current page data using invoice column format
    exportData(data as unknown as Record<string, unknown>[], {
      format: exportFormat,
      scope,
      filename: 'shipments',
      ...toExportMapping(SHIPMENTS_INVOICE_COLUMNS),
    })
  }, [data, clientId, dateRange, statusFilter, typeFilter, channelFilter, carrierFilter, fcFilter, ageFilter, searchQuery, totalCount, startStreamingExport])

  // Register export trigger with parent
  React.useEffect(() => {
    if (onExportTriggerReady) {
      onExportTriggerReady(handleExport)
    }
  }, [onExportTriggerReady, handleExport])

  // Client badge prefix column - only shown for admins viewing all clients
  const clientBadgePrefixColumn: PrefixColumn<Shipment> | undefined = showClientBadge
    ? {
        width: "56px",
        render: (row) => <ClientBadge clientId={row.clientId} />,
      }
    : undefined

  if (error) {
    return (
      <div className="px-4 lg:px-6">
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive dark:border-destructive/40 dark:bg-destructive/10 dark:text-red-300">
          <p className="font-medium">Error loading data</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <>
      <TransactionsTable
        config={SHIPMENTS_TABLE_CONFIG}
        data={data}
        cellRenderers={cellRenderers}
        getRowKey={(row) => row.id.toString()}
        isLoading={isLoading}
        isPageLoading={isPageLoading}
        totalCount={totalCount}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPageChange={handlePageChange}
        userColumnVisibility={userColumnVisibility}
        columnOrder={columnOrder}
        onColumnOrderChange={onColumnOrderChange}
        emptyMessage="No shipments found."
        itemName="shipments"
        integratedHeader={true}
        onRowClick={handleRowClick}
        prefixColumn={clientBadgePrefixColumn}
        sortField={sortField}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
      />
      <ShipmentDetailsDrawer
        shipmentId={selectedShipmentId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onNotesChanged={(sid, delta) => {
          const row = data.find(r => r.shipmentId === sid)
          const oldCount = row?.noteCount ?? 0
          const newCount = Math.max(0, oldCount + delta)
          setData(prev => prev.map(r =>
            r.shipmentId === sid ? { ...r, noteCount: newCount } : r
          ))
          if (oldCount > 0 && newCount === 0) {
            onNotedCountChange?.((prev: number) => Math.max(0, prev - 1))
          }
        }}
      />
      {/* Claim submission dialog - opened via "File a Claim" badge */}
      <ClaimSubmissionDialog
        shipmentId={claimShipmentId || undefined}
        open={claimDialogOpen}
        onOpenChange={setClaimDialogOpen}
      />
      {/* Ticket dialog - admin/care opens CreateTicketDialog with shipment pre-filled */}
      {isAdminOrCare && (
        <CreateTicketDialog
          open={ticketDialogOpen}
          onOpenChange={setTicketDialogOpen}
          onCreated={async () => {
            toast.success('Care ticket created')
          }}
          selectedClientId={selectedClientId || clientId}
          clients={clients.map(c => ({ id: c.id, company_name: c.company_name, merchant_id: c.merchant_id }))}
          isAdmin={effectiveIsAdmin || effectiveIsCareUser}
          initialShipmentId={ticketShipmentId || undefined}
        />
      )}
      {/* Reship dialog - brand users mark a shipment as reshipped */}
      <Dialog open={reshipDialogOpen} onOpenChange={setReshipDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Mark as Reshipped</DialogTitle>
            <DialogDescription>
              Enter the new shipment ID for the reshipment of #{reshipTargetId}.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Label htmlFor="reship-id">Reshipment Shipment ID</Label>
            <Input
              id="reship-id"
              value={reshipInput}
              onChange={(e) => setReshipInput(e.target.value)}
              placeholder="e.g. 330867617"
              className="mt-1.5"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReshipDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleReshipSave} disabled={reshipSaving || !reshipInput.trim()}>
              {reshipSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {/* Note dialog - brand users add a note to a shipment */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Add a Note</DialogTitle>
            <DialogDescription>
              Add a note to shipment #{noteTargetId}. Max 500 characters.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Textarea
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value.slice(0, 500))}
              placeholder="Type your note here..."
              rows={3}
              maxLength={500}
            />
            <p className="text-xs text-muted-foreground mt-1">{noteInput.length}/500</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleNoteSave} disabled={noteSaving || !noteInput.trim()}>
              {noteSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
