"use client"

import * as React from "react"
import { DateRange } from "react-day-picker"

import { ADDITIONAL_SERVICES_TABLE_CONFIG } from "@/lib/table-config"
import { TransactionsTable, PrefixColumn } from "./transactions-table"
import { AdditionalService, additionalServicesCellRenderers } from "./cell-renderers"
import { ClientBadge } from "./client-badge"
import { useClient } from "@/components/client-context"
import { exportData, ExportFormat, ExportScope } from "@/lib/export"
import { useExport } from "@/components/export-context"
import { ADDITIONAL_SERVICES_INVOICE_COLUMNS, toExportMapping } from "@/lib/export-configs"

const DEFAULT_PAGE_SIZE = 50
// Stable empty array reference to prevent re-render loops
const EMPTY_STATUS_FILTER: string[] = []

interface AdditionalServicesTableProps {
  clientId: string | null
  statusFilter?: string[]
  feeTypeFilter?: string
  dateRange?: DateRange
  searchQuery?: string
  userColumnVisibility?: Record<string, boolean>
  columnOrder?: string[]
  onColumnOrderChange?: (order: string[]) => void
  // Page size persistence
  initialPageSize?: number
  onPageSizeChange?: (pageSize: number) => void
  // Pre-fetched data for instant initial render
  initialData?: AdditionalService[]
  initialTotalCount?: number
  initialLoading?: boolean
  // Export handler registration
  onExportTriggerReady?: (trigger: (options: { format: ExportFormat; scope: ExportScope }) => void) => void
}

