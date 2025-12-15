"use client"

import * as React from "react"
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
} from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { TableConfig, ColumnConfig } from "@/lib/table-config"
import { useResponsiveTable } from "@/hooks/use-responsive-table"

// ============================================
// TYPES
// ============================================

// Cell renderer function type - receives the row data and column config
export type CellRenderer<T> = (row: T, column: ColumnConfig) => React.ReactNode

// Props for the TransactionsTable component
export interface TransactionsTableProps<T> {
  // Configuration
  config: TableConfig
  data: T[]

  // Cell rendering - map of column ID to render function
  cellRenderers: Record<string, CellRenderer<T>>

  // Unique key extractor for rows
  getRowKey: (row: T) => string

  // Loading states
  isLoading?: boolean
  isPageLoading?: boolean

  // Pagination
  totalCount: number
  pageIndex: number
  pageSize: number
  onPageChange: (pageIndex: number, pageSize: number) => void
  pageSizeOptions?: number[]

  // Column visibility from column selector (user preferences)
  userColumnVisibility?: Record<string, boolean>

  // Empty state message
  emptyMessage?: string

  // Item name for count display (e.g., "orders", "shipments")
  itemName?: string

  // EXPERIMENTAL: Integrate table header into page header (removes border, matches header bg)
  integratedHeader?: boolean

  // Row click handler - when provided, rows become clickable
  onRowClick?: (row: T) => void
}

// ============================================
// MEMOIZED TABLE ROW COMPONENT
// ============================================

interface TableRowProps<T> {
  row: T
  rowKey: string
  visibleColumns: ColumnConfig[]
  cellRenderers: Record<string, CellRenderer<T>>
  getColumnWidth: (columnId: string) => string
  isPageLoading: boolean
  integratedHeader?: boolean
  onRowClick?: (row: T) => void
}

// Generic memoized row component to prevent unnecessary re-renders
const TableRowComponent = React.memo(function TableRowInner<T>({
  row,
  rowKey,
  visibleColumns,
  cellRenderers,
  getColumnWidth,
  isPageLoading,
  integratedHeader = false,
  onRowClick,
}: TableRowProps<T>) {
  const handleClick = React.useCallback(() => {
    if (onRowClick) {
      onRowClick(row)
    }
  }, [onRowClick, row])

  return (
    <tr
      key={rowKey}
      onClick={handleClick}
      className={`h-12 border-b border-border/50 dark:bg-[hsl(220,8%,8%)] dark:hover:bg-[hsl(220,8%,10%)] hover:bg-muted/30 ${isPageLoading ? 'opacity-50' : ''} ${onRowClick ? 'cursor-pointer' : ''}`}
    >
      {visibleColumns.map((column, index) => {
        // Status and orderType columns contain Badges - don't apply text-ellipsis
        const isNonTruncatable = column.id === 'status' || column.id === 'orderType'
        // Determine padding based on position and integrated mode
        const isFirst = index === 0
        const isLast = index === visibleColumns.length - 1
        let paddingClass = 'px-2'
        if (integratedHeader) {
          if (isFirst) paddingClass = 'pl-4 lg:pl-6 pr-2'
          else if (isLast) paddingClass = 'pl-2 pr-4 lg:pr-6'
        } else {
          if (isFirst) paddingClass = 'pl-[15px] pr-2'
        }
        return (
          <td
            key={column.id}
            style={{ width: getColumnWidth(column.id) }}
            className={`${paddingClass} align-middle overflow-hidden whitespace-nowrap ${isNonTruncatable ? '' : 'text-ellipsis'}`}
          >
            {cellRenderers[column.id]
              ? cellRenderers[column.id](row, column)
              : '-'}
          </td>
        )
      })}
    </tr>
  )
}) as <T>(props: TableRowProps<T>) => React.ReactElement

// ============================================
// COMPONENT
// ============================================

