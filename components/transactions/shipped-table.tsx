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
  CheckCircle2Icon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ExternalLinkIcon,
  LoaderIcon,
  PackageIcon,
  TruckIcon,
} from "lucide-react"
import { format } from "date-fns"

import { Badge } from "@/components/ui/badge"
import { getCarrierServiceDisplay } from "@/lib/utils/carrier-service-display"
import { Button } from "@/components/ui/button"
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
import { TrackingLink } from "@/components/tracking-link"

interface ShippedOrder {
  id: string
  orderId: string
  storeOrderId: string
  customerName: string
  status: string
  carrier: string
  carrierService: string
  trackingId: string
  shippedDate: string | null
  deliveredDate: string | null
  itemCount: number
  charge: number
}

// Status badge colors
function getStatusColors(status: string) {
  switch (status) {
    case "Delivered":
      return "bg-emerald-100/50 text-slate-900 border-emerald-200/50 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700/50"
    case "In Transit":
    case "Out for Delivery":
      return "bg-blue-100/50 text-slate-900 border-blue-200/50 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700/50"
    case "Shipped":
    case "Labelled":
      return "bg-sky-100/50 text-slate-900 border-sky-200/50 dark:bg-sky-900/30 dark:text-sky-300 dark:border-sky-700/50"
    default:
      return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-800/40 dark:text-slate-300 dark:border-slate-700/50"
  }
}

function getStatusIcon(status: string) {
  switch (status) {
    case "Delivered":
      return <CheckCircle2Icon className="h-3.5 w-3.5" />
    case "In Transit":
    case "Out for Delivery":
      return <TruckIcon className="h-3.5 w-3.5" />
    case "Shipped":
    case "Labelled":
      return <PackageIcon className="h-3.5 w-3.5" />
    default:
      return <PackageIcon className="h-3.5 w-3.5" />
  }
}

// Generate tracking URL based on carrier
function getTrackingUrl(carrier: string, trackingId: string): string | null {
  if (!trackingId) return null

  const carrierLower = carrier?.toLowerCase() || ''

  if (carrierLower.includes('ups')) {
    return `https://www.ups.com/track?tracknum=${trackingId}`
  }
  if (carrierLower.includes('fedex')) {
    return `https://www.fedex.com/fedextrack/?trknbr=${trackingId}`
  }
  if (carrierLower.includes('usps')) {
    return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${trackingId}`
  }
  if (carrierLower.includes('dhl')) {
    return `https://www.dhl.com/en/express/tracking.html?AWB=${trackingId}`
  }

  return null
}

const columns: ColumnDef<ShippedOrder>[] = [
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
    cell: ({ row }) => {
      const val = row.getValue("storeOrderId") as string
      return (
        <div className="truncate text-muted-foreground text-sm" style={{ maxWidth: 'clamp(40px, 5vw, 120px)' }} title={val || undefined}>
          {val || "-"}
        </div>
      )
    },
  },
  {
    accessorKey: "customerName",
    header: "Customer",
    cell: ({ row }) => {
      const val = row.getValue("customerName") as string
      return (
        <div className="truncate" style={{ maxWidth: 'clamp(60px, 8vw, 180px)' }} title={val || undefined}>
          {val || "-"}
        </div>
      )
    },
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
  },
  {
    accessorKey: "carrier",
    header: "Carrier",
    cell: ({ row }) => {
      const carrier = row.getValue("carrier") as string
      const service = row.original.carrierService
      return (
        <div>
          <div className="font-medium">{carrier || "-"}</div>
          {service && (
            <div className="text-xs text-muted-foreground truncate max-w-[120px]">
              {getCarrierServiceDisplay(service, carrier)}
            </div>
          )}
        </div>
      )
    },
  },
  {
    accessorKey: "trackingId",
    header: "Tracking",
    cell: ({ row }) => {
      const trackingId = row.getValue("trackingId") as string
      const carrier = row.original.carrier

      if (!trackingId) return "-"

      return (
        <TrackingLink
          trackingNumber={trackingId}
          carrier={carrier}
          className="flex items-center gap-1 text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
        >
          <span className="truncate max-w-[100px]">{trackingId}</span>
          <ExternalLinkIcon className="h-3 w-3 flex-shrink-0" />
        </TrackingLink>
      )
    },
  },
  {
    accessorKey: "shippedDate",
    header: "Shipped",
    cell: ({ row }) => {
      const date = row.getValue("shippedDate") as string | null
      return date ? format(new Date(date), "MMM d, yyyy") : "-"
    },
  },
  {
    accessorKey: "deliveredDate",
    header: "Delivered",
    cell: ({ row }) => {
      const date = row.getValue("deliveredDate") as string | null
      return date ? format(new Date(date), "MMM d, yyyy") : "-"
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
    accessorKey: "charge",
    header: "Charge",
    cell: ({ row }) => {
      const charge = row.getValue("charge") as number
      return charge ? `$${charge.toFixed(2)}` : "-"
    },
  },
]

