"use client"

import * as React from "react"
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  AlertCircleIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ClockIcon,
  FilterIcon,
  LoaderIcon,
  PackageIcon,
  XCircleIcon,
} from "lucide-react"
import { format } from "date-fns"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface UnfulfilledOrder {
  id: string
  orderId: string
  storeOrderId: string
  customerName: string
  status: string
  orderDate: string
  slaDate: string | null
  itemCount: number
  orderType: string
  channelName: string
}

// Status badge colors
function getStatusColors(status: string) {
  // Out of Stock / Exception statuses (warning - amber)
  if (status.includes("Out of Stock") || status === "Exception" || status === "Address Issue" || status === "On Hold") {
    return "bg-amber-100/50 text-slate-900 border-amber-200/50 dark:bg-amber-900/15 dark:text-slate-100 dark:border-amber-800/50"
  }
  // Late statuses (red/urgent)
  if (status.includes("Late")) {
    return "bg-red-100/50 text-slate-900 border-red-200/50 dark:bg-red-900/15 dark:text-slate-100 dark:border-red-800/50"
  }
  // Processing / Awaiting Pick (normal - blue)
  if (status === "Processing" || status.includes("Awaiting Pick")) {
    return "bg-blue-100/50 text-slate-900 border-blue-200/50 dark:bg-blue-900/15 dark:text-slate-100 dark:border-blue-800/50"
  }
  // Default
  return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50"
}

function getStatusIcon(status: string) {
  // Out of Stock / Exception statuses
  if (status.includes("Out of Stock") || status === "Exception" || status === "Address Issue" || status === "On Hold") {
    return <AlertCircleIcon className="h-3.5 w-3.5" />
  }
  // Late statuses
  if (status.includes("Late")) {
    return <XCircleIcon className="h-3.5 w-3.5" />
  }
  // Processing / Awaiting Pick
  if (status === "Processing" || status.includes("Awaiting Pick")) {
    return <ClockIcon className="h-3.5 w-3.5" />
  }
  // Default
  return <PackageIcon className="h-3.5 w-3.5" />
}

const columns: ColumnDef<UnfulfilledOrder>[] = [
  {
    accessorKey: "orderId",
    header: "Order ID",
    cell: ({ row }) => (
      <div className="font-medium text-foreground">
        {row.getValue("orderId")}
      </div>
    ),
  },
  {
    accessorKey: "storeOrderId",
    header: "Store Order",
    cell: ({ row }) => (
      <div className="text-muted-foreground text-sm">
        {row.getValue("storeOrderId") || "-"}
      </div>
    ),
  },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: ({ row }) => (
      <div className="max-w-[200px] truncate">
        {row.getValue("customerName")}
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => {
      const status = row.getValue("status") as string
      return (
        <Badge
          variant="outline"
          className={`gap-1 ${getStatusColors(status)}`}
        >
          {getStatusIcon(status)}
          {status}
        </Badge>
      )
    },
    filterFn: (row, id, value) => {
      return value.includes(row.getValue(id))
    },
  },
  {
    accessorKey: "orderDate",
    header: "Order Date",
    cell: ({ row }) => {
      const date = row.getValue("orderDate") as string
      return date ? format(new Date(date), "MMM d, yyyy") : "-"
    },
  },
  {
    accessorKey: "slaDate",
    header: "SLA Date",
    cell: ({ row }) => {
      const date = row.getValue("slaDate") as string | null
      if (!date) return "-"
      const slaDate = new Date(date)
      const isOverdue = slaDate < new Date()
      return (
        <span className={isOverdue ? "text-red-500 font-medium" : ""}>
          {format(slaDate, "MMM d, yyyy")}
        </span>
      )
    },
  },
  {
    accessorKey: "itemCount",
    header: "Items",
    cell: ({ row }) => (
      <div className="text-center">{row.getValue("itemCount")}</div>
    ),
  },
  {
    accessorKey: "orderType",
    header: "Type",
    cell: ({ row }) => (
      <Badge variant="secondary" className="font-normal">
        {row.getValue("orderType")}
      </Badge>
    ),
  },
]

interface UnfulfilledTableProps {
  clientId: string
}

