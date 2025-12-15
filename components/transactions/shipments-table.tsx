"use client"

import * as React from "react"
import { format, startOfDay, endOfDay } from "date-fns"
import { DateRange } from "react-day-picker"

import { SHIPMENTS_TABLE_CONFIG } from "@/lib/table-config"
import { TransactionsTable } from "./transactions-table"
import { Shipment, shipmentCellRenderers } from "./cell-renderers"
import { ShipmentDetailsDrawer } from "@/components/shipment-details-drawer"

interface ShipmentsTableProps {
  clientId: string
  // Column visibility from column selector
  userColumnVisibility?: Record<string, boolean>
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
}

export function ShipmentsTable({
  clientId,
  userColumnVisibility = {},
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
}: ShipmentsTableProps) {
  // Use initial data if provided, otherwise start empty
  const hasInitialData = initialData && initialData.length > 0
  const [data, setData] = React.useState<Shipment[]>(initialData || [])
  const [isLoading, setIsLoading] = React.useState(!hasInitialData)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [totalCount, setTotalCount] = React.useState(initialTotalCount)

  // Track if we've used the initial data (to skip first fetch)
  const [usedInitialData, setUsedInitialData] = React.useState(hasInitialData)

  // Shipment details drawer state
  const [selectedShipmentId, setSelectedShipmentId] = React.useState<string | null>(null)
  const [drawerOpen, setDrawerOpen] = React.useState(false)

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
  }, [clientId, data.length, hasInitialData, statusFilter, ageFilter, typeFilter, channelFilter, carrierFilter, dateRange, searchQuery, onChannelsChange, onCarriersChange])

  // Initial load and on filter/page change
  React.useEffect(() => {
    // Skip the first fetch if we have initial data
    if (usedInitialData) {
      setUsedInitialData(false)
      return
    }
    fetchData(pageIndex, pageSize)
  }, [clientId, pageIndex, pageSize, statusFilter, ageFilter, typeFilter, channelFilter, carrierFilter, dateRange, searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page when filter changes
  React.useEffect(() => {
    setPageIndex(0)
  }, [statusFilter, ageFilter, typeFilter, channelFilter, carrierFilter, dateRange, searchQuery])

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
        cellRenderers={shipmentCellRenderers}
        getRowKey={(row) => row.id.toString()}
        isLoading={isLoading}
        isPageLoading={isPageLoading}
        totalCount={totalCount}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPageChange={handlePageChange}
        userColumnVisibility={userColumnVisibility}
        emptyMessage="No shipments found."
        itemName="shipments"
        integratedHeader={true}
        onRowClick={handleRowClick}
      />
      <ShipmentDetailsDrawer
        shipmentId={selectedShipmentId}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  )
}
