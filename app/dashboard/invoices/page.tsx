"use client"

import * as React from "react"
import {
  FileTextIcon,
  FileSpreadsheetIcon,
  ColumnsIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  Download,
  XIcon,
} from "lucide-react"

import { SiteHeader } from "@/components/site-header"
import { JetpackLoader } from "@/components/jetpack-loader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { MultiSelectFilter } from "@/components/ui/multi-select-filter"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { INVOICES_TABLE_CONFIG, getRedistributedWidths } from "@/lib/table-config"
import { useClient } from "@/components/client-context"
import { InlineDateRangePicker } from "@/components/ui/inline-date-range-picker"
import { DateRange } from "react-day-picker"
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
import { useTablePreferences } from "@/hooks/use-table-preferences"
import { useColumnOrder } from "@/hooks/use-responsive-table"

// Date range preset types - matches Transactions page
type DateRangePreset = 'today' | '7d' | '30d' | '60d' | 'mtd' | 'ytd' | 'all' | 'custom'

const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '60d', label: '60D' },
  { value: 'mtd', label: 'MTD' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All' },
  { value: 'custom', label: 'Custom' },
]

function getDateRangeFromPreset(preset: DateRangePreset): { from: Date; to: Date } | null {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case '7d': {
      const sevenDaysAgo = new Date(today)
      sevenDaysAgo.setDate(today.getDate() - 6)
      return { from: sevenDaysAgo, to: today }
    }
    case '30d': {
      const thirtyDaysAgo = new Date(today)
      thirtyDaysAgo.setDate(today.getDate() - 29)
      return { from: thirtyDaysAgo, to: today }
    }
    case '60d': {
      const sixtyDaysAgo = new Date(today)
      sixtyDaysAgo.setDate(today.getDate() - 59)
      return { from: sixtyDaysAgo, to: today }
    }
    case 'mtd': {
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: monthStart, to: today }
    }
    case 'ytd': {
      const yearStart = new Date(today.getFullYear(), 0, 1)
      return { from: yearStart, to: today }
    }
    case 'all':
      return null
    case 'custom':
      return null
    default:
      return null
  }
}

interface Client {
  id: string
  company_name: string
  short_code?: string | null
}

interface Invoice {
  id: string
  client_id: string
  invoice_number: string
  invoice_date: string
  period_start: string
  period_end: string
  subtotal: number
  total_markup: number
  total_amount: number
  status: string
  paid_status: 'unpaid' | 'paid'
  generated_at: string
  approved_at: string | null
  version: number
  pdf_path: string | null
  xlsx_path: string | null
  shipment_count?: number | null
  transaction_count?: number | null
  client?: Client
}

/**
 * Format a date string as a fixed date without timezone conversion.
 */
