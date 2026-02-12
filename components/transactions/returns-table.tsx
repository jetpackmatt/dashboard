"use client"

import * as React from "react"
import { DateRange } from "react-day-picker"

import { RETURNS_TABLE_CONFIG } from "@/lib/table-config"
import { TransactionsTable, PrefixColumn } from "./transactions-table"
import { Return, returnsCellRenderers } from "./cell-renderers"
import { ClientBadge } from "./client-badge"
import { useClient } from "@/components/client-context"
import { exportData, ExportFormat, ExportScope } from "@/lib/export"
import { useExport } from "@/components/export-context"
import { RETURNS_INVOICE_COLUMNS, toExportMapping } from "@/lib/export-configs"

const DEFAULT_PAGE_SIZE = 50

interface ReturnsTableProps {
  clientId: string | null
  returnStatusFilter?: string
  returnTypeFilter?: string
  dateRange?: DateRange
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

export function ReturnsTable({
  clientId,
  returnStatusFilter,
  returnTypeFilter,
  dateRange,
  searchQuery = "",
  userColumnVisibility = {},
  columnOrder,
  onColumnOrderChange,
  initialPageSize = DEFAULT_PAGE_SIZE,
  onPageSizeChange,
  onExportTriggerReady,
}: ReturnsTableProps) {
  const { startClientExport } = useExport()
  // Check if admin/care viewing all clients (for client badge prefix column)
  const { effectiveIsAdmin, effectiveIsCareUser, selectedClientId } = useClient()
  const showClientBadge = (effectiveIsAdmin || effectiveIsCareUser) && !selectedClientId

  // Convert "all" to undefined for API
  const effectiveStatusFilter = returnStatusFilter === "all" ? undefined : returnStatusFilter
  const effectiveTypeFilter = returnTypeFilter === "all" ? undefined : returnTypeFilter
  const [data, setData] = React.useState<Return[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [totalCount, setTotalCount] = React.useState(0)
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSizeState] = React.useState(initialPageSize)

  // Sort state - default: Created descending
  const [sortField, setSortField] = React.useState<string>('returnCreationDate')
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

  // Handle sort change
  const handleSortChange = React.useCallback((field: string, direction: 'asc' | 'desc') => {
    setSortField(field)
    setSortDirection(direction)
    setPageIndex(0)
    const colConfig = RETURNS_TABLE_CONFIG.columns.find(c => c.id === field)
    const sortKey = colConfig?.sortKey || field
    const params = new URLSearchParams({
      limit: pageSize.toString(),
      offset: '0',
      sortField: sortKey,
      sortDirection: direction,
    })
    if (clientId) params.set('clientId', clientId)
    if (dateRange?.from) params.set('startDate', dateRange.from.toISOString().split('T')[0])
    if (dateRange?.to) params.set('endDate', dateRange.to.toISOString().split('T')[0])
    if (effectiveStatusFilter) params.set('returnStatus', effectiveStatusFilter)
    if (effectiveTypeFilter) params.set('returnType', effectiveTypeFilter)
    if (searchQuery) params.set('search', searchQuery)
    setIsPageLoading(true)
    fetch(`/api/data/billing/returns?${params.toString()}`)
      .then(r => r.json())
      .then(result => { setData(result.data || []); setTotalCount(result.totalCount || 0) })
      .finally(() => setIsPageLoading(false))
  }, [clientId, dateRange, effectiveStatusFilter, effectiveTypeFilter, searchQuery, pageSize])

  // Export handler
  const handleExport = React.useCallback(async (options: { format: ExportFormat; scope: ExportScope }) => {
    const { format: exportFormat, scope } = options

    if (scope === 'current') {
      exportData(data as unknown as Record<string, unknown>[], {
        format: exportFormat, scope, filename: 'returns',
        ...toExportMapping(RETURNS_INVOICE_COLUMNS),
      })
    } else {
      const params = new URLSearchParams()
      if (clientId) params.set('clientId', clientId)
      if (dateRange?.from) params.set('startDate', dateRange.from.toISOString().split('T')[0])
      if (dateRange?.to) params.set('endDate', dateRange.to.toISOString().split('T')[0])
      if (effectiveStatusFilter) params.set('returnStatus', effectiveStatusFilter)
      if (effectiveTypeFilter) params.set('returnType', effectiveTypeFilter)
      if (searchQuery) params.set('search', searchQuery)
      params.set('export', 'true')

      startClientExport({
        apiUrl: '/api/data/billing/returns',
        params,
        source: 'Returns',
        totalCount,
        exportFn: (allData) => exportData(allData, {
          format: exportFormat, scope, filename: 'returns',
          ...toExportMapping(RETURNS_INVOICE_COLUMNS),
        }),
      })
    }
  }, [data, clientId, dateRange, effectiveStatusFilter, effectiveTypeFilter, searchQuery, totalCount, startClientExport])

  // Register export trigger with parent
  React.useEffect(() => {
    if (onExportTriggerReady) {
      onExportTriggerReady(handleExport)
    }
  }, [onExportTriggerReady, handleExport])

  // Client badge prefix column - only shown for admins viewing all clients
  const clientBadgePrefixColumn: PrefixColumn<Return> | undefined = showClientBadge
    ? {
        width: "56px",
        render: (row) => <ClientBadge clientId={row.clientId} />,
      }
    : undefined

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
      columnOrder={columnOrder}
      onColumnOrderChange={onColumnOrderChange}
      emptyMessage="No returns found."
      itemName="returns"
      integratedHeader={true}
      prefixColumn={clientBadgePrefixColumn}
      sortField={sortField}
      sortDirection={sortDirection}
      onSortChange={handleSortChange}
    />
  )
}
