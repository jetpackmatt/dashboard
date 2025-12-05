"use client"

import * as React from "react"

import { STORAGE_TABLE_CONFIG } from "@/lib/table-config"
import { TransactionsTable } from "./transactions-table"
import { Storage, storageCellRenderers } from "./cell-renderers"

const DEFAULT_PAGE_SIZE = 50
// Stable empty array reference to prevent re-render loops
const EMPTY_STATUS_FILTER: string[] = []

interface StorageTableProps {
  clientId: string
  statusFilter?: string[]
  userColumnVisibility?: Record<string, boolean>
}

export function StorageTable({
  clientId,
  statusFilter,
  userColumnVisibility = {},
}: StorageTableProps) {
  // Use stable reference for empty array
  const effectiveStatusFilter = statusFilter ?? EMPTY_STATUS_FILTER
  const [data, setData] = React.useState<Storage[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [totalCount, setTotalCount] = React.useState(0)
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE)

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

      // Add status filter
      if (effectiveStatusFilter.length > 0) {
        params.set('status', effectiveStatusFilter.join(','))
      }

      const response = await fetch(`/api/data/billing/storage?${params.toString()}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch storage: ${response.status}`)
      }

      const result = await response.json()
      setData(result.data || [])
      setTotalCount(result.totalCount || 0)
    } catch (err) {
      console.error('Error fetching storage:', err)
      setData([])
      setTotalCount(0)
    } finally {
      setIsLoading(false)
      setIsPageLoading(false)
    }
  }, [clientId, effectiveStatusFilter])

  // Initial load
  React.useEffect(() => {
    setPageIndex(0)
    fetchData(0, pageSize, true)
  }, [clientId, effectiveStatusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle page change
  const handlePageChange = (newPageIndex: number, newPageSize: number) => {
    setPageIndex(newPageIndex)
    setPageSize(newPageSize)
    fetchData(newPageIndex, newPageSize, false)
  }

  return (
    <TransactionsTable
      config={STORAGE_TABLE_CONFIG}
      data={data}
      cellRenderers={storageCellRenderers}
      getRowKey={(row) => row.id.toString()}
      isLoading={isLoading}
      isPageLoading={isPageLoading}
      totalCount={totalCount}
      pageIndex={pageIndex}
      pageSize={pageSize}
      onPageChange={handlePageChange}
      userColumnVisibility={userColumnVisibility}
      emptyMessage="No storage records found."
      itemName="items"
      integratedHeader={true}
    />
  )
}
