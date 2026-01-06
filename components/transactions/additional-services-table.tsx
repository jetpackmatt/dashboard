"use client"

import * as React from "react"
import { DateRange } from "react-day-picker"

import { ADDITIONAL_SERVICES_TABLE_CONFIG } from "@/lib/table-config"
import { TransactionsTable, PrefixColumn } from "./transactions-table"
import { AdditionalService, additionalServicesCellRenderers } from "./cell-renderers"
import { ClientBadge } from "./client-badge"
import { useClient } from "@/components/client-context"
import { exportData, ExportFormat, ExportScope } from "@/lib/export"

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
  // Page size persistence
  initialPageSize?: number
  onPageSizeChange?: (pageSize: number) => void
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
  initialPageSize = DEFAULT_PAGE_SIZE,
  onPageSizeChange,
  onExportTriggerReady,
}: AdditionalServicesTableProps) {
  // Check if admin viewing all clients (for client badge prefix column)
  const { isAdmin, selectedClientId } = useClient()
  const showClientBadge = isAdmin && !selectedClientId

  // Use stable reference for empty array
  const effectiveStatusFilter = statusFilter ?? EMPTY_STATUS_FILTER
  const [data, setData] = React.useState<AdditionalService[]>([])
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

  // Initial load
  React.useEffect(() => {
    setPageIndex(0)
    fetchData(0, pageSize, true)
  }, [clientId, dateRange, effectiveStatusFilter, feeTypeFilter, searchQuery]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handle page change
  const handlePageChange = (newPageIndex: number, newPageSize: number) => {
    setPageIndex(newPageIndex)
    setPageSize(newPageSize)
    fetchData(newPageIndex, newPageSize, false)
  }

  // Export handler
  const handleExport = React.useCallback(async (options: { format: ExportFormat; scope: ExportScope }) => {
    const { format: exportFormat, scope } = options

    let dataToExport: AdditionalService[]

    if (scope === 'current') {
      dataToExport = data
    } else {
      const params = new URLSearchParams({
        limit: '10000',
        offset: '0',
      })
      if (clientId) params.set('clientId', clientId)
      if (dateRange?.from) params.set('startDate', dateRange.from.toISOString().split('T')[0])
      if (dateRange?.to) params.set('endDate', dateRange.to.toISOString().split('T')[0])
      if (effectiveStatusFilter.length > 0) params.set('status', effectiveStatusFilter.join(','))
      if (feeTypeFilter && feeTypeFilter !== 'all') params.set('feeType', feeTypeFilter)
      if (searchQuery) params.set('search', searchQuery)

      const response = await fetch(`/api/data/billing/additional-services?${params.toString()}`)
      const result = await response.json()
      dataToExport = result.data || []
    }

    exportData(dataToExport as unknown as Record<string, unknown>[], {
      format: exportFormat,
      scope,
      filename: 'additional-services',
      tableConfig: ADDITIONAL_SERVICES_TABLE_CONFIG,
    })
  }, [data, clientId, dateRange, effectiveStatusFilter, feeTypeFilter, searchQuery])

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
      emptyMessage="No additional services found."
      itemName="services"
      integratedHeader={true}
      prefixColumn={clientBadgePrefixColumn}
    />
  )
}