export function UnfulfilledTable({ clientId }: UnfulfilledTableProps) {
  const [data, setData] = React.useState<UnfulfilledOrder[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [totalCount, setTotalCount] = React.useState(0)

  // Table state
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)

  // Status filter state
  const [statusFilter, setStatusFilter] = React.useState<string[]>([])

  // Fetch data
  const fetchData = React.useCallback(async (page: number, size: number, statuses: string[]) => {
    const isInitialLoad = page === 0 && data.length === 0

    if (isInitialLoad) {
      setIsLoading(true)
    } else {
      setIsPageLoading(true)
    }
    setError(null)

    try {
      const offset = page * size
      const statusParam = statuses.length > 0 ? `&status=${statuses.join(',')}` : ''
      const response = await fetch(
        `/api/data/orders/unfulfilled?clientId=${clientId}&limit=${size}&offset=${offset}${statusParam}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`)
      }

      const result = await response.json()
      setData(result.data || [])
      setTotalCount(result.totalCount || 0)
    } catch (err) {
      console.error('Error fetching unfulfilled orders:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setData([])
    } finally {
      setIsLoading(false)
      setIsPageLoading(false)
    }
  }, [clientId, data.length])

  // Initial load and on filter/page change
  React.useEffect(() => {
    fetchData(pageIndex, pageSize, statusFilter)
  }, [clientId, pageIndex, pageSize, statusFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset to first page when filter changes
  const handleStatusFilterChange = (status: string, checked: boolean) => {
    setPageIndex(0)
    if (checked) {
      setStatusFilter(prev => [...prev, status])
    } else {
      setStatusFilter(prev => prev.filter(s => s !== status))
    }
  }

  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    state: {
      sorting,
      columnFilters,
      columnVisibility,
    },
    manualPagination: true,
    pageCount: Math.ceil(totalCount / pageSize),
  })

  const totalPages = Math.ceil(totalCount / pageSize)

  if (isLoading) {
    return (
      <div className="px-4 lg:px-6 space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-4 lg:px-6">
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
          <p className="font-medium">Error loading data</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="px-4 lg:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          {/* Status filter dropdown */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <FilterIcon className="h-4 w-4" />
                Status
                {statusFilter.length > 0 && (
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0">
                    {statusFilter.length}
                  </Badge>
                )}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <DropdownMenuCheckboxItem
                checked={statusFilter.includes("Out of Stock")}
                onCheckedChange={(checked) => handleStatusFilterChange("Out of Stock", checked)}
              >
                Out of Stock
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={statusFilter.includes("Awaiting Pick")}
                onCheckedChange={(checked) => handleStatusFilterChange("Awaiting Pick", checked)}
              >
                Awaiting Pick
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={statusFilter.includes("Exception")}
                onCheckedChange={(checked) => handleStatusFilterChange("Exception", checked)}
              >
                Exception
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={statusFilter.includes("Processing")}
                onCheckedChange={(checked) => handleStatusFilterChange("Processing", checked)}
              >
                Processing
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Clear filters */}
          {statusFilter.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setPageIndex(0)
                setStatusFilter([])
              }}
            >
              Clear filters
            </Button>
          )}
        </div>

        <div className="text-sm text-muted-foreground">
          {totalCount.toLocaleString()} unfulfilled orders
          {isPageLoading && <LoaderIcon className="inline ml-2 h-4 w-4 animate-spin" />}
        </div>
      </div>

      {/* Table */}
      <div className="px-4 lg:px-6">
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id}>
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id}>
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center"
                  >
                    No unfulfilled orders found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Pagination */}
      <div className="px-4 lg:px-6 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Rows per page</span>
          <Select
            value={pageSize.toString()}
            onValueChange={(value) => {
              setPageSize(Number(value))
              setPageIndex(0)
            }}
          >
            <SelectTrigger className="h-8 w-[70px]">
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

        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Page {pageIndex + 1} of {totalPages || 1}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPageIndex(0)}
              disabled={pageIndex === 0}
            >
              <ChevronsLeftIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPageIndex(Math.max(0, pageIndex - 1))}
              disabled={pageIndex === 0}
            >
              <ChevronLeftIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPageIndex(Math.min(totalPages - 1, pageIndex + 1))}
              disabled={pageIndex >= totalPages - 1}
            >
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8"
              onClick={() => setPageIndex(totalPages - 1)}
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
