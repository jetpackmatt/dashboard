"use client"

import * as React from "react"
import { DateRange } from "react-day-picker"

import { RETURNS_TABLE_CONFIG } from "@/lib/table-config"
import { TransactionsTable } from "./transactions-table"
import { Return, returnsCellRenderers } from "./cell-renderers"

const DEFAULT_PAGE_SIZE = 50

interface ReturnsTableProps {
  clientId: string
  returnStatusFilter?: string
  returnTypeFilter?: string
  dateRange?: DateRange
  searchQuery?: string
  userColumnVisibility?: Record<string, boolean>
  // Page size persistence
  initialPageSize?: number
  onPageSizeChange?: (pageSize: number) => void
}

export function ReturnsTable({
  clientId,
  returnStatusFilter,
  returnTypeFilter,
  dateRange,
  searchQuery = "",
  userColumnVisibility = {},
  initialPageSize = DEFAULT_PAGE_SIZE,
  onPageSizeChange,
}: ReturnsTableProps) {
  // Convert "all" to undefined for API
  const effectiveStatusFilter = returnStatusFilter === "all" ? undefined : returnStatusFilter
  const effectiveTypeFilter = returnTypeFilter === "all" ? undefined : returnTypeFilter
  const [data, setData] = React.useState<Return[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [totalCount, setTotalCount] = React.useState(0)
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

  // Fetch data from API
  const fetchData = React.useCallback(async (page: number, size: number, isInitial: boolean = false) => {
    if (isInitial) {
      setIsLoading(true)
    } else {
      setIsPageLoading(true)
    }

    try {
      const params = new URLSearchParams({
        clientId,
        limit: size.toString(),
        offset: (page * size).toString(),
      })

      // Add date range filter
      if (dateRange?.from) {
        params.set('startDate', dateRange.from.toISOString().split('T')[0])
      }
      if (dateRange?.to) {
        params.set('endDate', dateRange.to.toISOString().split('T')[0])
      }

      // Add return status filter
      if (effectiveStatusFilter) {
        params.set('returnStatus', effectiveStatusFilter)
      }

      // Add return type filter
      if (effectiveTypeFilter) {
        params.set('returnType', effectiveTypeFilter)
      }

      // Add search query
      if (searchQuery) {
        params.set('search', searchQuery)
      }

      const response = await fetch(`/api/data/billing/returns?${params.toString()}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch returns: ${response.status}`)
      }

      const result = await response.json()
      setData(result.data || [])
      setTotalCount(result.totalCount || 0)
    } catch (err) {
      console.error('Error fetching returns:', err)
      setData([])
      setTotalCount(0)
    } finally {
      setIsLoading(false)
      setIsPageLoading(false)
    }
  }, [clientId, dateRange, effectiveStatusFilter, effectiveTypeFilter, searchQuery])

  // Initial load
  React.useEffect(() => {
    setPageIndex(0)
    fetchData(0, pageSize, true)
  }, [clientId, dateRange, effectiveStatusFilter, effectiveTypeFilter, searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle page change
  const handlePageChange = (newPageIndex: number, newPageSize: number) => {
    setPageIndex(newPageIndex)
    setPageSize(newPageSize)
    fetchData(newPageIndex, newPageSize, false)
  }

  return (
    <TransactionsTable
      config={RETURNS_TABLE_CONFIG}
      data={data}
      cellRenderers={returnsCellRenderers}
      getRowKey={(row) => row.id.toString()}
      isLoading={isLoading}
      isPageLoading={isPageLoading}
      totalCount={totalCount}
      pageIndex={pageIndex}
      pageSize={pageSize}
      onPageChange={handlePageChange}
      userColumnVisibility={userColumnVisibility}
      emptyMessage="No returns found."
      itemName="returns"
      integratedHeader={true}
    />
  )
}