function formatDateFixed(dateStr: string): React.ReactNode {
  if (!dateStr) return <span className="text-muted-foreground">-</span>
  const datePart = dateStr.split('T')[0]
  const [year, month, day] = datePart.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year}`
}

/**
 * Format billing period as a compact range.
 * Same month: "Jan 6 – 12"
 * Different months: "Jan 6 – Feb 12"
 */
function formatBillingPeriod(start: string, end: string): React.ReactNode {
  if (!start || !end) return <span className="text-muted-foreground">-</span>
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  const [sYear, sMonth, sDay] = start.split('T')[0].split('-')
  const [eYear, eMonth, eDay] = end.split('T')[0].split('-')
  const sM = months[parseInt(sMonth) - 1]
  const eM = months[parseInt(eMonth) - 1]
  const sD = parseInt(sDay)
  const eD = parseInt(eDay)

  if (sYear === eYear && sMonth === eMonth) {
    return `${sM} ${sD} – ${sM} ${eD}`
  }
  return `${sM} ${sD} – ${eM} ${eD}`
}

// Color schemes for client badges - matches ClientBadge component
const colorSchemes = [
  { badge: "bg-blue-500/15 text-blue-700 dark:text-blue-400", tooltip: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
  { badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400", tooltip: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  { badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400", tooltip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" },
  { badge: "bg-rose-500/15 text-rose-700 dark:text-rose-400", tooltip: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300 border-rose-200 dark:border-rose-800" },
  { badge: "bg-purple-500/15 text-purple-700 dark:text-purple-400", tooltip: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 border-purple-200 dark:border-purple-800" },
  { badge: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400", tooltip: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800" },
  { badge: "bg-orange-500/15 text-orange-700 dark:text-orange-400", tooltip: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 border-orange-200 dark:border-orange-800" },
  { badge: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400", tooltip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800" },
]

// SortableHeader component for drag-to-reorder columns
interface SortableHeaderProps {
  columnId: string
  children: React.ReactNode
  className?: string
  onClick?: () => void
}

function SortableHeader({ columnId, children, className, onClick }: SortableHeaderProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useSortable({ id: columnId })

  return (
    <th
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      className={cn(className, "cursor-grab active:cursor-grabbing")}
      style={{ opacity: isDragging ? 0.4 : 1 }}
      onClick={onClick}
    >
      {children}
    </th>
  )
}

export default function InvoicesPage() {
  const { selectedClientId, effectiveIsAdmin, clients } = useClient()

  const [invoices, setInvoices] = React.useState<Invoice[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [statusFilter, setStatusFilter] = React.useState<string[]>([])
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined)
  const [datePreset, setDatePreset] = React.useState<DateRangePreset>('all')

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)

  // Column visibility state
  const DEFAULT_INVOICE_COLUMNS = React.useMemo(() => ({
    client: true,
    invoiceNumber: true,
    billingPeriod: true,
    invoiceDate: true,
    cost: true,
    profit: true,
    shipments: true,
    transactions: false,
    amount: true,
    status: true,
    download: true,
  }), [])
  const [columnVisibility, setColumnVisibility] = React.useState({
    client: true,
    invoiceNumber: true,
    billingPeriod: true,
    invoiceDate: true,
    cost: true,
    profit: true,
    shipments: true,
    transactions: false,
    amount: true,
    status: true,
    download: true,
  })

  // Load preferences from localStorage (column visibility, column order, page size)
  const invoicesPrefs = useTablePreferences('invoices', 50)

  // Define which columns are draggable (exclude client/download - they stay fixed)
  const draggableColumnIds = ['invoiceNumber', 'billingPeriod', 'invoiceDate', 'cost', 'profit', 'shipments', 'transactions', 'amount', 'status']
  const draggableColumns = INVOICES_TABLE_CONFIG.columns.filter(c => draggableColumnIds.includes(c.id))

  // Apply user's drag order to draggable columns
  const orderedDraggableColumns = useColumnOrder(
    INVOICES_TABLE_CONFIG,
    draggableColumns,
    invoicesPrefs.columnOrder
  )

  // DnD state
  const [activeColumnId, setActiveColumnId] = React.useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )
  const activeColumn = activeColumnId
    ? INVOICES_TABLE_CONFIG.columns.find(c => c.id === activeColumnId)
    : null

  // Drag handlers
  const handleDragStart = React.useCallback((event: DragStartEvent) => {
    setActiveColumnId(event.active.id as string)
  }, [])

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    setActiveColumnId(null)
    const { active, over } = event

    if (over && active.id !== over.id) {
      const currentIds = orderedDraggableColumns.map(c => c.id)
      const oldIndex = currentIds.indexOf(active.id as string)
      const newIndex = currentIds.indexOf(over.id as string)

      if (oldIndex !== -1 && newIndex !== -1) {
        invoicesPrefs.setColumnOrder(arrayMove(currentIds, oldIndex, newIndex))
      }
    }
  }, [orderedDraggableColumns, invoicesPrefs])

  // Fetch invoices
  React.useEffect(() => {
    async function fetchInvoices() {
      setIsLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams()
        if (selectedClientId) {
          params.set('client_id', selectedClientId)
        }
        const response = await fetch(`/api/invoices?${params}`)
        if (!response.ok) throw new Error('Failed to fetch invoices')
        const data = await response.json()
        setInvoices(data.invoices || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load invoices')
      } finally {
        setIsLoading(false)
      }
    }
    fetchInvoices()
  }, [selectedClientId])

  // Reset to first page when client selection changes
  React.useEffect(() => {
    setCurrentPage(0)
  }, [selectedClientId])

  const formatCurrency = (amount: number) => {
    return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  async function handleDownloadFile(invoiceNumber: string, fileType: 'pdf' | 'xlsx') {
    try {
      const response = await fetch(`/api/invoices/${invoiceNumber}/files`)
      if (!response.ok) throw new Error('Failed to get file URL')
      const data = await response.json()

      const url = fileType === 'pdf' ? data.pdfUrl : data.xlsUrl
      if (!url) {
        throw new Error(`${fileType.toUpperCase()} file not available`)
      }

      window.open(url, '_blank')
    } catch (err) {
      console.error('Error downloading file:', err)
      setError(err instanceof Error ? err.message : 'Failed to download file')
    }
  }

  // Filter invoices by date range and status
  const filteredInvoices = React.useMemo(() => {
    return invoices.filter(invoice => {
      // Date range filter
      if (dateRange?.from || dateRange?.to) {
        const invoiceDate = new Date(invoice.invoice_date.split('T')[0])
        if (dateRange?.from && invoiceDate < dateRange.from) return false
        if (dateRange?.to && invoiceDate > dateRange.to) return false
      }
      // Status filter
      if (statusFilter.length > 0 && !statusFilter.includes(invoice.paid_status)) return false
      return true
    })
  }, [invoices, dateRange, statusFilter])

  // Pagination logic
  const totalCount = filteredInvoices.length
  const totalPages = Math.ceil(totalCount / pageSize)
  const startIndex = currentPage * pageSize
  const endIndex = startIndex + pageSize
  const paginatedInvoices = filteredInvoices.slice(startIndex, endIndex)

  // Determine if we should show the client column (admin viewing "All Brands")
  const showClientColumn = effectiveIsAdmin && !selectedClientId

  // Determine if we should show cost/profit breakdown (admin only)
  const showCostBreakdown = effectiveIsAdmin

  // Column selector quota — only count columns that appear in the dropdown
  const invoiceToggleableKeys = React.useMemo(() => {
    const keys: (keyof typeof columnVisibility)[] = []
    if (showClientColumn) keys.push('client')
    keys.push('invoiceNumber', 'billingPeriod', 'invoiceDate')
    if (showCostBreakdown) keys.push('cost', 'profit')
    keys.push('shipments', 'transactions', 'amount', 'status', 'download')
    return keys
  }, [showClientColumn, showCostBreakdown])
  const enabledInvoiceColumnCount = invoiceToggleableKeys.filter(k => columnVisibility[k]).length
  const totalInvoiceColumnCount = invoiceToggleableKeys.length
  const hasInvoiceColumnCustomizations = invoiceToggleableKeys.some(k => columnVisibility[k] !== DEFAULT_INVOICE_COLUMNS[k])

  // Calculate column widths using the standardized config system (with ordered draggable columns)
  const columnWidths = React.useMemo(() => {
    // Build list of visible column configs IN DISPLAY ORDER
    // Fixed client column first, then ordered draggable columns, then fixed download column
    const visibleColumns = [
      // Fixed client column (left side)
      ...(showClientColumn && columnVisibility.client
        ? [INVOICES_TABLE_CONFIG.columns.find(c => c.id === 'client')!]
        : []),
      // Ordered draggable columns (middle)
      ...orderedDraggableColumns.filter(col => {
        // Check visibility and admin-only constraints
        if (col.id === 'cost' || col.id === 'profit') {
          return showCostBreakdown && columnVisibility[col.id as keyof typeof columnVisibility]
        }
        return columnVisibility[col.id as keyof typeof columnVisibility]
      }),
      // Fixed download column (right side)
      ...(columnVisibility.download
        ? [INVOICES_TABLE_CONFIG.columns.find(c => c.id === 'download')!]
        : []),
    ].filter(Boolean)

    const redistributed = getRedistributedWidths(visibleColumns)
    const widths: Record<string, string> = {}
    for (const [id, width] of Object.entries(redistributed)) {
      widths[id] = `${width}%`
    }
    return widths
  }, [orderedDraggableColumns, showClientColumn, showCostBreakdown, columnVisibility])

  // Helper to get client badge color based on client index
  const getClientBadgeColor = (clientId: string) => {
    const clientIndex = clients.findIndex(c => c.id === clientId)
    if (clientIndex === -1) return colorSchemes[0]
    return colorSchemes[clientIndex % colorSchemes.length]
  }


  if (isLoading) {
    return (
      <>
        <SiteHeader sectionName="Invoices" />
        <div className="flex flex-1 items-center justify-center">
          <JetpackLoader size="lg" />
        </div>
      </>
    )
  }

  return (
    <>
      <SiteHeader sectionName="Invoices" />
      <div className="flex flex-1 flex-col overflow-x-hidden bg-background rounded-t-xl">
        <div className="@container/main flex flex-col w-full h-[calc(100vh-64px)] px-6 lg:px-8">
          {/* Sticky header with filters */}
          <div className="sticky top-0 z-20 -mx-6 lg:-mx-8 mb-3 bg-muted/60 dark:bg-zinc-900/60 rounded-t-xl font-inter text-xs">
            <div className="px-6 lg:px-8 py-3 flex flex-col gap-4">
              {error && (
                <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
                  {error}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="ml-2"
                    onClick={() => setError(null)}
                  >
                    Dismiss
                  </Button>
                </div>
              )}

              {/* Date Range Filter and Action Buttons */}
              <div className="flex items-center justify-between gap-4">
              {/* Date Range - Preset dropdown + Inline date range picker (shown only for Custom) */}
              <div className="flex items-center gap-1.5">
                <Select
                  value={datePreset || 'all'}
                  onValueChange={(value) => {
                    if (value) {
                      const preset = value as DateRangePreset
                      setDatePreset(preset)
                      if (preset === 'custom') {
                        setDateRange(undefined)
                      } else {
                        const range = getDateRangeFromPreset(preset)
                        if (range) {
                          setDateRange({ from: range.from, to: range.to })
                        } else {
                          setDateRange(undefined)
                        }
                      }
                      setCurrentPage(0)
                    }
                  }}
                >
                  <SelectTrigger className="h-[30px] w-auto gap-1.5 text-xs text-foreground bg-background">
                    <SelectValue>
                      {DATE_RANGE_PRESETS.find(p => p.value === datePreset)?.label || 'All'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent align="start" className="font-inter text-xs">
                    {DATE_RANGE_PRESETS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                {datePreset === 'custom' && (
                  <InlineDateRangePicker
                    dateRange={dateRange}
                    onDateRangeChange={(range) => {
                      setDateRange(range)
                      setCurrentPage(0)
                    }}
                    autoOpen
                  />
                )}
              </div>

              {/* Filters + Action buttons */}
              <div className="flex items-center gap-1.5 md:gap-2">
                <MultiSelectFilter
                  options={[
                    { value: 'paid', label: 'Paid' },
                    { value: 'unpaid', label: 'Unpaid' },
                  ]}
                  selected={statusFilter}
                  onSelectionChange={(values) => { setStatusFilter(values); setCurrentPage(0) }}
                  placeholder="Status"
                  className="w-[110px]"
                />

                {statusFilter.length > 0 && (
                  <button
                    onClick={() => { setStatusFilter([]); setCurrentPage(0) }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    title="Clear filters"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                )}

                {/* Columns button */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="h-[30px] flex-shrink-0 items-center text-muted-foreground">
                      <ColumnsIcon className="h-4 w-4" />
                      <span className="ml-[3px] text-xs hidden lg:inline leading-none">
                        ({enabledInvoiceColumnCount}/{totalInvoiceColumnCount})
                      </span>
                      <ChevronDownIcon className="h-4 w-4 lg:ml-1" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-1 flex items-center justify-between">
                      <span>{enabledInvoiceColumnCount} of {totalInvoiceColumnCount} columns</span>
                      {hasInvoiceColumnCustomizations && (
                        <button
                          onClick={() => setColumnVisibility(DEFAULT_INVOICE_COLUMNS)}
                          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Reset
                        </button>
                      )}
                    </div>
                    {showClientColumn && (
                      <DropdownMenuCheckboxItem
                        checked={columnVisibility.client}
                        onCheckedChange={(value) =>
                          setColumnVisibility({ ...columnVisibility, client: value })
                        }
                      >
                        Brand
                      </DropdownMenuCheckboxItem>
                    )}
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.invoiceNumber}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, invoiceNumber: value })
                      }
                    >
                      Invoice #
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.billingPeriod}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, billingPeriod: value })
                      }
                    >
                      Period
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.invoiceDate}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, invoiceDate: value })
                      }
                    >
                      Invoice Date
                    </DropdownMenuCheckboxItem>
                    {showCostBreakdown && (
                      <>
                        <DropdownMenuCheckboxItem
                          checked={columnVisibility.cost}
                          onCheckedChange={(value) =>
                            setColumnVisibility({ ...columnVisibility, cost: value })
                          }
                        >
                          Cost
                        </DropdownMenuCheckboxItem>
                        <DropdownMenuCheckboxItem
                          checked={columnVisibility.profit}
                          onCheckedChange={(value) =>
                            setColumnVisibility({ ...columnVisibility, profit: value })
                          }
                        >
                          Profit
                        </DropdownMenuCheckboxItem>
                      </>
                    )}
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.shipments}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, shipments: value })
                      }
                    >
                      Shipments
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.transactions}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, transactions: value })
                      }
                    >
                      Transactions
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.amount}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, amount: value })
                      }
                    >
                      Total
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.status}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, status: value })
                      }
                    >
                      Status
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.download}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, download: value })
                      }
                    >
                      Download
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              </div>
            </div>
          </div>

          {/* Scrollable table area */}
          <div className="relative flex flex-col flex-1 min-h-0 overflow-y-auto -mx-6 lg:-mx-8">
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <table style={{ tableLayout: 'fixed', width: '100%' }} className="text-xs font-inter">
              <colgroup>
                {/* Fixed client column */}
                {showClientColumn && columnVisibility.client && <col style={{ width: columnWidths.client }} />}
                {/* Draggable columns in orderedDraggableColumns order */}
                {orderedDraggableColumns.map(col => {
                  // Check visibility and admin-only constraints
                  if (col.id === 'cost' || col.id === 'profit') {
                    if (!showCostBreakdown || !columnVisibility[col.id as keyof typeof columnVisibility]) return null
                  } else {
                    if (!columnVisibility[col.id as keyof typeof columnVisibility]) return null
                  }
                  if (!columnWidths[col.id]) return null
                  return <col key={col.id} style={{ width: columnWidths[col.id] }} />
                })}
                {/* Fixed download column */}
                {columnVisibility.download && <col style={{ width: columnWidths.download }} />}
              </colgroup>
              <thead className="sticky top-0 z-10 bg-surface dark:bg-zinc-900">
                <SortableContext
                  items={orderedDraggableColumns.map(c => c.id)}
                  strategy={horizontalListSortingStrategy}
                >
                  <tr className="h-11">
                    {/* Fixed client column - NOT wrapped in SortableHeader */}
                    {showClientColumn && columnVisibility.client && (
                      <th className="pl-6 lg:pl-8 pr-2 text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide" />
                    )}

                    {/* Draggable columns - render in orderedDraggableColumns order */}
                    {orderedDraggableColumns.map(col => {
                      // Check visibility and admin-only constraints
                      if (col.id === 'cost' || col.id === 'profit') {
                        if (!showCostBreakdown || !columnVisibility[col.id as keyof typeof columnVisibility]) return null
                      } else {
                        if (!columnVisibility[col.id as keyof typeof columnVisibility]) return null
                      }

                      // Determine if this is first column for padding
                      const isFirstColumn = !(showClientColumn && columnVisibility.client)

                      // Get alignment from config
                      const align = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'

                      return (
                        <SortableHeader
                          key={col.id}
                          columnId={col.id}
                          className={cn(
                            "align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide",
                            align,
                            isFirstColumn && col.id === orderedDraggableColumns[0].id ? 'pl-6 lg:pl-8 pr-2' : 'px-2'
                          )}
                        >
                          {col.header}
                        </SortableHeader>
                      )
                    })}

                    {/* Fixed download column - NOT wrapped in SortableHeader */}
                    {columnVisibility.download && (
                      <th className="px-2 pr-6 lg:pr-8 text-center align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide" />
                    )}
                  </tr>
                </SortableContext>
              </thead>
              <tbody>
                    {paginatedInvoices.length === 0 ? (
                      <tr>
                        <td
                          colSpan={10}
                          className="h-24 text-center text-muted-foreground"
                        >
                          No invoices found.
                        </td>
                      </tr>
                    ) : (
                      paginatedInvoices.map((invoice) => {
                        const colors = getClientBadgeColor(invoice.client_id)
                        const shortCode = invoice.client?.short_code || invoice.client?.company_name?.substring(0, 2).toUpperCase() || '??'

                        return (
                          <tr
                            key={invoice.id}
                            className="h-10 border-b border-border/50 dark:bg-[hsl(220,8%,8%)] dark:hover:bg-[hsl(220,8%,10%)] hover:bg-muted/50"
                          >
                            {showClientColumn && columnVisibility.client && (
                              <td className="pl-6 lg:pl-8 pr-2 align-middle">
                                <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span
                                        className={`inline-flex items-center justify-center w-6 h-5 text-[10px] font-semibold rounded ${colors.badge} cursor-default shrink-0`}
                                      >
                                        {shortCode}
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent side="right" className={`font-medium ${colors.tooltip}`}>
                                      {invoice.client?.company_name || 'Unknown'}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              </td>
                            )}

                            {/* Draggable columns in orderedDraggableColumns order */}
                            {orderedDraggableColumns.map(col => {
                              // Check visibility and admin-only constraints
                              if (col.id === 'cost' || col.id === 'profit') {
                                if (!showCostBreakdown || !columnVisibility[col.id as keyof typeof columnVisibility]) return null
                              } else {
                                if (!columnVisibility[col.id as keyof typeof columnVisibility]) return null
                              }

                              const isFirstColumn = !(showClientColumn && columnVisibility.client)
                              const align = col.align === 'right' ? 'text-right' : col.align === 'center' ? 'text-center' : 'text-left'

                              if (col.id === 'invoiceNumber') {
                                return (
                                  <td key={col.id} className={`${isFirstColumn && col.id === orderedDraggableColumns[0].id ? 'pl-6 lg:pl-8 pr-2' : 'px-2'} align-middle`}>
                                    {invoice.invoice_number}
                                  </td>
                                )
                              }

                              if (col.id === 'billingPeriod') {
                                return (
                                  <td key={col.id} className="px-2 text-left align-middle whitespace-nowrap">
                                    {formatBillingPeriod(invoice.period_start, invoice.period_end)}
                                  </td>
                                )
                              }

                              if (col.id === 'invoiceDate') {
                                return (
                                  <td key={col.id} className="px-2 text-left align-middle whitespace-nowrap">
                                    {formatDateFixed(invoice.invoice_date)}
                                  </td>
                                )
                              }

                              if (col.id === 'cost') {
                                return (
                                  <td key={col.id} className="px-2 text-right align-middle tabular-nums whitespace-nowrap">
                                    {formatCurrency(invoice.subtotal)}
                                  </td>
                                )
                              }

                              if (col.id === 'profit') {
                                return (
                                  <td key={col.id} className="px-2 text-right align-middle tabular-nums whitespace-nowrap text-emerald-600 dark:text-emerald-500">
                                    +{formatCurrency(invoice.total_markup)}
                                  </td>
                                )
                              }

                              if (col.id === 'shipments') {
                                return (
                                  <td key={col.id} className="px-2 text-right align-middle tabular-nums whitespace-nowrap text-muted-foreground">
                                    {invoice.shipment_count != null
                                      ? invoice.shipment_count.toLocaleString()
                                      : <span className="text-muted-foreground">-</span>
                                    }
                                  </td>
                                )
                              }

                              if (col.id === 'transactions') {
                                return (
                                  <td key={col.id} className="px-2 text-right align-middle tabular-nums whitespace-nowrap text-muted-foreground">
                                    {invoice.transaction_count != null
                                      ? invoice.transaction_count.toLocaleString()
                                      : <span className="text-muted-foreground">-</span>
                                    }
                                  </td>
                                )
                              }

                              if (col.id === 'amount') {
                                return (
                                  <td key={col.id} className="px-2 text-right align-middle tabular-nums whitespace-nowrap font-semibold">
                                    {formatCurrency(invoice.total_amount)}
                                  </td>
                                )
                              }

                              if (col.id === 'status') {
                                return (
                                  <td key={col.id} className="px-2 text-center align-middle">
                                    <Badge
                                      variant="outline"
                                      className={cn(
                                        "text-[11px]",
                                        invoice.paid_status === "paid"
                                          ? "bg-emerald-100/50 text-emerald-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-emerald-500 dark:border-emerald-800/20"
                                          : "bg-amber-100/50 text-amber-900 border-amber-200/50 dark:bg-amber-900/15 dark:text-amber-500 dark:border-amber-800/20"
                                      )}
                                    >
                                      {invoice.paid_status === 'paid' ? 'Paid' : 'Unpaid'}
                                    </Badge>
                                  </td>
                                )
                              }

                              return null
                            })}
                            {columnVisibility.download && (
                              <td className="px-2 pr-6 lg:pr-8 text-center align-middle">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0"
                                    >
                                      <Download className="h-4 w-4" />
                                      <span className="sr-only">Download</span>
                                    </Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent align="end">
                                    <DropdownMenuItem onClick={() => handleDownloadFile(invoice.invoice_number, 'pdf')}>
                                      <FileTextIcon className="h-4 w-4 mr-2 text-red-600" />
                                      Summary PDF
                                    </DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => handleDownloadFile(invoice.invoice_number, 'xlsx')}>
                                      <FileSpreadsheetIcon className="h-4 w-4 mr-2 text-green-600" />
                                      Details XLSX
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </td>
                            )}
                          </tr>
                        )
                      })
                    )}
                  </tbody>
                </table>

                {/* Drag overlay - ghost header during drag */}
                <DragOverlay dropAnimation={null}>
                  {activeColumn ? (
                    <div className="px-2 py-2 text-[10px] font-medium text-zinc-500 uppercase tracking-wide bg-surface border rounded shadow-md">
                      {activeColumn.header}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>

            {/* Pagination - sticky at bottom of scroll area */}
            <div className="sticky bottom-0 bg-background px-6 lg:px-8 py-3 flex items-center justify-between border-t border-border/40">
                <div className="flex items-center gap-4">
                  <span className="text-sm text-muted-foreground">
                    {paginatedInvoices.length.toLocaleString()} of {totalCount.toLocaleString()} invoices
                  </span>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Rows</span>
                    <Select
                      value={pageSize.toString()}
                      onValueChange={(value) => {
                        setPageSize(Number(value))
                        setCurrentPage(0)
                      }}
                    >
                      <SelectTrigger className="h-7 w-[70px]">
                        <SelectValue placeholder={pageSize} />
                      </SelectTrigger>
                      <SelectContent>
                        {[25, 50, 100, 200].map((size) => (
                          <SelectItem key={size} value={size.toString()}>
                            {size}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">
                    Page {currentPage + 1} of {totalPages || 1}
                  </span>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setCurrentPage(0)}
                      disabled={currentPage === 0}
                    >
                      <span className="sr-only">Go to first page</span>
                      <ChevronsLeftIcon className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setCurrentPage(currentPage - 1)}
                      disabled={currentPage === 0}
                    >
                      <span className="sr-only">Go to previous page</span>
                      <ChevronLeftIcon className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setCurrentPage(currentPage + 1)}
                      disabled={currentPage >= totalPages - 1}
                    >
                      <span className="sr-only">Go to next page</span>
                      <ChevronRightIcon className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => setCurrentPage(totalPages - 1)}
                      disabled={currentPage >= totalPages - 1}
                    >
                      <span className="sr-only">Go to last page</span>
                      <ChevronsRightIcon className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
          </div>
        </div>
      </div>
    </div>

    </>
  )
}
