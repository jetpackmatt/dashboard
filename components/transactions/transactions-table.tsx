"use client"

import * as React from "react"
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
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
import { useResponsiveTable, useColumnOrder } from "@/hooks/use-responsive-table"
import {
  DndContext,
  DragOverlay,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core"
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable"

// ============================================
// TYPES
// ============================================

// Cell renderer function type - receives the row data and column config
export type CellRenderer<T> = (row: T, column: ColumnConfig) => React.ReactNode

// Prefix column config - for special columns like client badge that sit outside normal column system
export interface PrefixColumn<T> {
  width: string        // Fixed width (e.g., "28px")
  render: (row: T) => React.ReactNode
}

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

  // Optional prefix column (e.g., client badge) - sits before all data columns
  // Not part of column config system (no column selector, responsive hiding, etc.)
  prefixColumn?: PrefixColumn<T>

  // Sorting - when provided, sortable columns become clickable
  sortField?: string
  sortDirection?: 'asc' | 'desc'
  onSortChange?: (field: string, direction: 'asc' | 'desc') => void

  // Column reordering - when provided, headers become draggable
  columnOrder?: string[]
  onColumnOrderChange?: (order: string[]) => void
}

// ============================================
// MEMOIZED TABLE ROW COMPONENT
// ============================================

interface TableRowProps<T> {
  row: T
  rowKey: string
  visibleColumns: ColumnConfig[]
  cellRenderers: Record<string, CellRenderer<T>>
  isPageLoading: boolean
  integratedHeader?: boolean
  onRowClick?: (row: T) => void
  prefixColumn?: PrefixColumn<T>
}

