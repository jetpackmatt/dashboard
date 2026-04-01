"use client"

import * as React from "react"
import { differenceInHours, format, startOfDay, endOfDay } from "date-fns"
import { DateRange } from "react-day-picker"

import { UNFULFILLED_TABLE_CONFIG } from "@/lib/table-config"
import { TransactionsTable, PrefixColumn } from "./transactions-table"
import { UnfulfilledOrder, createUnfulfilledCellRenderers } from "./cell-renderers"
import { ShipmentDetailsDrawer } from "@/components/shipment-details-drawer"
import { ClientBadge } from "./client-badge"
import { useClient } from "@/components/client-context"
import { exportData, ExportFormat, ExportScope } from "@/lib/export"
import { useExport } from "@/components/export-context"
import { SHIPMENTS_INVOICE_COLUMNS, toExportMapping } from "@/lib/export-configs"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"

// Calculate age in days from order date (used for filtering)
function calculateAge(orderDate: string): number {
  if (!orderDate) return 0
  const hoursElapsed = differenceInHours(new Date(), new Date(orderDate))
  return hoursElapsed / 24
}

interface UnfulfilledTableProps {
  clientId: string
  // Filter state managed by parent (DataTable) - now using arrays for multi-select
  statusFilter?: string[]
  ageFilter?: string[]
  typeFilter?: string[]
  channelFilter?: string[]
  destinationFilter?: string[]
  dateRange?: DateRange
  // Search query for real-time search
  searchQuery?: string
  // Callback to update available channels in parent
  onChannelsChange?: (channels: string[]) => void
  // Callback to update available destinations in parent
  onDestinationsChange?: (countries: string[], statesByCountry: Record<string, string[]>) => void
  // Callback to notify parent of loading state changes
  onLoadingChange?: (isLoading: boolean) => void
  // Column visibility from column selector
  userColumnVisibility?: Record<string, boolean>
  // Column order from drag-to-reorder
  columnOrder?: string[]
  onColumnOrderChange?: (order: string[]) => void
  // Pre-fetched data for instant initial render
  initialData?: UnfulfilledOrder[]
  initialTotalCount?: number
  // Page size persistence
  initialPageSize?: number
  onPageSizeChange?: (pageSize: number) => void
  // Export handler registration
  onExportTriggerReady?: (trigger: (options: { format: ExportFormat; scope: ExportScope }) => void) => void
}

