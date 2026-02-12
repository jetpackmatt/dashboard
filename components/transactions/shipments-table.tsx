"use client"

import * as React from "react"
import { format, startOfDay, endOfDay } from "date-fns"
import { DateRange } from "react-day-picker"

import { SHIPMENTS_TABLE_CONFIG } from "@/lib/table-config"
import { TransactionsTable, PrefixColumn } from "./transactions-table"
import { Shipment, createShipmentCellRenderers } from "./cell-renderers"
import { ShipmentDetailsDrawer } from "@/components/shipment-details-drawer"
import { ClaimSubmissionDialog } from "@/components/claims/claim-submission-dialog"
import { ClientBadge } from "./client-badge"
import { useClient } from "@/components/client-context"
import { exportData, ExportFormat, ExportScope } from "@/lib/export"
import { SHIPMENTS_INVOICE_COLUMNS, toExportMapping } from "@/lib/export-configs"
import { useExport } from "@/components/export-context"

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
  dateRange?: DateRange
  // Search query for real-time search
  searchQuery?: string
  // Callback to notify parent of available channels
  onChannelsChange?: (channels: string[]) => void
  // Callback to notify parent of available carriers
  onCarriersChange?: (carriers: string[]) => void
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
  dateRange,
  searchQuery = "",
  onChannelsChange,
  onCarriersChange,
  onLoadingChange,
  initialData,
  initialTotalCount = 0,
  initialPageSize = 50,
  onPageSizeChange,
  onExportTriggerReady,
}: ShipmentsTableProps) {
  // Check if admin/care viewing all clients (for client badge prefix column)
  const { effectiveIsAdmin, effectiveIsCareUser, selectedClientId } = useClient()
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

  // Handle "File a Claim" badge click
  const handleFileClaimClick = React.useCallback((shipmentId: string) => {
    setClaimShipmentId(shipmentId)
    setClaimDialogOpen(true)
  }, [])

  // Handle "Cancel" click (placeholder - opens drawer for now)
  const handleCancelClick = React.useCallback((shipmentId: string) => {
    setSelectedShipmentId(shipmentId)
    setDrawerOpen(true)
  }, [])

  // Create cell renderers with the claim + cancel click handlers
  const cellRenderers = React.useMemo(
    () => createShipmentCellRenderers({ onFileClaimClick: handleFileClaimClick, onCancelClick: handleCancelClick }),
    [handleFileClaimClick, handleCancelClick]
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

      // Add age filter (server-side - API handles fetching all records and filtering)
      if (ageFilter.length > 0) {
        params.set('age', ageFilter.join(','))
      }

      // Add search query (server-side)
      if (searchQuery) {
        params.set('search', searchQuery)
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

      // All filtering (including age) is done server-side
      setData(filteredData)
      setTotalCount(result.totalCount || 0)
    } catch (err) {
      console.error('Error fetching shipments:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setData([])
    } finally {
      setIsLoading(false)
      setIsPageLoading(false)
    }
  }, [clientId, data.length, hasInitialData, statusFilter, ageFilter, typeFilter, channelFilter, carrierFilter, dateRange, searchQuery, sortField, sortDirection, onChannelsChange, onCarriersChange])

  // Initial load and on filter/page change
  React.useEffect(() => {
    // Skip the first fetch if we have initial data
    if (usedInitialData) {
      setUsedInitialData(false)
      return
    }
    fetchData(pageIndex, pageSize)
  }, [clientId, pageIndex, pageSize, statusFilter, ageFilter, typeFilter, channelFilter, carrierFilter, dateRange, searchQuery, sortField, sortDirection]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page when filter or sort changes
  React.useEffect(() => {
    setPageIndex(0)
  }, [statusFilter, ageFilter, typeFilter, channelFilter, carrierFilter, dateRange, searchQuery, sortField, sortDirection])

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
  }, [data, clientId, dateRange, statusFilter, typeFilter, channelFilter, carrierFilter, ageFilter, searchQuery, totalCount, startStreamingExport])

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
      />
      {/* Claim submission dialog - opened via "File a Claim" badge */}
      <ClaimSubmissionDialog
        shipmentId={claimShipmentId || undefined}
        open={claimDialogOpen}
        onOpenChange={setClaimDialogOpen}
        preselectedClaimType="lostInTransit"
      />
    </>
  )
}