export function AdditionalServicesTable({
  clientId,
  statusFilter,
  feeTypeFilter,
  dateRange,
  searchQuery = "",
  userColumnVisibility = {},
  columnOrder,
  onColumnOrderChange,
  initialPageSize = DEFAULT_PAGE_SIZE,
  onPageSizeChange,
  initialData,
  initialTotalCount = 0,
  initialLoading = false,
  onExportTriggerReady,
}: AdditionalServicesTableProps) {
  const { startClientExport } = useExport()
  // Check if admin/care viewing all clients (for client badge prefix column)
  const { effectiveIsAdmin, effectiveIsCareUser, selectedClientId } = useClient()
  const showClientBadge = (effectiveIsAdmin || effectiveIsCareUser) && !selectedClientId

  // Use stable reference for empty array
  const effectiveStatusFilter = statusFilter ?? EMPTY_STATUS_FILTER

  // Track if we've used initial data (to avoid re-fetching on first mount)
  const usedInitialData = React.useRef(false)

  // Initialize state with pre-fetched data when available
  const [data, setData] = React.useState<AdditionalService[]>(initialData || [])
  const [isLoading, setIsLoading] = React.useState(initialData ? initialLoading : true)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [totalCount, setTotalCount] = React.useState(initialTotalCount)
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSizeState] = React.useState(initialPageSize)

  // Sort state - default: Transaction Date descending
  const [sortField, setSortField] = React.useState<string>('transactionDate')
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('desc')

  // Sync with pre-fetched data when it arrives
  React.useEffect(() => {
    if (initialData && initialData.length > 0 && !usedInitialData.current) {
      setData(initialData)
      setTotalCount(initialTotalCount)
      setIsLoading(initialLoading)
      usedInitialData.current = true
    }
  }, [initialData, initialTotalCount, initialLoading])

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

      // Add status filter
      if (effectiveStatusFilter.length > 0) {
        params.set('status', effectiveStatusFilter.join(','))
      }

      // Add fee type filter
      if (feeTypeFilter && feeTypeFilter !== 'all') {
        params.set('feeType', feeTypeFilter)
      }

      // Add search query
      if (searchQuery) {
        params.set('search', searchQuery)
      }

      const response = await fetch(`/api/data/billing/additional-services?${params.toString()}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch additional services: ${response.status}`)
      }

      const result = await response.json()
      setData(result.data || [])
      setTotalCount(result.totalCount || 0)
    } catch (err) {
      console.error('Error fetching additional services:', err)
      setData([])
      setTotalCount(0)
    } finally {
      setIsLoading(false)
      setIsPageLoading(false)
    }
  }, [clientId, dateRange, effectiveStatusFilter, feeTypeFilter, searchQuery])

  // Initial load - skip if we have prefetched data and no filters applied
  React.useEffect(() => {
    // If we have prefetched data and no filters are applied, skip the initial fetch
    const hasFilters = effectiveStatusFilter.length > 0 || (feeTypeFilter && feeTypeFilter !== 'all') || searchQuery
    const hasPrefetchedData = initialData && initialData.length > 0

    if (hasPrefetchedData && !hasFilters && usedInitialData.current) {
      // Already using prefetched data, no need to fetch
      return
    }

    setPageIndex(0)
    fetchData(0, pageSize, true)
  }, [clientId, dateRange, effectiveStatusFilter, feeTypeFilter, searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

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
    // Resolve sortKey from table config
    const colConfig = ADDITIONAL_SERVICES_TABLE_CONFIG.columns.find(c => c.id === field)
    const sortKey = colConfig?.sortKey || field
    // Re-fetch with new sort - pass as params since state won't update synchronously
    const params = new URLSearchParams({
      limit: pageSize.toString(),
      offset: '0',
      sortField: sortKey,
      sortDirection: direction,
    })
    if (clientId) params.set('clientId', clientId)
    if (dateRange?.from) params.set('startDate', dateRange.from.toISOString().split('T')[0])
    if (dateRange?.to) params.set('endDate', dateRange.to.toISOString().split('T')[0])
    if (effectiveStatusFilter.length > 0) params.set('status', effectiveStatusFilter.join(','))
    if (feeTypeFilter && feeTypeFilter !== 'all') params.set('feeType', feeTypeFilter)
    if (searchQuery) params.set('search', searchQuery)
    setIsPageLoading(true)
    fetch(`/api/data/billing/additional-services?${params.toString()}`)
      .then(r => r.json())
      .then(result => { setData(result.data || []); setTotalCount(result.totalCount || 0) })
      .finally(() => setIsPageLoading(false))
  }, [clientId, dateRange, effectiveStatusFilter, feeTypeFilter, searchQuery, pageSize])

  // Export handler
  const handleExport = React.useCallback(async (options: { format: ExportFormat; scope: ExportScope }) => {
    const { format: exportFormat, scope } = options

    if (scope === 'current') {
      exportData(data as unknown as Record<string, unknown>[], {
        format: exportFormat, scope, filename: 'additional-services',
        ...toExportMapping(ADDITIONAL_SERVICES_INVOICE_COLUMNS),
      })
    } else {
      const params = new URLSearchParams()
      if (clientId) params.set('clientId', clientId)
      if (dateRange?.from) params.set('startDate', dateRange.from.toISOString().split('T')[0])
      if (dateRange?.to) params.set('endDate', dateRange.to.toISOString().split('T')[0])
      if (effectiveStatusFilter.length > 0) params.set('status', effectiveStatusFilter.join(','))
      if (feeTypeFilter && feeTypeFilter !== 'all') params.set('feeType', feeTypeFilter)
      if (searchQuery) params.set('search', searchQuery)
      params.set('export', 'true')

      startClientExport({
        apiUrl: '/api/data/billing/additional-services',
        params,
        source: 'Additional Services',
        totalCount,
        exportFn: (allData) => exportData(allData, {
          format: exportFormat, scope, filename: 'additional-services',
          ...toExportMapping(ADDITIONAL_SERVICES_INVOICE_COLUMNS),
        }),
      })
    }
  }, [data, clientId, dateRange, effectiveStatusFilter, feeTypeFilter, searchQuery, totalCount, startClientExport])

  // Register export trigger with parent
  React.useEffect(() => {
    if (onExportTriggerReady) {
      onExportTriggerReady(handleExport)
    }
  }, [onExportTriggerReady, handleExport])

  // Client badge prefix column - only shown for admins viewing all clients
  const clientBadgePrefixColumn: PrefixColumn<AdditionalService> | undefined = showClientBadge
    ? {
        width: "56px",
        render: (row) => <ClientBadge clientId={row.clientId} />,
      }
    : undefined

  return (
    <TransactionsTable
      config={ADDITIONAL_SERVICES_TABLE_CONFIG}
      data={data}
      cellRenderers={additionalServicesCellRenderers}
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
      emptyMessage="No additional services found."
      itemName="services"
      integratedHeader={true}
      prefixColumn={clientBadgePrefixColumn}
      sortField={sortField}
      sortDirection={sortDirection}
      onSortChange={handleSortChange}
    />
  )
}