export function UnfulfilledTable({
  clientId,
  statusFilter = [],
  ageFilter = [],
  typeFilter = [],
  channelFilter = [],
  destinationFilter = [],
  dateRange,
  searchQuery = "",
  onChannelsChange,
  onDestinationsChange,
  onLoadingChange,
  userColumnVisibility = {},
  columnOrder,
  onColumnOrderChange,
  // Pre-fetched data for instant initial render
  initialData,
  initialTotalCount = 0,
  initialPageSize = 50,
  onPageSizeChange,
  onExportTriggerReady,
}: UnfulfilledTableProps) {
  const { startClientExport } = useExport()
  // Check if admin/care viewing all clients (for client badge prefix column)
  const { effectiveIsAdmin, effectiveIsCareUser, selectedClientId } = useClient()
  const showClientBadge = (effectiveIsAdmin || effectiveIsCareUser) && !selectedClientId

  // Use initial data if provided, otherwise start empty
  const hasInitialData = initialData && initialData.length > 0
  const [data, setData] = React.useState<UnfulfilledOrder[]>(initialData || [])
  const [isLoading, setIsLoading] = React.useState(!hasInitialData)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [totalCount, setTotalCount] = React.useState(initialTotalCount)

  // Track if we've used the initial data (to skip first fetch)
  const [usedInitialData, setUsedInitialData] = React.useState(hasInitialData)

  // Sort state - default: Order Imported descending (matches API default)
  const [sortField, setSortField] = React.useState<string>('orderDate')
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('desc')

  // Shipment details drawer state
  const [selectedShipmentId, setSelectedShipmentId] = React.useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

  // Extract platform types from initial data on mount
  React.useEffect(() => {
    if (hasInitialData && initialData && onChannelsChange) {
      // channelName now contains real application_name from API (e.g., "Shopify", "Amazon")
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

  // Pagination state - use initialPageSize from props for persistence
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSizeState] = React.useState(initialPageSize)

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

  // Notify parent of loading state changes
  React.useEffect(() => {
    onLoadingChange?.(isLoading || isPageLoading)
  }, [isLoading, isPageLoading, onLoadingChange])

  // Fetch data
  const fetchData = React.useCallback(async (page: number, size: number) => {
    const isInitialLoad = page === 0 && data.length === 0

    if (isInitialLoad) {
      setIsLoading(true)
    } else {
      setIsPageLoading(true)
    }
    setError(null)

    try {
      const offset = page * size

      // When client-side filters are active, fetch all rows so filtering + pagination work correctly
      // Unfulfilled orders are typically < 1000 so fetching all is safe
      const hasClientFilters = ageFilter.length > 0 || typeFilter.length > 0 || channelFilter.length > 0 || destinationFilter.length > 0

      // Build query params
      const params = new URLSearchParams({
        clientId,
        limit: hasClientFilters ? '1000' : size.toString(),
        offset: hasClientFilters ? '0' : offset.toString(),
      })

      // Tell API to fetch all when client-side filters are active
      if (hasClientFilters) {
        params.set('fetchAll', 'true')
      }

      // Add sort params
      if (sortField) {
        // Resolve sortKey from table config
        const colConfig = UNFULFILLED_TABLE_CONFIG.columns.find(c => c.id === sortField)
        const sortKey = colConfig?.sortKey || sortField
        params.set('sortField', sortKey)
        params.set('sortDirection', sortDirection)
      }

      // Add status filter
      if (statusFilter.length > 0) {
        params.set('status', statusFilter.join(','))
      }

      // Add search query (server-side)
      if (searchQuery) {
        params.set('search', searchQuery)
      }

      // Add date range filter (server-side filtering for performance)
      if (dateRange?.from) {
        params.set('startDate', format(startOfDay(dateRange.from), 'yyyy-MM-dd'))
        if (dateRange.to) {
          params.set('endDate', format(endOfDay(dateRange.to), 'yyyy-MM-dd'))
        }
      }

      const response = await fetch(`/api/data/orders/unfulfilled?${params.toString()}`)

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
            .map((d: UnfulfilledOrder) => d.channelName)
            .filter(Boolean)
        )]
        if (platforms.length > 0 && onChannelsChange) {
          onChannelsChange(platforms as string[])
        }
      }

      // Apply client-side filters for filters not supported server-side
      // Note: Status filter is now applied server-side for accurate pagination

      // Age filter - check if order age matches any selected age range
      if (ageFilter.length > 0) {
        filteredData = filteredData.filter((order: UnfulfilledOrder) => {
          const age = calculateAge(order.orderDate)
          return ageFilter.some(filter => {
            switch (filter) {
              case "0-1": return age < 1
              case "1-2": return age >= 1 && age < 2
              case "2-3": return age >= 2 && age < 3
              case "3-5": return age >= 3 && age < 5
              case "5-7": return age >= 5 && age < 7
              case "7-10": return age >= 7 && age < 10
              case "10-15": return age >= 10 && age < 15
              case "15+": return age >= 15
              default: return false
            }
          })
        })
      }

      // Type filter - match any selected type
      if (typeFilter.length > 0) {
        filteredData = filteredData.filter((order: UnfulfilledOrder) =>
          typeFilter.includes(order.orderType)
        )
      }

      // Channel filter - match any selected platform type
      // channelName now contains real application_name from API
      if (channelFilter.length > 0) {
        filteredData = filteredData.filter((order: UnfulfilledOrder) => {
          return channelFilter.includes(order.channelName)
        })
      }

      // Destination filter - match country-level or country:state-level
      if (destinationFilter.length > 0) {
        filteredData = filteredData.filter((order: UnfulfilledOrder) => {
          if (destinationFilter.includes(order.destCountry)) return true
          if (order.destState) {
            return destinationFilter.includes(`${order.destCountry}:${order.destState}`)
          }
          return false
        })
      }

      // Extract destination options and notify parent
      // Only update when destination filter is NOT active (like channels pattern)
      if (destinationFilter.length === 0 && onDestinationsChange) {
        const countries = [...new Set(
          filteredData.map((d: UnfulfilledOrder) => d.destCountry).filter(Boolean)
        )] as string[]
        const statesByCountry: Record<string, string[]> = {}
        for (const d of filteredData as UnfulfilledOrder[]) {
          if (d.destCountry && d.destState) {
            if (!statesByCountry[d.destCountry]) statesByCountry[d.destCountry] = []
            if (!statesByCountry[d.destCountry].includes(d.destState)) {
              statesByCountry[d.destCountry].push(d.destState)
            }
          }
        }
        if (countries.length > 0) {
          onDestinationsChange(countries, statesByCountry)
        }
      }

      // Note: Date range filtering is now done server-side for performance

      setData(filteredData)
      // When client-side filters are active, we fetched ALL rows and filtered locally
      // so filteredData.length IS the accurate total for pagination
      // When no client-side filters, use the server's count (which respects server-side pagination)
      setTotalCount(hasClientFilters ? filteredData.length : (result.totalCount || 0))
    } catch (err) {
      console.error('Error fetching unfulfilled orders:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setData([])
    } finally {
      setIsLoading(false)
      setIsPageLoading(false)
    }
  }, [clientId, data.length, statusFilter, ageFilter, typeFilter, channelFilter, destinationFilter, dateRange, searchQuery, sortField, sortDirection, onChannelsChange, onDestinationsChange])

  // Initial load and on filter/page change
  React.useEffect(() => {
    // Skip the first fetch if we have initial data
    if (usedInitialData) {
      setUsedInitialData(false)
      return
    }
    fetchData(pageIndex, pageSize)
  }, [clientId, pageIndex, pageSize, statusFilter, ageFilter, typeFilter, channelFilter, destinationFilter, dateRange, searchQuery, sortField, sortDirection]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page when filter changes (from parent)
  React.useEffect(() => {
    setPageIndex(0)
  }, [statusFilter, ageFilter, typeFilter, channelFilter, destinationFilter, dateRange, searchQuery])

  // Handle page changes
  const handlePageChange = React.useCallback((newPageIndex: number, newPageSize: number) => {
    if (newPageSize !== pageSize) {
      setPageSize(newPageSize)
      setPageIndex(0)
    } else {
      setPageIndex(newPageIndex)
    }
  }, [pageSize])

  // Handle sort change
  const handleSortChange = React.useCallback((field: string, direction: 'asc' | 'desc') => {
    setSortField(field)
    setSortDirection(direction)
    setPageIndex(0) // Reset to first page on sort change
  }, [])

  // Handle row click to open shipment details drawer
  const handleRowClick = React.useCallback((row: UnfulfilledOrder) => {
    setSelectedShipmentId(row.shipmentId)
    setDrawerOpen(true)
  }, [])

  // Mark as Reshipped dialog state
  const [reshipDialogOpen, setReshipDialogOpen] = React.useState(false)
  const [reshipTargetId, setReshipTargetId] = React.useState<string | null>(null)
  const [reshipInput, setReshipInput] = React.useState("")
  const [reshipSaving, setReshipSaving] = React.useState(false)

  // Note dialog state
  const [noteDialogOpen, setNoteDialogOpen] = React.useState(false)
  const [noteTargetId, setNoteTargetId] = React.useState<string | null>(null)
  const [noteInput, setNoteInput] = React.useState("")
  const [noteSaving, setNoteSaving] = React.useState(false)

  const handleMarkReshipClick = React.useCallback((shipmentId: string) => {
    setReshipTargetId(shipmentId)
    setReshipInput("")
    setReshipDialogOpen(true)
  }, [])

  const handleAddNoteClick = React.useCallback((shipmentId: string) => {
    setNoteTargetId(shipmentId)
    setNoteInput("")
    setNoteDialogOpen(true)
  }, [])

  const handleReshipSave = React.useCallback(async () => {
    if (!reshipTargetId || !reshipInput.trim()) return
    setReshipSaving(true)
    try {
      const res = await fetch(`/api/data/shipments/${reshipTargetId}/reshipment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reshipmentId: reshipInput.trim() }),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success('Marked as reshipped')
      setReshipDialogOpen(false)
      // Update local data
      setData(prev => prev.map(r =>
        r.shipmentId === reshipTargetId ? { ...r, reshipmentId: reshipInput.trim() } : r
      ))
    } catch {
      toast.error('Failed to mark as reshipped')
    } finally {
      setReshipSaving(false)
    }
  }, [reshipTargetId, reshipInput])

  const handleNoteSave = React.useCallback(async () => {
    if (!noteTargetId || !noteInput.trim()) return
    setNoteSaving(true)
    try {
      const res = await fetch(`/api/data/shipments/${noteTargetId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ note: noteInput.trim() }),
      })
      if (!res.ok) throw new Error('Failed to save')
      toast.success('Note added')
      setNoteDialogOpen(false)
      setData(prev => prev.map(r =>
        r.shipmentId === noteTargetId ? { ...r, noteCount: (r.noteCount || 0) + 1 } : r
      ))
    } catch {
      toast.error('Failed to add note')
    } finally {
      setNoteSaving(false)
    }
  }, [noteTargetId, noteInput])

  const handleTagsSaved = React.useCallback((shipmentId: string, tags: string[]) => {
    setData(prev => prev.map(r =>
      r.shipmentId === shipmentId ? { ...r, tags } : r
    ))
  }, [])

  // Cell renderers with action callbacks
  const cellRenderers = React.useMemo(
    () => createUnfulfilledCellRenderers({
      onMarkReshipClick: handleMarkReshipClick,
      onAddNoteClick: handleAddNoteClick,
      onTagsSaved: handleTagsSaved,
    }),
    [handleMarkReshipClick, handleAddNoteClick, handleTagsSaved]
  )

  // Export handler - fetches all data when scope is 'all', uses current data for 'current'
  const handleExport = React.useCallback(async (options: { format: ExportFormat; scope: ExportScope }) => {
    const { format: exportFormat, scope } = options

    if (scope === 'current') {
      exportData(data as unknown as Record<string, unknown>[], {
        format: exportFormat, scope, filename: 'unfulfilled-orders',
        ...toExportMapping(SHIPMENTS_INVOICE_COLUMNS),
      })
    } else {
      const params = new URLSearchParams({ clientId })
      if (statusFilter.length > 0) params.set('status', statusFilter.join(','))
      if (searchQuery) params.set('search', searchQuery)
      if (dateRange?.from) {
        params.set('startDate', format(startOfDay(dateRange.from), 'yyyy-MM-dd'))
        if (dateRange.to) {
          params.set('endDate', format(endOfDay(dateRange.to), 'yyyy-MM-dd'))
        }
      }
      params.set('export', 'true')

      startClientExport({
        apiUrl: '/api/data/orders/unfulfilled',
        params,
        source: 'Unfulfilled Orders',
        totalCount,
        exportFn: (allData) => exportData(allData, {
          format: exportFormat, scope, filename: 'unfulfilled-orders',
          ...toExportMapping(SHIPMENTS_INVOICE_COLUMNS),
        }),
      })
    }
  }, [data, clientId, statusFilter, dateRange, searchQuery, totalCount, startClientExport])

  // Register export trigger with parent
  React.useEffect(() => {
    if (onExportTriggerReady) {
      onExportTriggerReady(handleExport)
    }
  }, [onExportTriggerReady, handleExport])

  // Client badge prefix column - only shown for admins viewing all clients
  const clientBadgePrefixColumn: PrefixColumn<UnfulfilledOrder> | undefined = showClientBadge
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
        config={UNFULFILLED_TABLE_CONFIG}
        data={data}
        cellRenderers={cellRenderers}
        getRowKey={(row) => row.id}
        isLoading={isLoading}
        isPageLoading={isPageLoading}
        totalCount={totalCount}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPageChange={handlePageChange}
        userColumnVisibility={userColumnVisibility}
        columnOrder={columnOrder}
        onColumnOrderChange={onColumnOrderChange}
        emptyMessage="No unfulfilled orders found."
        itemName="orders"
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
      />

      {/* Reship dialog */}
      <Dialog open={reshipDialogOpen} onOpenChange={setReshipDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Mark as Reshipped</DialogTitle>
            <DialogDescription>Enter the new shipment ID for the reshipment.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="reship-id">Reshipment Shipment ID</Label>
            <Input id="reship-id" value={reshipInput} onChange={(e) => setReshipInput(e.target.value)} placeholder="e.g. 330867617" />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReshipDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleReshipSave} disabled={reshipSaving || !reshipInput.trim()}>
              {reshipSaving ? 'Saving...' : 'Save'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Note dialog */}
      <Dialog open={noteDialogOpen} onOpenChange={setNoteDialogOpen}>
        <DialogContent className="sm:max-w-[400px]">
          <DialogHeader>
            <DialogTitle>Add a Note</DialogTitle>
            <DialogDescription>Add a note to shipment {noteTargetId}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Textarea
              value={noteInput}
              onChange={(e) => setNoteInput(e.target.value)}
              placeholder="Enter your note..."
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
