"use client"

import * as React from "react"
import { differenceInHours, format, startOfDay, endOfDay } from "date-fns"
import { DateRange } from "react-day-picker"

import { UNFULFILLED_TABLE_CONFIG } from "@/lib/table-config"
import { TransactionsTable } from "./transactions-table"
import { UnfulfilledOrder, unfulfilledCellRenderers } from "./cell-renderers"
import { ShipmentDetailsDrawer } from "@/components/shipment-details-drawer"

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
  dateRange?: DateRange
  // Search query for real-time search
  searchQuery?: string
  // Callback to update available channels in parent
  onChannelsChange?: (channels: string[]) => void
  // Callback to notify parent of loading state changes
  onLoadingChange?: (isLoading: boolean) => void
  // Column visibility from column selector
  userColumnVisibility?: Record<string, boolean>
  // Pre-fetched data for instant initial render
  initialData?: UnfulfilledOrder[]
  initialTotalCount?: number
  // Page size persistence
  initialPageSize?: number
  onPageSizeChange?: (pageSize: number) => void
}

export function UnfulfilledTable({
  clientId,
  statusFilter = [],
  ageFilter = [],
  typeFilter = [],
  channelFilter = [],
  dateRange,
  searchQuery = "",
  onChannelsChange,
  onLoadingChange,
  userColumnVisibility = {},
  // Pre-fetched data for instant initial render
  initialData,
  initialTotalCount = 0,
  initialPageSize = 50,
  onPageSizeChange,
}: UnfulfilledTableProps) {
  // Use initial data if provided, otherwise start empty
  const hasInitialData = initialData && initialData.length > 0
  const [data, setData] = React.useState<UnfulfilledOrder[]>(initialData || [])
  const [isLoading, setIsLoading] = React.useState(!hasInitialData)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [totalCount, setTotalCount] = React.useState(initialTotalCount)

  // Track if we've used the initial data (to skip first fetch)
  const [usedInitialData, setUsedInitialData] = React.useState(hasInitialData)

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

      // Build query params
      const params = new URLSearchParams({
        clientId,
        limit: size.toString(),
        offset: offset.toString(),
      })

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

      // Note: Date range filtering is now done server-side for performance

      setData(filteredData)
      // Use filtered data count when client-side filters are active
      // Note: Status filter is now server-side, so use server count for that
      const hasClientFilters = ageFilter.length > 0 || typeFilter.length > 0 || channelFilter.length > 0
      setTotalCount(hasClientFilters ? filteredData.length : (result.totalCount || 0))
    } catch (err) {
      console.error('Error fetching unfulfilled orders:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setData([])
    } finally {
      setIsLoading(false)
      setIsPageLoading(false)
    }
  }, [clientId, data.length, statusFilter, ageFilter, typeFilter, channelFilter, dateRange, searchQuery, onChannelsChange])

  // Initial load and on filter/page change
  React.useEffect(() => {
    // Skip the first fetch if we have initial data
    if (usedInitialData) {
      setUsedInitialData(false)
      return
    }
    fetchData(pageIndex, pageSize)
  }, [clientId, pageIndex, pageSize, statusFilter, ageFilter, typeFilter, channelFilter, dateRange, searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset page when filter changes (from parent)
  React.useEffect(() => {
    setPageIndex(0)
  }, [statusFilter, ageFilter, typeFilter, channelFilter, dateRange, searchQuery])

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
  const handleRowClick = React.useCallback((row: UnfulfilledOrder) => {
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
        config={UNFULFILLED_TABLE_CONFIG}
        data={data}
        cellRenderers={unfulfilledCellRenderers}
        getRowKey={(row) => row.id}
        isLoading={isLoading}
        isPageLoading={isPageLoading}
        totalCount={totalCount}
        pageIndex={pageIndex}
        pageSize={pageSize}
        onPageChange={handlePageChange}
        userColumnVisibility={userColumnVisibility}
        emptyMessage="No unfulfilled orders found."
        itemName="orders"
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