interface ShippedTableProps {
  clientId: string
}

export function ShippedTable({ clientId }: ShippedTableProps) {
  const [data, setData] = React.useState<ShippedOrder[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [totalCount, setTotalCount] = React.useState(0)

  // Table state
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'shippedDate', desc: true }])
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>([])
  const [columnVisibility, setColumnVisibility] = React.useState<VisibilityState>({})
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(50)

  // Fetch data
  const fetchData = React.useCallback(async (page: number, size: number) => {
    const isInitialLoad = page === 0 && data.length === 0

    if (isInitialLoad) {
      setIsLoading(true)
    } else {
      setIsPageLoading(true)
    }
    setError(null)

    try {
      const offset = page * size
      const response = await fetch(
        `/api/data/orders/shipped?clientId=${clientId}&limit=${size}&offset=${offset}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`)
      }

      const result = await response.json()
      setData(result.data || [])
      setTotalCount(result.totalCount || 0)
    } catch (err) {
      console.error('Error fetching shipped orders:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setData([])
    } finally {
      setIsLoading(false)
      setIsPageLoading(false)
    }
  }, [clientId, data.length])

  // Initial load and on page change
  React.useEffect(() => {
    fetchData(pageIndex, pageSize)
  }, [clientId, pageIndex, pageSize]) // eslint-disable-line react-hooks/exhaustive-deps

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
        <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-destructive dark:border-destructive/40 dark:bg-destructive/10 dark:text-red-300">
          <p className="font-medium">Error loading data</p>
          <p className="text-sm">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="px-4 lg:px-6 flex items-center justify-end">
        <div className="text-sm text-muted-foreground">
          {totalCount.toLocaleString()} shipped orders
          {isPageLoading && <LoaderIcon className="inline ml-2 h-4 w-4 animate-spin" />}
        </div>
      </div>

      {/* Table */}
      <div className="px-4 lg:px-6">
        <div className="rounded-md border">
          <Table>
            <TableHeader className="bg-surface dark:bg-zinc-900">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <TableHead
                      key={header.id}
                      className={`text-[10px] text-zinc-500 dark:text-zinc-500 uppercase tracking-wide ${header.column.getCanSort() ? 'cursor-pointer select-none hover:text-zinc-700 dark:hover:text-zinc-300 transition-colors group/th' : ''}`}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {header.isPlaceholder ? null : (
                        <span className="inline-flex items-center gap-0.5">
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {header.column.getCanSort() && (
                            header.column.getIsSorted() === 'asc'
                              ? <ChevronUpIcon className="h-3 w-3 flex-shrink-0 text-foreground" />
                              : header.column.getIsSorted() === 'desc'
                                ? <ChevronDownIcon className="h-3 w-3 flex-shrink-0 text-foreground" />
                                : <ChevronDownIcon className="h-3 w-3 flex-shrink-0 opacity-0 group-hover/th:opacity-40 transition-opacity" />
                          )}
                        </span>
                      )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow key={row.id} className="border-b border-border/50">
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
                    No shipped orders found.
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
