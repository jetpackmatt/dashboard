"use client"

import * as React from "react"
import {
  FileTextIcon,
  FileSpreadsheetIcon,
  FilterIcon,
  ColumnsIcon,
  ChevronDownIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  Loader2,
  Download,
} from "lucide-react"

import { SiteHeader } from "@/components/site-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { format } from "date-fns"
import { useClient } from "@/components/client-context"
import { X } from "lucide-react"

// Date range preset types
type DateRangePreset = '30d' | '90d' | 'mtd' | 'ytd' | 'all' | 'custom'

const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: '30d', label: '30D' },
  { value: '90d', label: '90D' },
  { value: 'mtd', label: 'MTD' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All' },
]

function getDateRangeFromPreset(preset: DateRangePreset): { from: Date; to: Date } | null {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (preset) {
    case '30d':
      const thirtyDaysAgo = new Date(today)
      thirtyDaysAgo.setDate(today.getDate() - 29)
      return { from: thirtyDaysAgo, to: today }
    case '90d':
      const ninetyDaysAgo = new Date(today)
      ninetyDaysAgo.setDate(today.getDate() - 89)
      return { from: ninetyDaysAgo, to: today }
    case 'mtd':
      const monthStart = new Date(today.getFullYear(), today.getMonth(), 1)
      return { from: monthStart, to: today }
    case 'ytd':
      const yearStart = new Date(today.getFullYear(), 0, 1)
      return { from: yearStart, to: today }
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
  client?: Client
}

/**
 * Format a date string as a fixed date without timezone conversion.
 */
function formatDateFixed(dateStr: string): string {
  if (!dateStr) return '-'
  const datePart = dateStr.split('T')[0]
  const [year, month, day] = datePart.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[parseInt(month) - 1]} ${parseInt(day)}, ${year}`
}

// Color schemes for client badges - matches ClientBadge component
const colorSchemes = [
  { badge: "bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/20", tooltip: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300 border-blue-200 dark:border-blue-800" },
  { badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/20", tooltip: "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300 border-amber-200 dark:border-amber-800" },
  { badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/20", tooltip: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800" },
  { badge: "bg-rose-500/15 text-rose-700 dark:text-rose-400 border-rose-500/20", tooltip: "bg-rose-100 text-rose-700 dark:bg-rose-900 dark:text-rose-300 border-rose-200 dark:border-rose-800" },
  { badge: "bg-purple-500/15 text-purple-700 dark:text-purple-400 border-purple-500/20", tooltip: "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300 border-purple-200 dark:border-purple-800" },
  { badge: "bg-cyan-500/15 text-cyan-700 dark:text-cyan-400 border-cyan-500/20", tooltip: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800" },
  { badge: "bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/20", tooltip: "bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300 border-orange-200 dark:border-orange-800" },
  { badge: "bg-indigo-500/15 text-indigo-700 dark:text-indigo-400 border-indigo-500/20", tooltip: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900 dark:text-indigo-300 border-indigo-200 dark:border-indigo-800" },
]

export default function InvoicesPage() {
  const { selectedClientId, effectiveIsAdmin, clients } = useClient()

  const [invoices, setInvoices] = React.useState<Invoice[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const [filtersSheetOpen, setFiltersSheetOpen] = React.useState(false)
  const [dateRange, setDateRange] = React.useState<{
    from: Date | undefined
    to: Date | undefined
  }>({
    from: undefined,
    to: undefined,
  })
  const [datePreset, setDatePreset] = React.useState<DateRangePreset>('all')
  const [isCustomRangeOpen, setIsCustomRangeOpen] = React.useState(false)
  const [isAwaitingEndDate, setIsAwaitingEndDate] = React.useState(false)

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)

  // Column visibility state
  const [columnVisibility, setColumnVisibility] = React.useState({
    client: true,
    invoiceDate: true,
    invoiceNumber: true,
    cost: true,
    profit: true,
    amount: true,
    status: true,
    download: true,
  })

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

  // Filter invoices by date range
  const filteredInvoices = React.useMemo(() => {
    if (!dateRange.from && !dateRange.to) return invoices

    return invoices.filter(invoice => {
      const invoiceDate = new Date(invoice.invoice_date.split('T')[0])
      if (dateRange.from && invoiceDate < dateRange.from) return false
      if (dateRange.to && invoiceDate > dateRange.to) return false
      return true
    })
  }, [invoices, dateRange])

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

  // Helper to get client badge color based on client index
  const getClientBadgeColor = (clientId: string) => {
    const clientIndex = clients.findIndex(c => c.id === clientId)
    if (clientIndex === -1) return colorSchemes[0]
    return colorSchemes[clientIndex % colorSchemes.length]
  }

  // Calculate column widths - redistribute proportionally to always sum to 100%
  const columnWidths = React.useMemo(() => {
    // Base widths (relative values, not percentages)
    // With center alignment, widths can be more uniform
    const baseWidths: Record<string, number> = {
      client: 5,        // Client badge - narrow
      invoiceNumber: 16, // Invoice # - left-aligned (first column)
      invoiceDate: 12,   // Date - center
      cost: 12,          // Cost - center
      profit: 12,        // Profit - center
      amount: 12,        // Amount - center
      status: 12,        // Status - center
      download: 6,       // Download icon - center
    }

    // Calculate which columns are visible
    const visibleCols: string[] = []
    if (showClientColumn && columnVisibility.client) visibleCols.push('client')
    if (columnVisibility.invoiceNumber) visibleCols.push('invoiceNumber')
    if (columnVisibility.invoiceDate) visibleCols.push('invoiceDate')
    if (showCostBreakdown && columnVisibility.cost) visibleCols.push('cost')
    if (showCostBreakdown && columnVisibility.profit) visibleCols.push('profit')
    if (columnVisibility.amount) visibleCols.push('amount')
    if (columnVisibility.status) visibleCols.push('status')
    if (columnVisibility.download) visibleCols.push('download')

    // Sum total base width of visible columns
    const totalBase = visibleCols.reduce((sum, col) => sum + baseWidths[col], 0)

    // Redistribute to percentages
    const widths: Record<string, string> = {}
    visibleCols.forEach(col => {
      widths[col] = `${(baseWidths[col] / totalBase) * 100}%`
    })

    return widths
  }, [showClientColumn, showCostBreakdown, columnVisibility])

  if (isLoading) {
    return (
      <>
        <SiteHeader sectionName="Invoices" />
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
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
          <div className="sticky top-0 z-20 -mx-6 lg:-mx-8 bg-muted/60 dark:bg-zinc-900/60 rounded-t-xl">
            <div className="px-6 lg:px-8 py-4 flex flex-col gap-4">
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
              {/* Date Range Picker - Select with presets */}
              <Popover
                open={isCustomRangeOpen}
                onOpenChange={(open) => {
                  if (!open) {
                    setIsCustomRangeOpen(false)
                  }
                }}
                modal={false}
              >
                <div className="flex items-center gap-1">
                  <Select
                    value={datePreset === 'custom' ? 'custom' : datePreset}
                    onValueChange={(value) => {
                      if (value === 'custom') {
                        setDatePreset('custom')
                        setIsCustomRangeOpen(true)
                      } else {
                        const preset = value as DateRangePreset
                        setDatePreset(preset)
                        const range = getDateRangeFromPreset(preset)
                        if (range) {
                          setDateRange({ from: range.from, to: range.to })
                        } else {
                          setDateRange({ from: undefined, to: undefined })
                        }
                        setIsCustomRangeOpen(false)
                        setCurrentPage(0)
                      }
                    }}
                  >
                    <SelectTrigger className="h-[30px] w-auto gap-1.5 text-sm bg-background">
                      <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <SelectValue>
                        {datePreset === 'custom' && dateRange.from && dateRange.to
                          ? `${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d')}`
                          : DATE_RANGE_PRESETS.find(p => p.value === datePreset)?.label || 'All'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {DATE_RANGE_PRESETS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Custom</SelectItem>
                    </SelectContent>
                  </Select>
                  <PopoverTrigger asChild>
                    <span />
                  </PopoverTrigger>
                </div>
                <PopoverContent
                  className="w-auto p-4"
                  align="start"
                  onInteractOutside={(e) => e.preventDefault()}
                  onPointerDownOutside={(e) => e.preventDefault()}
                  onFocusOutside={(e) => e.preventDefault()}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Select Date Range</span>
                    </div>
                    {(dateRange.from || dateRange.to) && (
                      <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                        <div className="flex-1 text-xs">
                          <span className="text-muted-foreground">From: </span>
                          <span className="font-medium">
                            {dateRange.from ? format(dateRange.from, 'MMM d, yyyy') : '—'}
                          </span>
                        </div>
                        <div className="flex-1 text-xs">
                          <span className="text-muted-foreground">To: </span>
                          <span className="font-medium">
                            {dateRange.to ? format(dateRange.to, 'MMM d, yyyy') : '—'}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setDateRange({ from: undefined, to: undefined })
                            setDatePreset('all')
                            setIsCustomRangeOpen(false)
                            setIsAwaitingEndDate(false)
                            setCurrentPage(0)
                          }}
                          className="p-1 hover:bg-muted rounded"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    )}
                    <div className="text-[11px] text-muted-foreground px-1">
                      {isAwaitingEndDate
                        ? "Click a date to select end date"
                        : "Click a date to select start date"}
                    </div>
                    <Calendar
                      mode="range"
                      selected={{
                        from: dateRange.from,
                        to: dateRange.to,
                      }}
                      onSelect={(range) => {
                        if (!range?.from) {
                          setDateRange({ from: undefined, to: undefined })
                          setIsAwaitingEndDate(false)
                        } else if (!range?.to) {
                          setDateRange({ from: range.from, to: undefined })
                          setIsAwaitingEndDate(true)
                        } else {
                          setDateRange({ from: range.from, to: range.to })
                          setIsAwaitingEndDate(false)
                          setIsCustomRangeOpen(false)
                          setCurrentPage(0)
                        }
                      }}
                      numberOfMonths={2}
                    />
                  </div>
                </PopoverContent>
              </Popover>

              {/* Action buttons */}
              <div className="flex items-center gap-1.5 md:gap-2">
                {/* Filters button */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFiltersSheetOpen(true)}
                  className="flex-shrink-0"
                >
                  <FilterIcon className="h-4 w-4" />
                  <span className="ml-2 hidden 2xl:inline">Filters</span>
                </Button>

                {/* Columns button */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="flex-shrink-0">
                      <ColumnsIcon className="h-4 w-4" />
                      <span className="ml-2 hidden 2xl:inline">Columns</span>
                      <ChevronDownIcon className="h-4 w-4 2xl:ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
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
            {/* Table header row - sticky within scroll area */}
            <div className="sticky top-0 z-10 bg-muted dark:bg-zinc-900">
              <table style={{ tableLayout: 'fixed', width: '100%' }} className="text-sm">
                <colgroup>
                  {showClientColumn && columnVisibility.client && <col style={{ width: columnWidths.client }} />}
                  {columnVisibility.invoiceNumber && <col style={{ width: columnWidths.invoiceNumber }} />}
                  {columnVisibility.invoiceDate && <col style={{ width: columnWidths.invoiceDate }} />}
                  {showCostBreakdown && columnVisibility.cost && <col style={{ width: columnWidths.cost }} />}
                  {showCostBreakdown && columnVisibility.profit && <col style={{ width: columnWidths.profit }} />}
                  {columnVisibility.amount && <col style={{ width: columnWidths.amount }} />}
                  {columnVisibility.status && <col style={{ width: columnWidths.status }} />}
                  {columnVisibility.download && <col style={{ width: columnWidths.download }} />}
                </colgroup>
                <thead>
                  <tr className="h-11">
                    {showClientColumn && columnVisibility.client && (
                      <th className="pl-6 lg:pl-8 pr-2 text-left align-middle text-xs font-medium text-muted-foreground" />
                    )}
                    {columnVisibility.invoiceNumber && (
                      <th className={`${showClientColumn && columnVisibility.client ? 'px-2' : 'pl-6 lg:pl-8 pr-2'} text-left align-middle text-xs font-medium text-muted-foreground`}>
                        Invoice #
                      </th>
                    )}
                    {columnVisibility.invoiceDate && (
                      <th className="px-2 text-center align-middle text-xs font-medium text-muted-foreground">
                        Invoice Date
                      </th>
                    )}
                    {showCostBreakdown && columnVisibility.cost && (
                      <th className="px-2 text-center align-middle text-xs font-medium text-muted-foreground">
                        Cost
                      </th>
                    )}
                    {showCostBreakdown && columnVisibility.profit && (
                      <th className="px-2 text-center align-middle text-xs font-medium text-muted-foreground">
                        Profit
                      </th>
                    )}
                    {columnVisibility.amount && (
                      <th className="px-2 text-center align-middle text-xs font-medium text-muted-foreground">
                        Total
                      </th>
                    )}
                    {columnVisibility.status && (
                      <th className="px-2 text-center align-middle text-xs font-medium text-muted-foreground">
                        Status
                      </th>
                    )}
                    {columnVisibility.download && (
                      <th className="px-2 pr-6 lg:pr-8 text-center align-middle text-xs font-medium text-muted-foreground" />
                    )}
                  </tr>
                </thead>
              </table>
            </div>

            {/* Table body */}
            <table style={{ tableLayout: 'fixed', width: '100%' }} className="text-sm">
              <colgroup>
                {showClientColumn && columnVisibility.client && <col style={{ width: columnWidths.client }} />}
                {columnVisibility.invoiceNumber && <col style={{ width: columnWidths.invoiceNumber }} />}
                {columnVisibility.invoiceDate && <col style={{ width: columnWidths.invoiceDate }} />}
                {showCostBreakdown && columnVisibility.cost && <col style={{ width: columnWidths.cost }} />}
                {showCostBreakdown && columnVisibility.profit && <col style={{ width: columnWidths.profit }} />}
                {columnVisibility.amount && <col style={{ width: columnWidths.amount }} />}
                {columnVisibility.status && <col style={{ width: columnWidths.status }} />}
                {columnVisibility.download && <col style={{ width: columnWidths.download }} />}
              </colgroup>
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
                            className="h-12 border-b border-border/50 dark:bg-[hsl(220,8%,8%)] dark:hover:bg-[hsl(220,8%,10%)] hover:bg-muted/30"
                          >
                            {showClientColumn && columnVisibility.client && (
                              <td className="pl-6 lg:pl-8 pr-2 align-middle">
                                <TooltipProvider delayDuration={100}>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <span
                                        className={`inline-flex items-center justify-center w-6 h-5 text-[10px] font-semibold rounded border ${colors.badge} cursor-default shrink-0`}
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
                            {columnVisibility.invoiceNumber && (
                              <td className={`${showClientColumn && columnVisibility.client ? 'px-2' : 'pl-6 lg:pl-8 pr-2'} align-middle`}>
                                {invoice.invoice_number}
                                {effectiveIsAdmin && invoice.version > 1 && (
                                  <Badge variant="outline" className="ml-2 text-[10px] px-1.5 py-0">v{invoice.version}</Badge>
                                )}
                              </td>
                            )}
                            {columnVisibility.invoiceDate && (
                              <td className="px-2 text-center align-middle">
                                {formatDateFixed(invoice.invoice_date)}
                              </td>
                            )}
                            {showCostBreakdown && columnVisibility.cost && (
                              <td className="px-2 text-center align-middle tabular-nums">
                                {formatCurrency(invoice.subtotal)}
                              </td>
                            )}
                            {showCostBreakdown && columnVisibility.profit && (
                              <td className="px-2 text-center align-middle tabular-nums text-emerald-600 dark:text-emerald-500">
                                +{formatCurrency(invoice.total_markup)}
                              </td>
                            )}
                            {columnVisibility.amount && (
                              <td className="px-2 text-center align-middle tabular-nums font-semibold">
                                {formatCurrency(invoice.total_amount)}
                              </td>
                            )}
                            {columnVisibility.status && (
                              <td className="px-2 text-center align-middle">
                                <Badge
                                  variant="outline"
                                  className={
                                    invoice.paid_status === "paid"
                                      ? "bg-emerald-100/50 text-emerald-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-emerald-500 dark:border-emerald-800/20"
                                      : "bg-amber-100/50 text-amber-900 border-amber-200/50 dark:bg-amber-900/15 dark:text-amber-500 dark:border-amber-800/20"
                                  }
                                >
                                  {invoice.paid_status === 'paid' ? 'Paid' : 'Unpaid'}
                                </Badge>
                              </td>
                            )}
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

      {/* Filters Sheet */}
      <Sheet open={filtersSheetOpen} onOpenChange={setFiltersSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Filter Invoices</SheetTitle>
            <SheetDescription>
              Apply filters to narrow down your invoice list
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-6 py-6">
            <div className="flex flex-col gap-2">
              <Label>Payment Status</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Amount Range</Label>
              <div className="flex gap-2">
                <Input type="number" placeholder="Min" />
                <Input type="number" placeholder="Max" />
              </div>
            </div>
          </div>
          <SheetFooter>
            <SheetClose asChild>
              <Button variant="outline">Clear Filters</Button>
            </SheetClose>
            <Button>Apply Filters</Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}
