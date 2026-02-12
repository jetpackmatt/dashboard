"use client"

import * as React from "react"

import { STORAGE_TABLE_CONFIG } from "@/lib/table-config"
import { TransactionsTable, PrefixColumn } from "./transactions-table"
import { Storage, storageCellRenderers } from "./cell-renderers"
import { ClientBadge } from "./client-badge"
import { useClient } from "@/components/client-context"
import { exportData, ExportFormat, ExportScope } from "@/lib/export"
import { useExport } from "@/components/export-context"
import { STORAGE_INVOICE_COLUMNS, toExportMapping } from "@/lib/export-configs"

const DEFAULT_PAGE_SIZE = 50

interface StorageTableProps {
  clientId: string | null
  fcFilter?: string
  locationTypeFilter?: string
  searchQuery?: string
  userColumnVisibility?: Record<string, boolean>
  columnOrder?: string[]
  onColumnOrderChange?: (order: string[]) => void
  // Page size persistence
  initialPageSize?: number
  onPageSizeChange?: (pageSize: number) => void
  // Export handler registration
  onExportTriggerReady?: (trigger: (options: { format: ExportFormat; scope: ExportScope }) => void) => void
}

export function StorageTable({
  clientId,
  fcFilter,
  locationTypeFilter,
  searchQuery = "",
  userColumnVisibility = {},
  columnOrder,
  onColumnOrderChange,
  initialPageSize = DEFAULT_PAGE_SIZE,
  onPageSizeChange,
  onExportTriggerReady,
}: StorageTableProps) {
  const { startClientExport } = useExport()
  // Check if admin/care viewing all clients (for client badge prefix column)
  const { effectiveIsAdmin, effectiveIsCareUser, selectedClientId } = useClient()
  const showClientBadge = (effectiveIsAdmin || effectiveIsCareUser) && !selectedClientId

  // Convert "all" to undefined for API
  const effectiveFcFilter = fcFilter === "all" ? undefined : fcFilter
  const effectiveLocationTypeFilter = locationTypeFilter === "all" ? undefined : locationTypeFilter
  const [data, setData] = React.useState<Storage[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [totalCount, setTotalCount] = React.useState(0)
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSizeState] = React.useState(initialPageSize)

  // Sort state - default: Charge Start descending
  const [sortField, setSortField] = React.useState<string>('chargeStartDate')
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

  // Fetch data from API
  const fetchData = React.useCallback(async (page: number, size: number, isInitial: boolean = false) => {
    if (isInitial) {
      setIsLoading(true)
    } else {
      setIsPageLoading(true)
    }

    try {
      const params = new URLSearchParams({
        limit: size.toString(),
        offset: (page * size).toString(),
      })
      if (clientId) params.set('clientId', clientId)

      // Add FC filter
      if (effectiveFcFilter) {
        params.set('fc', effectiveFcFilter)
      }

      // Add location type filter
      if (effectiveLocationTypeFilter) {
        params.set('locationType', effectiveLocationTypeFilter)
      }

      // Add search query
      if (searchQuery) {
        params.set('search', searchQuery)
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
  }, [clientId, effectiveFcFilter, effectiveLocationTypeFilter, searchQuery])

  // Initial load
  React.useEffect(() => {
    setPageIndex(0)
    fetchData(0, pageSize, true)
  }, [clientId, effectiveFcFilter, effectiveLocationTypeFilter, searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle page change
  const handlePageChange = (newPageIndex: number, newPageSize: number) => {
    setPageIndex(newPageIndex)
    setPageSize(newPageSize)
    fetchData(newPageIndex, newPageSize, false)
  }

  // Handle sort change
  const handleSortChange = React.useCallback((field: string, direction: 'asc' | 'desc') => {
    setSortField(field)
    setSortDirection(direction)
    setPageIndex(0)
    const colConfig = STORAGE_TABLE_CONFIG.columns.find(c => c.id === field)
    const sortKey = colConfig?.sortKey || field
    const params = new URLSearchParams({
      limit: pageSize.toString(),
      offset: '0',
      sortField: sortKey,
      sortDirection: direction,
    })
    if (clientId) params.set('clientId', clientId)
    if (effectiveFcFilter) params.set('fc', effectiveFcFilter)
    if (effectiveLocationTypeFilter) params.set('locationType', effectiveLocationTypeFilter)
    if (searchQuery) params.set('search', searchQuery)
    setIsPageLoading(true)
    fetch(`/api/data/billing/storage?${params.toString()}`)
      .then(r => r.json())
      .then(result => { setData(result.data || []); setTotalCount(result.totalCount || 0) })
      .finally(() => setIsPageLoading(false))
  }, [clientId, effectiveFcFilter, effectiveLocationTypeFilter, searchQuery, pageSize])

  // Export handler
  const handleExport = React.useCallback(async (options: { format: ExportFormat; scope: ExportScope }) => {
    const { format: exportFormat, scope } = options

    if (scope === 'current') {
      exportData(data as unknown as Record<string, unknown>[], {
        format: exportFormat, scope, filename: 'storage',
        ...toExportMapping(STORAGE_INVOICE_COLUMNS),
      })
    } else {
      const params = new URLSearchParams()
      if (clientId) params.set('clientId', clientId)
      if (effectiveFcFilter) params.set('fc', effectiveFcFilter)
      if (effectiveLocationTypeFilter) params.set('locationType', effectiveLocationTypeFilter)
      if (searchQuery) params.set('search', searchQuery)
      params.set('export', 'true')

      startClientExport({
        apiUrl: '/api/data/billing/storage',
        params,
        source: 'Storage',
        totalCount,
        exportFn: (allData) => exportData(allData, {
          format: exportFormat, scope, filename: 'storage',
          ...toExportMapping(STORAGE_INVOICE_COLUMNS),
        }),
      })
    }
  }, [data, clientId, effectiveFcFilter, effectiveLocationTypeFilter, searchQuery, totalCount, startClientExport])

  // Register export trigger with parent
  React.useEffect(() => {
    if (onExportTriggerReady) {
      onExportTriggerReady(handleExport)
    }
  }, [onExportTriggerReady, handleExport])

  // Client badge prefix column - only shown for admins viewing all clients
  const clientBadgePrefixColumn: PrefixColumn<Storage> | undefined = showClientBadge
    ? {
        width: "56px",
        render: (row) => <ClientBadge clientId={row.clientId} />,
      }
    : undefined

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
      columnOrder={columnOrder}
      onColumnOrderChange={onColumnOrderChange}
      emptyMessage="No storage records found."
      itemName="items"
      integratedHeader={true}
      prefixColumn={clientBadgePrefixColumn}
      sortField={sortField}
      sortDirection={sortDirection}
      onSortChange={handleSortChange}
    />
  )
}