export function TransactionsTable<T>({
  config,
  data,
  cellRenderers,
  getRowKey,
  isLoading = false,
  isPageLoading = false,
  totalCount,
  pageIndex,
  pageSize,
  onPageChange,
  pageSizeOptions = [25, 50, 100, 200],
  userColumnVisibility = {},
  emptyMessage = "No data found.",
  itemName = "items",
  integratedHeader = false,
  onRowClick,
}: TransactionsTableProps<T>) {
  // Get responsive column visibility
  const {
    visibleColumns,
    columnWidths,
    hiddenByResponsive,
  } = useResponsiveTable({
    config,
    userColumnVisibility,
  })

  const totalPages = Math.ceil(totalCount / pageSize)

  // Helper to get column width
  const getColumnWidth = (columnId: string): string => {
    return columnWidths[columnId] || '10%'
  }

  return (
    <div className="flex flex-col h-full">
      {/* Scrollable table area */}
      <div className={`flex-1 overflow-y-auto min-h-0 ${integratedHeader ? '-mx-4 lg:-mx-6' : ''}`}>
        <div className={integratedHeader ? '' : ''}>
          <table style={{ tableLayout: 'fixed', width: '100%' }} className="text-sm">
            <colgroup>
              {visibleColumns.map((column) => (
                <col key={column.id} style={{ width: getColumnWidth(column.id) }} />
              ))}
            </colgroup>
            <thead className="sticky top-0 bg-[#fcfcfc] dark:bg-zinc-900 z-10">
              <tr className="h-11">
                {visibleColumns.map((column, index) => {
                  // Determine padding based on position and integrated mode
                  const isFirst = index === 0
                  const isLast = index === visibleColumns.length - 1
                  let paddingClass = 'px-2'
                  if (integratedHeader) {
                    if (isFirst) paddingClass = 'pl-4 lg:pl-6 pr-2'
                    else if (isLast) paddingClass = 'pl-2 pr-4 lg:pr-6'
                  } else {
                    if (isFirst) paddingClass = 'pl-[15px] pr-2'
                  }
                  return (
                    <th
                      key={column.id}
                      style={{ width: getColumnWidth(column.id) }}
                      className={`${paddingClass} text-left align-middle text-xs font-medium text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap`}
                    >
                      {column.header}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                // Loading skeleton rows
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={`loading-${i}`} className="h-12 dark:bg-[hsl(220,8%,8%)]">
                    {visibleColumns.map((column, colIndex) => {
                      const isFirst = colIndex === 0
                      const isLast = colIndex === visibleColumns.length - 1
                      let paddingClass = 'px-2'
                      if (integratedHeader) {
                        if (isFirst) paddingClass = 'pl-4 lg:pl-6 pr-2'
                        else if (isLast) paddingClass = 'pl-2 pr-4 lg:pr-6'
                      } else {
                        if (isFirst) paddingClass = 'pl-[15px] pr-2'
                      }
                      return (
                        <td
                          key={column.id}
                          style={{ width: getColumnWidth(column.id) }}
                          className={paddingClass}
                        >
                          <div className="h-4 w-full animate-pulse bg-muted/40 rounded" />
                        </td>
                      )
                    })}
                  </tr>
                ))
              ) : data.length > 0 ? (
                data.map((row) => (
                  <TableRowComponent
                    key={getRowKey(row)}
                    row={row}
                    rowKey={getRowKey(row)}
                    visibleColumns={visibleColumns}
                    cellRenderers={cellRenderers}
                    getColumnWidth={getColumnWidth}
                    isPageLoading={isPageLoading}
                    integratedHeader={integratedHeader}
                    onRowClick={onRowClick}
                  />
                ))
              ) : (
                <tr>
                  <td
                    colSpan={visibleColumns.length}
                    className="h-24 text-center"
                  >
                    {emptyMessage}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination - sticky at bottom */}
      <div className="flex-shrink-0 sticky bottom-0 bg-background py-3 -mx-4 px-4 lg:-mx-6 lg:px-6 flex items-center justify-between border-t border-border/40">
        <div className="flex items-center gap-4">
          <span className="text-sm text-muted-foreground">
            {data.length.toLocaleString()} of {totalCount.toLocaleString()} {itemName}
          </span>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows</span>
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => {
                onPageChange(0, Number(value))
              }}
            >
              <SelectTrigger className="h-7 w-[70px]">
                <SelectValue placeholder={pageSize} />
              </SelectTrigger>
              <SelectContent>
                {pageSizeOptions.map((size) => (
                  <SelectItem key={size} value={size.toString()}>
                    {size}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {/* Show indicator when columns are hidden by responsive */}
          {hiddenByResponsive.length > 0 && (
            <span className="text-xs text-muted-foreground">
              {hiddenByResponsive.length} column{hiddenByResponsive.length > 1 ? 's' : ''} hidden
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Page {pageIndex + 1} of {totalPages || 1}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onPageChange(0, pageSize)}
              disabled={pageIndex === 0}
            >
              <ChevronsLeftIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onPageChange(Math.max(0, pageIndex - 1), pageSize)}
              disabled={pageIndex === 0}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onPageChange(Math.min(totalPages - 1, pageIndex + 1), pageSize)}
              disabled={pageIndex >= totalPages - 1}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              onClick={() => onPageChange(totalPages - 1, pageSize)}
              disabled={pageIndex >= totalPages - 1}
            >
              <ChevronsRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============================================
// HELPER: Column Selector Integration
// ============================================

/**
 * Hook to manage column visibility state that integrates with TransactionsTable
 * Returns state and handlers that can be passed to both the column selector UI
 * and the TransactionsTable component
 */
export function useColumnSelector(config: TableConfig) {
  // Track user's explicit column visibility choices
  const [userColumnVisibility, setUserColumnVisibility] = React.useState<Record<string, boolean>>({})

  // Toggle a specific column's visibility
  const toggleColumn = React.useCallback((columnId: string) => {
    setUserColumnVisibility(prev => {
      const current = prev[columnId]
      const column = config.columns.find(c => c.id === columnId)
      const defaultVisible = column?.defaultVisible !== false

      // If not explicitly set, toggle from default
      if (current === undefined) {
        return { ...prev, [columnId]: !defaultVisible }
      }
      // Otherwise toggle from current
      return { ...prev, [columnId]: !current }
    })
  }, [config.columns])

  // Check if a column is currently visible (considering both user choice and default)
  const isColumnVisible = React.useCallback((columnId: string) => {
    const userSetting = userColumnVisibility[columnId]
    if (userSetting !== undefined) return userSetting
    const column = config.columns.find(c => c.id === columnId)
    return column?.defaultVisible !== false
  }, [userColumnVisibility, config.columns])

  // Reset all columns to default visibility
  const resetToDefaults = React.useCallback(() => {
    setUserColumnVisibility({})
  }, [])

  return {
    userColumnVisibility,
    toggleColumn,
    isColumnVisible,
    resetToDefaults,
    // All columns for building the selector UI
    allColumns: config.columns,
  }
}
