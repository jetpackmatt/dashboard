"use client"

import * as React from "react"
import { DateRange } from "react-day-picker"

import { RECEIVING_TABLE_CONFIG } from "@/lib/table-config"
import { TransactionsTable, PrefixColumn } from "./transactions-table"
import { Receiving, receivingCellRenderers } from "./cell-renderers"
import { ClientBadge } from "./client-badge"
import { useClient } from "@/components/client-context"
import { exportData, ExportFormat, ExportScope } from "@/lib/export"
import { useExport } from "@/components/export-context"
import { RECEIVING_INVOICE_COLUMNS, toExportMapping } from "@/lib/export-configs"

const DEFAULT_PAGE_SIZE = 50

interface ReceivingTableProps {
  clientId: string | null
  statusFilter?: string
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

export function ReceivingTable({
  clientId,
  statusFilter,
  dateRange,
  searchQuery = "",
  userColumnVisibility = {},
  columnOrder,
  onColumnOrderChange,
  initialPageSize = DEFAULT_PAGE_SIZE,
  onPageSizeChange,
  onExportTriggerReady,
}: ReceivingTableProps) {
  const { startClientExport } = useExport()
  // Check if admin/care viewing all clients (for client badge prefix column)
  const { effectiveIsAdmin, effectiveIsCareUser, selectedClientId } = useClient()
  const showClientBadge = (effectiveIsAdmin || effectiveIsCareUser) && !selectedClientId

  // Convert "all" to undefined for API
  const effectiveStatusFilter = statusFilter === "all" ? undefined : statusFilter
  const [data, setData] = React.useState<Receiving[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [totalCount, setTotalCount] = React.useState(0)
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSizeState] = React.useState(initialPageSize)

  // Sort state - default: Transaction Date descending
  const [sortField, setSortField] = React.useState<string>('transactionDate')
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

      // Add receiving status filter
      if (effectiveStatusFilter) {
        params.set('receivingStatus', effectiveStatusFilter)
      }

      // Add search query
      if (searchQuery) {
        params.set('search', searchQuery)
      }

      const response = await fetch(`/api/data/billing/receiving?${params.toString()}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch receiving: ${response.status}`)
      }

      const result = await response.json()
      setData(result.data || [])
      setTotalCount(result.totalCount || 0)
    } catch (err) {
      console.error('Error fetching receiving:', err)
      setData([])
      setTotalCount(0)
    } finally {
      setIsLoading(false)
      setIsPageLoading(false)
    }
  }, [clientId, dateRange, effectiveStatusFilter, searchQuery])

  // Initial load
  React.useEffect(() => {
    setPageIndex(0)
    fetchData(0, pageSize, true)
  }, [clientId, dateRange, effectiveStatusFilter, searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

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
    const colConfig = RECEIVING_TABLE_CONFIG.columns.find(c => c.id === field)
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
    if (effectiveStatusFilter) params.set('receivingStatus', effectiveStatusFilter)
    if (searchQuery) params.set('search', searchQuery)
    setIsPageLoading(true)
    fetch(`/api/data/billing/receiving?${params.toString()}`)
      .then(r => r.json())
      .then(result => { setData(result.data || []); setTotalCount(result.totalCount || 0) })
      .finally(() => setIsPageLoading(false))
  }, [clientId, dateRange, effectiveStatusFilter, searchQuery, pageSize])

  // Export handler
  const handleExport = React.useCallback(async (options: { format: ExportFormat; scope: ExportScope }) => {
    const { format: exportFormat, scope } = options

    if (scope === 'current') {
      exportData(data as unknown as Record<string, unknown>[], {
        format: exportFormat, scope, filename: 'receiving',
        ...toExportMapping(RECEIVING_INVOICE_COLUMNS),
      })
    } else {
      const params = new URLSearchParams()
      if (clientId) params.set('clientId', clientId)
      if (dateRange?.from) params.set('startDate', dateRange.from.toISOString().split('T')[0])
      if (dateRange?.to) params.set('endDate', dateRange.to.toISOString().split('T')[0])
      if (effectiveStatusFilter) params.set('receivingStatus', effectiveStatusFilter)
      if (searchQuery) params.set('search', searchQuery)
      params.set('export', 'true')

      startClientExport({
        apiUrl: '/api/data/billing/receiving',
        params,
        source: 'Receiving',
        totalCount,
        exportFn: (allData) => exportData(allData, {
          format: exportFormat, scope, filename: 'receiving',
          ...toExportMapping(RECEIVING_INVOICE_COLUMNS),
        }),
      })
    }
  }, [data, clientId, dateRange, effectiveStatusFilter, searchQuery, totalCount, startClientExport])

  // Register export trigger with parent
  React.useEffect(() => {
    if (onExportTriggerReady) {
      onExportTriggerReady(handleExport)
    }
  }, [onExportTriggerReady, handleExport])

  // Client badge prefix column - only shown for admins viewing all clients
  const clientBadgePrefixColumn: PrefixColumn<Receiving> | undefined = showClientBadge
    ? {
        width: "56px",
        render: (row) => <ClientBadge clientId={row.clientId} />,
      }
    : undefined

  return (
    <TransactionsTable
      config={RECEIVING_TABLE_CONFIG}
      data={data}
      cellRenderers={receivingCellRenderers}
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
      emptyMessage="No receiving records found."
      itemName="records"
      integratedHeader={true}
      prefixColumn={clientBadgePrefixColumn}
      sortField={sortField}
      sortDirection={sortDirection}
      onSortChange={handleSortChange}
    />
  )
}