// Generic memoized row component to prevent unnecessary re-renders
const TableRowComponent = React.memo(function TableRowInner<T>({
  row,
  rowKey,
  visibleColumns,
  cellRenderers,
  isPageLoading,
  integratedHeader = false,
  onRowClick,
  prefixColumn,
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
      className={`h-[45px] border-b border-border/50 dark:bg-[hsl(220,8%,8%)] dark:hover:bg-[hsl(220,8%,10%)] hover:bg-muted/30 ${isPageLoading ? 'opacity-50' : ''} ${onRowClick ? 'cursor-pointer' : ''}`}
    >
      {/* Prefix column (e.g., client badge) - tint if first data column is tinted */}
      {prefixColumn && (
        <td
          className={`w-px whitespace-nowrap align-middle ${integratedHeader ? 'pl-4 lg:pl-6 pr-2' : 'pl-[15px] pr-2'} ${visibleColumns[0]?.tinted ? 'bg-muted/35 dark:bg-zinc-800/40' : ''}`}
        >
          {prefixColumn.render(row)}
        </td>
      )}
      {visibleColumns.map((column, index) => {
        // Status and orderType columns contain Badges - don't apply text-ellipsis
        const isNonTruncatable = column.id === 'status' || column.id === 'orderType' || column.id === 'actions'
        // Determine padding based on position and integrated mode
        // When prefix column exists, first data column is no longer "first" for padding
        const isFirst = index === 0 && !prefixColumn
        const isLast = index === visibleColumns.length - 1
        let paddingClass = 'px-2'
        if (integratedHeader) {
          if (isFirst) paddingClass = 'pl-4 lg:pl-6 pr-2'
          else if (isLast) paddingClass = 'pl-2 pr-4 lg:pr-6'
          else if (column.extraPaddingLeft) paddingClass = 'pl-4 pr-2'
        } else {
          if (isFirst) paddingClass = 'pl-[15px] pr-2'
          else if (column.extraPaddingLeft) paddingClass = 'pl-4 pr-2'
        }
        // Text alignment from column config
        const alignClass = column.align === 'center' ? 'text-center' : column.align === 'right' ? 'text-right' : 'text-left'
        // Divider after this column
        const dividerClass = column.dividerAfter ? 'border-r border-border/50' : ''
        const shrinkClass = column.shrinkToFit ? 'w-px' : ''
        const tintClass = column.tinted ? 'bg-muted/35 dark:bg-zinc-800/40' : ''
        return (
          <td
            key={column.id}
            style={column.maxWidth ? { maxWidth: column.maxWidth } : undefined}
            className={`${paddingClass} ${alignClass} ${dividerClass} ${shrinkClass} ${tintClass} align-middle overflow-hidden whitespace-nowrap ${isNonTruncatable ? '' : 'text-ellipsis'}`}
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
// SORTABLE HEADER CELL (for drag-to-reorder)
// ============================================

interface SortableHeaderProps {
  column: ColumnConfig
  index: number
  totalColumns: number
  hasPrefixColumn: boolean
  integratedHeader: boolean
  isSortable: boolean
  isActiveSort: boolean
  sortDirection?: 'asc' | 'desc'
  handleSort: (id: string) => void
  isDndEnabled: boolean
}

function SortableHeader({
  column,
  index,
  totalColumns,
  hasPrefixColumn,
  integratedHeader,
  isSortable,
  isActiveSort,
  sortDirection,
  handleSort,
  isDndEnabled,
}: SortableHeaderProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useSortable({ id: column.id, disabled: !isDndEnabled })

  const isFirst = index === 0 && !hasPrefixColumn
  const isLast = index === totalColumns - 1
  let paddingClass = 'px-2'
  if (integratedHeader) {
    if (isFirst) paddingClass = 'pl-4 lg:pl-6 pr-2'
    else if (isLast) paddingClass = 'pl-2 pr-4 lg:pr-6'
    else if (column.extraPaddingLeft) paddingClass = 'pl-4 pr-2'
  } else {
    if (isFirst) paddingClass = 'pl-[15px] pr-2'
    else if (column.extraPaddingLeft) paddingClass = 'pl-4 pr-2'
  }
  const headerAlignClass = column.align === 'center' ? 'text-center' : 'text-left'
  const cursorClass = isSortable
    ? 'cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors'
    : isDndEnabled ? 'cursor-grab' : ''

  const shrinkClass = column.shrinkToFit ? 'w-px' : ''

  return (
    <th
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0.4 : 1, maxWidth: column.maxWidth || undefined }}
      className={`group/th ${paddingClass} ${headerAlignClass} ${shrinkClass} align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide overflow-hidden text-ellipsis whitespace-nowrap ${cursorClass}`}
      onClick={isSortable ? () => handleSort(column.id) : undefined}
    >
      {isSortable ? (
        <span className={`inline-flex items-center gap-0.5 ${column.align === 'center' ? 'justify-center' : ''}`}>
          {column.header}
          {isActiveSort ? (
            sortDirection === 'asc'
              ? <ChevronUpIcon className="h-3 w-3 flex-shrink-0 text-foreground" />
              : <ChevronDownIcon className="h-3 w-3 flex-shrink-0 text-foreground" />
          ) : (
            <ChevronDownIcon className="h-3 w-3 flex-shrink-0 opacity-0 group-hover/th:opacity-40 transition-opacity" />
          )}
        </span>
      ) : (
        column.header
      )}
    </th>
  )
}

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
  prefixColumn,
  sortField,
  sortDirection,
  onSortChange,
  columnOrder,
  onColumnOrderChange,
}: TransactionsTableProps<T>) {
  // Get responsive column visibility
  const {
    visibleColumns,
    hiddenByResponsive,
  } = useResponsiveTable({
    config,
    userColumnVisibility,
  })

  // Apply custom column order (if user has reordered via drag)
  const orderedColumns = useColumnOrder(config, visibleColumns, columnOrder)

  const totalPages = Math.ceil(totalCount / pageSize)

  // Sort handler - toggle direction on same column, default desc on new column
  const handleSort = (columnId: string) => {
    if (!onSortChange) return
    if (sortField === columnId) {
      onSortChange(columnId, sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      onSortChange(columnId, 'desc')
    }
  }

  // DnD state and handlers
  const isDndEnabled = !!onColumnOrderChange
  const [activeId, setActiveId] = React.useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )
  const activeColumn = activeId ? orderedColumns.find(c => c.id === activeId) : null

  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string)
  }, [])

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    setActiveId(null)
    const { active, over } = event
    if (over && active.id !== over.id && onColumnOrderChange) {
      const currentIds = orderedColumns.map(c => c.id)
      const oldIndex = currentIds.indexOf(active.id as string)
      const newIndex = currentIds.indexOf(over.id as string)
      onColumnOrderChange(arrayMove(currentIds, oldIndex, newIndex))
    }
  }, [orderedColumns, onColumnOrderChange])

  const columnIds = React.useMemo(() => orderedColumns.map(c => c.id), [orderedColumns])

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
    <div className="flex flex-col h-full">
      {/* Scrollable table area */}
      <div className={`flex-1 overflow-y-auto overflow-x-hidden min-h-0 ${integratedHeader ? '-mx-4 lg:-mx-6' : ''}`}>
        <div className={integratedHeader ? '' : ''}>
          <table style={{ tableLayout: 'auto', width: '100%' }} className="text-[13px] font-roboto">
            {/* Proportional width hints from config - guides auto layout distribution */}
            {(() => {
              const prefixWidth = prefixColumn ? 8 : 0
              const totalWidth = prefixWidth + orderedColumns.reduce((sum, c) => sum + (c.shrinkToFit ? 0 : c.width), 0)
              return totalWidth > 0 ? (
                <colgroup>
                  {prefixColumn && <col style={{ width: `${(prefixWidth / totalWidth * 100).toFixed(1)}%` }} />}
                  {orderedColumns.map(c => (
                    <col key={c.id} style={c.shrinkToFit ? { width: '0px' } : { width: `${(c.width / totalWidth * 100).toFixed(1)}%` }} />
                  ))}
                </colgroup>
              ) : null
            })()}
            <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
            <thead className="sticky top-0 bg-surface dark:bg-zinc-900 z-10">
              <tr className="h-[45px] bg-muted/60 dark:bg-zinc-900/60">
                {/* Prefix column header (empty) */}
                {prefixColumn && (
                  <th
                    className={`align-middle ${integratedHeader ? 'pl-4 lg:pl-6 pr-2' : 'pl-[15px] pr-2'}`}
                  />
                )}
                {orderedColumns.map((column, index) => (
                  <SortableHeader
                    key={column.id}
                    column={column}
                    index={index}
                    totalColumns={orderedColumns.length}
                    hasPrefixColumn={!!prefixColumn}
                    integratedHeader={integratedHeader}
                    isSortable={!!(column.sortable && onSortChange)}
                    isActiveSort={sortField === column.id}
                    sortDirection={sortDirection}
                    handleSort={handleSort}
                    isDndEnabled={isDndEnabled}
                  />
                ))}
              </tr>
            </thead>
            </SortableContext>
            <tbody>
              {isLoading ? (
                // Loading skeleton rows
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={`loading-${i}`} className="h-[45px] dark:bg-[hsl(220,8%,8%)]">
                    {/* Prefix column skeleton (empty - badge not shown during loading) */}
                    {prefixColumn && (
                      <td
                        className={`w-px whitespace-nowrap ${integratedHeader ? 'pl-4 lg:pl-6 pr-2' : 'pl-[15px] pr-2'} ${orderedColumns[0]?.tinted ? 'bg-muted/35 dark:bg-zinc-800/40' : ''}`}
                      />
                    )}
                    {orderedColumns.map((column, colIndex) => {
                      const isFirst = colIndex === 0 && !prefixColumn
                      const isLast = colIndex === orderedColumns.length - 1
                      let paddingClass = 'px-2'
                      if (integratedHeader) {
                        if (isFirst) paddingClass = 'pl-4 lg:pl-6 pr-2'
                        else if (isLast) paddingClass = 'pl-2 pr-4 lg:pr-6'
                        else if (column.extraPaddingLeft) paddingClass = 'pl-4 pr-2'
                      } else {
                        if (isFirst) paddingClass = 'pl-[15px] pr-2'
                        else if (column.extraPaddingLeft) paddingClass = 'pl-4 pr-2'
                      }
                      const dividerClass = column.dividerAfter ? 'border-r border-border/50' : ''
                      const skelTintClass = column.tinted ? 'bg-muted/35 dark:bg-zinc-800/40' : ''
                      return (
                        <td
                          key={column.id}
                          className={`${paddingClass} ${dividerClass} ${skelTintClass}`}
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
                    visibleColumns={orderedColumns}
                    cellRenderers={cellRenderers}
                    isPageLoading={isPageLoading}
                    integratedHeader={integratedHeader}
                    onRowClick={onRowClick}
                    prefixColumn={prefixColumn}
                  />
                ))
              ) : (
                <tr>
                  <td
                    colSpan={orderedColumns.length + (prefixColumn ? 1 : 0)}
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
    <DragOverlay dropAnimation={null}>
      {activeColumn ? (
        <div className="px-2 py-2 bg-surface dark:bg-zinc-800 border border-border/50 rounded shadow-md text-[10px] font-medium text-zinc-500 uppercase tracking-wide whitespace-nowrap">
          {activeColumn.header}
        </div>
      ) : null}
    </DragOverlay>
    </DndContext>
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
