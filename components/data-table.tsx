"use client"

import * as React from "react"
import {
  ColumnDef,
  ColumnFiltersState,
  SortingState,
  VisibilityState,
  flexRender,
  getCoreRowModel,
  getFacetedRowModel,
  getFacetedUniqueValues,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
} from "@tanstack/react-table"
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ClockIcon,
  ColumnsIcon,
  DownloadIcon,
  FilterIcon,
  LoaderIcon,
  MoreVerticalIcon,
  PackageIcon,
  SearchIcon,
  TruckIcon,
} from "lucide-react"
import { toast } from "sonner"
import { z } from "zod"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { UnfulfilledTable } from "@/components/transactions/unfulfilled-table"

// ============================================================================
// SHIPMENTS TAB - Schema and Columns
// ============================================================================
export const shipmentsSchema = z.object({
  id: z.number(),
  orderId: z.string(),
  status: z.string(),
  customerName: z.string(),
  orderType: z.string(),
  qty: z.number(),
  cost: z.number(),
  importDate: z.string(),
  slaDate: z.string(),
})

// Helper function to get status icon for shipments
function getStatusIcon(status: string) {
  switch (status) {
    case "Shipped":
      return <PackageIcon />
    case "Awaiting Pick":
      return <ClockIcon />
    case "Picked":
      return <CheckCircleIcon />
    case "Action Required":
      return <AlertCircleIcon />
    case "In Transit":
      return <TruckIcon />
    case "Delivered":
      return <CheckCircle2Icon />
    case "Processing":
      return <LoaderIcon />
    case "Cancelled":
      return <AlertCircleIcon />
    default:
      return <LoaderIcon />
  }
}

// Helper function to get status colors
function getStatusColors(status: string) {
  switch (status) {
    case "Delivered":
      return "bg-emerald-100/50 text-slate-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-slate-100 dark:border-emerald-800/50"
    case "Shipped":
    case "In Transit":
      return "bg-blue-100/50 text-slate-900 border-blue-200/50 dark:bg-blue-900/15 dark:text-slate-100 dark:border-blue-800/50"
    case "Processing":
      return "bg-amber-100/50 text-slate-900 border-amber-200/50 dark:bg-amber-900/15 dark:text-slate-100 dark:border-amber-800/50"
    case "Awaiting Pick":
      return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50"
    case "Picked":
      return "bg-emerald-100/50 text-slate-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-slate-100 dark:border-emerald-800/50"
    case "Action Required":
    case "Cancelled":
      return "bg-red-100/50 text-slate-900 border-red-200/50 dark:bg-red-900/15 dark:text-slate-100 dark:border-red-800/50"
    default:
      return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50"
  }
}

// Helper function for Additional Services status colors
function getAdditionalServicesStatusColors(status: string) {
  switch (status) {
    case "Completed":
      return "bg-emerald-100/50 text-slate-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-slate-100 dark:border-emerald-800/50"
    case "In Progress":
      return "bg-blue-100/50 text-slate-900 border-blue-200/50 dark:bg-blue-900/15 dark:text-slate-100 dark:border-blue-800/50"
    case "Pending":
      return "bg-amber-100/50 text-slate-900 border-amber-200/50 dark:bg-amber-900/15 dark:text-slate-100 dark:border-amber-800/50"
    case "Failed":
    case "Cancelled":
      return "bg-red-100/50 text-slate-900 border-red-200/50 dark:bg-red-900/15 dark:text-slate-100 dark:border-red-800/50"
    default:
      return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50"
  }
}

// Helper function for Returns status colors
function getReturnsStatusColors(status: string) {
  switch (status) {
    case "Refunded":
      return "bg-emerald-100/50 text-slate-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-slate-100 dark:border-emerald-800/50"
    case "Received":
      return "bg-blue-100/50 text-slate-900 border-blue-200/50 dark:bg-blue-900/15 dark:text-slate-100 dark:border-blue-800/50"
    case "Processing":
      return "bg-amber-100/50 text-slate-900 border-amber-200/50 dark:bg-amber-900/15 dark:text-slate-100 dark:border-amber-800/50"
    case "Rejected":
    case "Cancelled":
      return "bg-red-100/50 text-slate-900 border-red-200/50 dark:bg-red-900/15 dark:text-slate-100 dark:border-red-800/50"
    default:
      return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50"
  }
}

// Helper function for Credits status colors
function getCreditsStatusColors(status: string) {
  switch (status) {
    case "Applied":
      return "bg-emerald-100/50 text-slate-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-slate-100 dark:border-emerald-800/50"
    case "Approved":
      return "bg-blue-100/50 text-slate-900 border-blue-200/50 dark:bg-blue-900/15 dark:text-slate-100 dark:border-blue-800/50"
    case "Pending":
      return "bg-amber-100/50 text-slate-900 border-amber-200/50 dark:bg-amber-900/15 dark:text-slate-100 dark:border-amber-800/50"
    case "Denied":
    case "Expired":
      return "bg-red-100/50 text-slate-900 border-red-200/50 dark:bg-red-900/15 dark:text-slate-100 dark:border-red-800/50"
    default:
      return "bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50"
  }
}

const shipmentsColumns: ColumnDef<z.infer<typeof shipmentsSchema>>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <div className="pl-2">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="pl-2">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "orderId",
    header: () => <div className="pl-[25px]">Order ID</div>,
    cell: ({ row }) => (
      <div className="font-medium pl-[25px]">{row.original.orderId}</div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant="outline"
        className={`gap-1 px-1.5 font-medium [&_svg]:size-3 ${getStatusColors(row.original.status)}`}
      >
        {getStatusIcon(row.original.status)}
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "customerName",
    header: "Customer Name",
    cell: ({ row }) => row.original.customerName,
  },
  {
    accessorKey: "orderType",
    header: "Order Type",
    cell: ({ row }) => (
      <Badge variant="outline" className="px-1.5 font-medium bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50">
        {row.original.orderType}
      </Badge>
    ),
  },
  {
    accessorKey: "qty",
    header: () => <div className="text-right">Qty</div>,
    cell: ({ row }) => (
      <div className="text-right font-medium">{row.original.qty}</div>
    ),
  },
  {
    accessorKey: "cost",
    header: () => <div className="text-right">Cost</div>,
    cell: ({ row }) => (
      <div className="text-right font-medium">${row.original.cost.toFixed(2)}</div>
    ),
  },
  {
    accessorKey: "importDate",
    header: () => <div className="pl-16">Import Date</div>,
    cell: ({ row }) => {
      const date = new Date(row.original.importDate)
      return (
        <div className="whitespace-nowrap pl-16">
          {date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}{" "}
          {date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )
    },
  },
  {
    accessorKey: "slaDate",
    header: "SLA Date",
    cell: ({ row }) => {
      const date = new Date(row.original.slaDate)
      return (
        <div className="whitespace-nowrap">
          {date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}{" "}
          {date.toLocaleTimeString("en-US", {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </div>
      )
    },
  },
  {
    id: "actions",
    cell: () => (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            className="flex size-8 text-muted-foreground data-[state=open]:bg-muted"
            size="icon"
          >
            <MoreVerticalIcon />
            <span className="sr-only">Open menu</span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-32">
          <DropdownMenuItem>View Details</DropdownMenuItem>
          <DropdownMenuItem>Edit Order</DropdownMenuItem>
          <DropdownMenuItem>Track Shipment</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Cancel Order</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ),
  },
]

// ============================================================================
// ADDITIONAL SERVICES TAB - Schema and Columns
// ============================================================================
export const additionalServicesSchema = z.object({
  id: z.number(),
  serviceId: z.string(),
  serviceType: z.string(),
  customerName: z.string(),
  status: z.string(),
  quantity: z.number(),
  cost: z.number(),
  requestDate: z.string(),
  completionDate: z.string(),
})

const additionalServicesColumns: ColumnDef<z.infer<typeof additionalServicesSchema>>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <div className="pl-2">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="pl-2">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "serviceId",
    header: () => <div className="pl-[25px]">Service ID</div>,
    cell: ({ row }) => (
      <div className="font-medium pl-[25px]">{row.original.serviceId}</div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "serviceType",
    header: "Service Type",
    cell: ({ row }) => (
      <Badge variant="outline" className="px-1.5 font-medium bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50">
        {row.original.serviceType}
      </Badge>
    ),
  },
  {
    accessorKey: "customerName",
    header: "Customer Name",
    cell: ({ row }) => <div>{row.original.customerName}</div>,
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant="outline"
        className={`font-medium ${getAdditionalServicesStatusColors(row.original.status)}`}
      >
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "quantity",
    header: () => <div className="text-center">Qty</div>,
    cell: ({ row }) => (
      <div className="text-center">{row.original.quantity}</div>
    ),
  },
  {
    accessorKey: "cost",
    header: () => <div className="text-right">Cost</div>,
    cell: ({ row }) => (
      <div className="text-right font-medium">${row.original.cost.toFixed(2)}</div>
    ),
  },
  {
    accessorKey: "requestDate",
    header: "Request Date",
    cell: ({ row }) => {
      const date = new Date(row.original.requestDate)
      return (
        <div className="whitespace-nowrap">
          {date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      )
    },
  },
]

// ============================================================================
// RETURNS TAB - Schema and Columns
// ============================================================================
export const returnsSchema = z.object({
  id: z.number(),
  rmaNumber: z.string(),
  orderId: z.string(),
  customerName: z.string(),
  reason: z.string(),
  status: z.string(),
  itemsQty: z.number(),
  receivedDate: z.string(),
  resolutionDate: z.string(),
})

const returnsColumns: ColumnDef<z.infer<typeof returnsSchema>>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <div className="pl-2">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="pl-2">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "rmaNumber",
    header: () => <div className="pl-[25px]">RMA Number</div>,
    cell: ({ row }) => (
      <div className="font-medium pl-[25px]">{row.original.rmaNumber}</div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "orderId",
    header: "Original Order ID",
    cell: ({ row }) => (
      <div className="font-medium text-muted-foreground">{row.original.orderId}</div>
    ),
  },
  {
    accessorKey: "customerName",
    header: "Customer Name",
    cell: ({ row }) => <div>{row.original.customerName}</div>,
  },
  {
    accessorKey: "reason",
    header: "Reason",
    cell: ({ row }) => (
      <Badge variant="outline" className="px-1.5 font-medium bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50">
        {row.original.reason}
      </Badge>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant="outline"
        className={`font-medium ${getReturnsStatusColors(row.original.status)}`}
      >
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "itemsQty",
    header: () => <div className="text-center">Items Qty</div>,
    cell: ({ row }) => (
      <div className="text-center">{row.original.itemsQty}</div>
    ),
  },
  {
    accessorKey: "receivedDate",
    header: "Received Date",
    cell: ({ row }) => {
      const date = new Date(row.original.receivedDate)
      return (
        <div className="whitespace-nowrap">
          {date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      )
    },
  },
]

// ============================================================================
// RECEIVING TAB - Schema and Columns
// ============================================================================
export const receivingSchema = z.object({
  id: z.number(),
  referenceId: z.string(),
  feeType: z.string(),
  cost: z.number(),
  transactionDate: z.string(),
})

const receivingColumns: ColumnDef<z.infer<typeof receivingSchema>>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <div className="pl-2">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="pl-2">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "referenceId",
    header: () => <div className="pl-[25px]">Reference ID</div>,
    cell: ({ row }) => (
      <div className="font-medium pl-[25px]">{row.original.referenceId}</div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "feeType",
    header: "Fee Type",
    cell: ({ row }) => (
      <Badge variant="outline" className="px-1.5 font-medium bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50">
        {row.original.feeType}
      </Badge>
    ),
  },
  {
    accessorKey: "cost",
    header: () => <div className="text-right">Cost</div>,
    cell: ({ row }) => (
      <div className="text-right font-medium">${row.original.cost.toFixed(2)}</div>
    ),
  },
  {
    accessorKey: "transactionDate",
    header: "Transaction Date",
    cell: ({ row }) => {
      const date = new Date(row.original.transactionDate)
      return (
        <div className="whitespace-nowrap">
          {date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      )
    },
  },
]

// ============================================================================
// STORAGE TAB - Schema and Columns
// ============================================================================
export const storageSchema = z.object({
  id: z.number(),
  sku: z.string(),
  productName: z.string(),
  location: z.string(),
  qtyOnHand: z.number(),
  reserved: z.number(),
  available: z.number(),
  lastUpdated: z.string(),
})

const storageColumns: ColumnDef<z.infer<typeof storageSchema>>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <div className="pl-2">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="pl-2">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "sku",
    header: () => <div className="pl-[25px]">SKU</div>,
    cell: ({ row }) => (
      <div className="font-medium pl-[25px]">{row.original.sku}</div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "productName",
    header: "Product Name",
    cell: ({ row }) => <div>{row.original.productName}</div>,
  },
  {
    accessorKey: "location",
    header: "Location",
    cell: ({ row }) => (
      <Badge variant="outline" className="px-1.5 font-medium bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50">
        {row.original.location}
      </Badge>
    ),
  },
  {
    accessorKey: "qtyOnHand",
    header: () => <div className="text-center">Quantity on Hand</div>,
    cell: ({ row }) => (
      <div className="text-center">{row.original.qtyOnHand}</div>
    ),
  },
  {
    accessorKey: "reserved",
    header: () => <div className="text-center">Reserved</div>,
    cell: ({ row }) => (
      <div className="text-center">{row.original.reserved}</div>
    ),
  },
  {
    accessorKey: "available",
    header: () => <div className="text-center">Available</div>,
    cell: ({ row }) => (
      <div className="text-center font-medium">{row.original.available}</div>
    ),
  },
  {
    accessorKey: "lastUpdated",
    header: "Last Updated",
    cell: ({ row }) => {
      const date = new Date(row.original.lastUpdated)
      return (
        <div className="whitespace-nowrap">
          {date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      )
    },
  },
]

// ============================================================================
// CREDITS TAB - Schema and Columns
// ============================================================================
export const creditsSchema = z.object({
  id: z.number(),
  creditId: z.string(),
  customerName: z.string(),
  orderReference: z.string(),
  reason: z.string(),
  amount: z.number(),
  status: z.string(),
  issueDate: z.string(),
})

const creditsColumns: ColumnDef<z.infer<typeof creditsSchema>>[] = [
  {
    id: "select",
    header: ({ table }) => (
      <div className="pl-2">
        <Checkbox
          checked={
            table.getIsAllPageRowsSelected() ||
            (table.getIsSomePageRowsSelected() && "indeterminate")
          }
          onCheckedChange={(value) => table.toggleAllPageRowsSelected(!!value)}
          aria-label="Select all"
        />
      </div>
    ),
    cell: ({ row }) => (
      <div className="pl-2">
        <Checkbox
          checked={row.getIsSelected()}
          onCheckedChange={(value) => row.toggleSelected(!!value)}
          aria-label="Select row"
        />
      </div>
    ),
    enableSorting: false,
    enableHiding: false,
  },
  {
    accessorKey: "creditId",
    header: () => <div className="pl-[25px]">Credit ID</div>,
    cell: ({ row }) => (
      <div className="font-medium pl-[25px]">{row.original.creditId}</div>
    ),
    enableHiding: false,
  },
  {
    accessorKey: "customerName",
    header: "Customer Name",
    cell: ({ row }) => <div>{row.original.customerName}</div>,
  },
  {
    accessorKey: "orderReference",
    header: "Order Reference",
    cell: ({ row }) => (
      <div className="font-medium text-muted-foreground">{row.original.orderReference}</div>
    ),
  },
  {
    accessorKey: "reason",
    header: "Reason",
    cell: ({ row }) => (
      <Badge variant="outline" className="px-1.5 font-medium bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50">
        {row.original.reason}
      </Badge>
    ),
  },
  {
    accessorKey: "amount",
    header: () => <div className="text-right">Amount</div>,
    cell: ({ row }) => (
      <div className="text-right font-medium">
        ${row.original.amount.toFixed(2)}
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge
        variant="outline"
        className={`font-medium ${getCreditsStatusColors(row.original.status)}`}
      >
        {row.original.status}
      </Badge>
    ),
  },
  {
    accessorKey: "issueDate",
    header: "Issue Date",
    cell: ({ row }) => {
      const date = new Date(row.original.issueDate)
      return (
        <div className="whitespace-nowrap">
          {date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
      )
    },
  },
]

// ============================================================================
// HELPER COMPONENT - Reusable Table Renderer
// ============================================================================
function TableRenderer<TData>({
  table,
  columns,
  serverPagination = false,
  totalCount = 0,
  isPageLoading = false,
}: {
  table: ReturnType<typeof useReactTable<TData>>
  columns: ColumnDef<TData>[]
  serverPagination?: boolean
  totalCount?: number
  isPageLoading?: boolean
}) {
  // Calculate max table width: average column width + max 150px gaps
  // This prevents tables with few columns from over-stretching
  const columnCount = columns.length
  const avgColumnWidth = 250 // Estimated average column width in pixels
  const maxGap = 150 // Maximum spacing between columns
  const maxTableWidth = columnCount * avgColumnWidth + (columnCount - 1) * maxGap

  return (
    <>
      <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border">
        <Table
          className="w-full"
          style={{
            maxWidth: `${maxTableWidth}px`,
            tableLayout: 'auto'
          }}
        >
          <TableHeader className="sticky top-0 z-10 bg-muted">
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow key={headerGroup.id}>
                {headerGroup.headers.map((header) => (
                  <TableHead
                    key={header.id}
                    colSpan={header.colSpan}
                  >
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
                <TableRow
                  key={row.id}
                  data-state={row.getIsSelected() && "selected"}
                >
                  {row.getVisibleCells().map((cell) => (
                    <TableCell key={cell.id}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
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
                  No results.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
      <div className="flex items-center justify-between px-4">
        <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
          {table.getFilteredSelectedRowModel().rows.length} of{" "}
          {serverPagination ? totalCount.toLocaleString() : table.getFilteredRowModel().rows.length} row(s) selected.
          {isPageLoading && <LoaderIcon className="ml-2 h-4 w-4 animate-spin" />}
        </div>
        <div className="flex w-full items-center gap-8 lg:w-fit">
          <div className="hidden items-center gap-2 lg:flex">
            <Label htmlFor="rows-per-page" className="text-sm font-medium">
              Rows per page
            </Label>
            <Select
              value={`${table.getState().pagination.pageSize}`}
              onValueChange={(value) => {
                table.setPageSize(Number(value))
              }}
            >
              <SelectTrigger className="w-20" id="rows-per-page">
                <SelectValue
                  placeholder={table.getState().pagination.pageSize}
                />
              </SelectTrigger>
              <SelectContent side="top">
                {[30, 50, 100, 200].map((pageSize) => (
                  <SelectItem key={pageSize} value={`${pageSize}`}>
                    {pageSize}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex w-fit items-center justify-center text-sm font-medium">
            Page {table.getState().pagination.pageIndex + 1} of{" "}
            {table.getPageCount()}
          </div>
          <div className="ml-auto flex items-center gap-2 lg:ml-0">
            <Button
              variant="outline"
              className="hidden h-8 w-8 p-0 lg:flex"
              onClick={() => table.setPageIndex(0)}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to first page</span>
              <ChevronsLeftIcon />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">Go to previous page</span>
              <ChevronLeftIcon />
            </Button>
            <Button
              variant="outline"
              className="size-8"
              size="icon"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to next page</span>
              <ChevronRightIcon />
            </Button>
            <Button
              variant="outline"
              className="hidden size-8 lg:flex"
              size="icon"
              onClick={() => table.setPageIndex(table.getPageCount() - 1)}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">Go to last page</span>
              <ChevronsRightIcon />
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}

// ============================================================================

export function DataTable({
  shipmentsData,
  additionalServicesData,
  returnsData,
  receivingData,
  storageData,
  creditsData,
  defaultPageSize = 30,
  showExport = false,
  // Server-side pagination props
  serverPagination = false,
  totalCount = 0,
  onServerPageChange,
  isPageLoading = false,
  // Client ID for unfulfilled orders tab
  clientId,
}: {
  shipmentsData: z.infer<typeof shipmentsSchema>[]
  additionalServicesData: z.infer<typeof additionalServicesSchema>[]
  returnsData: z.infer<typeof returnsSchema>[]
  receivingData: z.infer<typeof receivingSchema>[]
  storageData: z.infer<typeof storageSchema>[]
  creditsData: z.infer<typeof creditsSchema>[]
  defaultPageSize?: number
  showExport?: boolean
  // Server-side pagination - when enabled, calls onServerPageChange instead of client-side pagination
  serverPagination?: boolean
  totalCount?: number
  onServerPageChange?: (pageIndex: number, pageSize: number) => void
  isPageLoading?: boolean
  // Client ID for unfulfilled orders tab
  clientId?: string
}) {
  // ============================================================================
  // SHIPMENTS TAB - Table State and Configuration
  // ============================================================================
  const [rowSelection, setRowSelection] = React.useState({})
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [columnFilters, setColumnFilters] = React.useState<ColumnFiltersState>(
    []
  )
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: defaultPageSize,
  })
  const [exportSheetOpen, setExportSheetOpen] = React.useState(false)
  const [exportFormat, setExportFormat] = React.useState<string>("csv")
  const [filtersSheetOpen, setFiltersSheetOpen] = React.useState(false)
  const [searchExpanded, setSearchExpanded] = React.useState(false)
  const [currentTab, setCurrentTab] = React.useState("unfulfilled")

  // Calculate page count for server-side pagination
  const serverPageCount = serverPagination
    ? Math.ceil(totalCount / pagination.pageSize)
    : undefined

  // Shipments table instance
  const shipmentsTable = useReactTable({
    data: shipmentsData,
    columns: shipmentsColumns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: (updater) => {
      const newPagination = typeof updater === 'function'
        ? updater(pagination)
        : updater
      setPagination(newPagination)
      // Trigger server fetch when pagination changes in server mode
      if (serverPagination && onServerPageChange) {
        onServerPageChange(newPagination.pageIndex, newPagination.pageSize)
      }
    },
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    // Only use client-side pagination when not in server mode
    ...(serverPagination ? {} : { getPaginationRowModel: getPaginationRowModel() }),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
    // Server-side pagination settings
    ...(serverPagination ? {
      manualPagination: true,
      pageCount: serverPageCount,
    } : {}),
  })

  // ============================================================================
  // OTHER TABS - Table Instances
  // ============================================================================
  const additionalServicesTable = useReactTable({
    data: additionalServicesData,
    columns: additionalServicesColumns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  const returnsTable = useReactTable({
    data: returnsData,
    columns: returnsColumns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  const receivingTable = useReactTable({
    data: receivingData,
    columns: receivingColumns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  const storageTable = useReactTable({
    data: storageData,
    columns: storageColumns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  const creditsTable = useReactTable({
    data: creditsData,
    columns: creditsColumns,
    state: {
      sorting,
      columnVisibility,
      rowSelection,
      columnFilters,
      pagination,
    },
    getRowId: (row) => row.id.toString(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onColumnVisibilityChange: setColumnVisibility,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFacetedRowModel: getFacetedRowModel(),
    getFacetedUniqueValues: getFacetedUniqueValues(),
  })

  // Preserve scroll position when switching tabs
  const scrollPositionRef = React.useRef(0)
  const scrollContainerRef = React.useRef<Element | null>(null)

  React.useEffect(() => {
    // Find the actual scroll container (might not be window)
    const findScrollContainer = (element: Element | null): Element | null => {
      if (!element) return null

      const { overflow, overflowY } = window.getComputedStyle(element)
      const isScrollable = overflow === 'auto' || overflow === 'scroll' ||
                          overflowY === 'auto' || overflowY === 'scroll'

      if (isScrollable && element.scrollHeight > element.clientHeight) {
        return element
      }

      return findScrollContainer(element.parentElement)
    }

    // Start from the tabs component and find the scroll container
    const tabsElement = document.querySelector('[role="tablist"]')
    scrollContainerRef.current = findScrollContainer(tabsElement?.parentElement || null)

    // Intercept all clicks on tab triggers to save scroll position early
    const handleTabClick = (e: Event) => {
      const target = e.target as HTMLElement
      const tabTrigger = target.closest('[role="tab"]')
      if (tabTrigger) {
        console.log('🖱️ Tab click intercepted')

        // Add CSS class to prevent scrolling
        document.documentElement.style.scrollBehavior = 'auto'
        document.body.style.scrollBehavior = 'auto'

        // Save scroll position immediately
        const scrollContainer = scrollContainerRef.current
        const savedPosition = scrollContainer ? scrollContainer.scrollTop : window.scrollY
        scrollPositionRef.current = savedPosition

        console.log('💾 Saved position in click handler:', savedPosition)

        // DON'T preventDefault - let the tab change happen naturally
      }
    }

    // Add click listener to the tabs container
    if (tabsElement) {
      tabsElement.addEventListener('mousedown', handleTabClick, { capture: true })
      tabsElement.addEventListener('click', handleTabClick, { capture: true })
      console.log('✅ Tab click interceptors installed')
    }

    // Override scrollIntoView AND focus on all tab triggers
    const setupOverrides = () => {
      const tabTriggers = document.querySelectorAll('[role="tab"]')
      console.log('🔧 Setting up overrides for', tabTriggers.length, 'tabs')

      tabTriggers.forEach((trigger) => {
        const element = trigger as HTMLElement

        element.scrollIntoView = function(_arg?: boolean | ScrollIntoViewOptions) {
          console.log('🚫 Blocked scrollIntoView call')
          return
        }

        const originalFocus = element.focus
        element.focus = function(_options?: FocusOptions) {
          console.log('🎯 Overriding focus with preventScroll: true')
          originalFocus.call(this, { preventScroll: true })
        }
      })
    }

    // Set up immediately
    setupOverrides()

    // Also set up after a short delay in case tabs aren't ready yet
    const timeoutId = setTimeout(setupOverrides, 100)

    // Add global scroll prevention during tab changes
    const preventScroll = (e: Event) => {
      if (scrollPositionRef.current !== null && scrollPositionRef.current !== 0) {
        console.log('🚫 Preventing scroll event on:', (e.target as Element)?.tagName || 'unknown')
        e.preventDefault()
        e.stopPropagation()
      }
    }

    // Debug: Monitor all scroll events
    const debugScroll = (e: Event) => {
      const target = e.target
      if (target === document || target === window || target === document.documentElement || target === document.body) {
        console.log('📜 Window/Document scroll event detected, scrollY:', window.scrollY)
      } else if (target instanceof Element) {
        console.log('📜 Element scroll event on:', target.tagName, 'scrollTop:', target.scrollTop)
      }
    }

    document.addEventListener('scroll', preventScroll, { capture: true, passive: false })
    document.addEventListener('scroll', debugScroll, { capture: true, passive: true })

    return () => {
      clearTimeout(timeoutId)
      if (tabsElement) {
        tabsElement.removeEventListener('mousedown', handleTabClick, { capture: true })
        tabsElement.removeEventListener('click', handleTabClick, { capture: true })
      }
      document.removeEventListener('scroll', preventScroll, { capture: true })
      document.removeEventListener('scroll', debugScroll, { capture: true })
    }
  }, [])

  const handleTabChange = (value: string) => {
    setCurrentTab(value)

    // Get saved position from click handler, or save now if not available
    const scrollContainer = scrollContainerRef.current
    const savedPosition = scrollPositionRef.current || (scrollContainer ? scrollContainer.scrollTop : window.scrollY)
    scrollPositionRef.current = savedPosition

    console.log('🔄 Tab changing to:', value, '| Using saved position:', savedPosition)

    // Immediately restore scroll position synchronously (before any paint)
    const immediateRestore = () => {
      if (scrollContainer) {
        scrollContainer.scrollTop = savedPosition
      } else {
        window.scrollTo({ top: savedPosition, behavior: 'instant' as ScrollBehavior })
      }
    }

    // Call immediately
    immediateRestore()

    // Also restore on next few frames to catch any late scrolling
    let frameCount = 0
    const maxFrames = 10

    const checkAndRestore = () => {
      const currentScroll = scrollContainer ? scrollContainer.scrollTop : window.scrollY
      if (currentScroll !== savedPosition) {
        console.log('⚠️ Frame', frameCount, ': Scroll changed from', savedPosition, 'to', currentScroll, '- restoring')
        immediateRestore()
      }

      frameCount++
      if (frameCount < maxFrames) {
        requestAnimationFrame(checkAndRestore)
      } else {
        console.log('✅ Scroll monitoring complete')
        scrollPositionRef.current = 0
      }
    }

    // Start RAF monitoring
    requestAnimationFrame(checkAndRestore)
  }

  return (
    <>
    <Tabs
      defaultValue="unfulfilled"
      className="flex w-full flex-col justify-start gap-6"
      onValueChange={handleTabChange}
    >
        <div className="flex items-center justify-between gap-4 px-4 lg:px-6">
          {/* Mobile/Tablet: Table selector dropdown */}
          <Select value={currentTab} onValueChange={handleTabChange}>
            <SelectTrigger className="w-[180px] lg:hidden">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="unfulfilled">Unfulfilled</SelectItem>
              <SelectItem value="shipments">Shipments</SelectItem>
              <SelectItem value="additional-services">Additional Services</SelectItem>
              <SelectItem value="returns">Returns</SelectItem>
              <SelectItem value="receiving">Receiving</SelectItem>
              <SelectItem value="storage">Storage</SelectItem>
              <SelectItem value="credits">Credits</SelectItem>
            </SelectContent>
          </Select>

          {/* Desktop: Full tabs list */}
          <TabsList className="hidden lg:inline-flex">
            <TabsTrigger value="unfulfilled">Unfulfilled</TabsTrigger>
            <TabsTrigger value="shipments">Shipments</TabsTrigger>
            <TabsTrigger value="additional-services">Additional Services</TabsTrigger>
            <TabsTrigger value="returns">Returns</TabsTrigger>
            <TabsTrigger value="receiving">Receiving</TabsTrigger>
            <TabsTrigger value="storage">Storage</TabsTrigger>
            <TabsTrigger value="credits">Credits</TabsTrigger>
          </TabsList>

          {/* Action buttons - Always visible, search shrinks to fit */}
          <div className="flex items-center gap-1.5 md:gap-2">
            {/* Mobile search - Expands inline when clicked */}
            {!searchExpanded && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setSearchExpanded(true)}
                className="flex-shrink-0 md:hidden"
              >
                <SearchIcon className="h-4 w-4" />
              </Button>
            )}

            {searchExpanded && (
              <div className="flex flex-1 items-center gap-1.5 md:hidden">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setSearchExpanded(false)}
                  className="flex-shrink-0"
                >
                  <ChevronLeftIcon className="h-4 w-4" />
                </Button>
                <div className="relative flex-1">
                  <SearchIcon className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    placeholder="Search..."
                    className="h-9 w-full pl-8"
                    autoFocus
                  />
                </div>
              </div>
            )}

            {/* Search input (tablet+) - Visible from md breakpoint */}
            <div className="relative hidden flex-shrink-0 md:block">
              <SearchIcon className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search..."
                className="h-9 w-[140px] pl-8 lg:w-[160px] xl:w-[180px]"
              />
            </div>

            {/* Hide other buttons when search is expanded on mobile */}
            {!searchExpanded && (
              <>
                {/* Filters button - Always visible, icon-only on small screens */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setFiltersSheetOpen(true)}
                  className="flex-shrink-0"
                >
                  <FilterIcon className="h-4 w-4" />
                  <span className="ml-2 hidden 2xl:inline">Filters</span>
                </Button>

                {/* Export - Always visible, icon-only on small screens */}
                {showExport && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setExportSheetOpen(true)}
                    className="flex-shrink-0"
                  >
                    <DownloadIcon className="h-4 w-4" />
                    <span className="ml-2 hidden 2xl:inline">Export</span>
                  </Button>
                )}

                {/* Columns - Always visible, icon-only on small screens */}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" size="sm" className="flex-shrink-0">
                      <ColumnsIcon className="h-4 w-4" />
                      <span className="ml-2 hidden 2xl:inline">Columns</span>
                      <ChevronDownIcon className="h-4 w-4 2xl:ml-2" />
                    </Button>
                  </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              {/* Currently showing shipments columns only */}
              {shipmentsTable
                .getAllColumns()
                .filter(
                  (column) =>
                    typeof column.accessorFn !== "undefined" &&
                    column.getCanHide()
                )
                .map((column) => {
                  return (
                    <DropdownMenuCheckboxItem
                      key={column.id}
                      className="capitalize"
                      checked={column.getIsVisible()}
                      onCheckedChange={(value) =>
                        column.toggleVisibility(!!value)
                      }
                    >
                      {column.id}
                    </DropdownMenuCheckboxItem>
                  )
                })}
            </DropdownMenuContent>
          </DropdownMenu>
              </>
            )}
          </div>
        </div>
      {/* ============================================================================ */}
      {/* UNFULFILLED TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="unfulfilled"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6 data-[state=inactive]:hidden"
      >
        {clientId && <UnfulfilledTable clientId={clientId} />}
      </TabsContent>
      {/* ============================================================================ */}
      {/* SHIPMENTS TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="shipments"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6 data-[state=inactive]:hidden"
      >
        <TableRenderer
          table={shipmentsTable}
          columns={shipmentsColumns}
          serverPagination={serverPagination}
          totalCount={totalCount}
          isPageLoading={isPageLoading}
        />
      </TabsContent>
      {/* ============================================================================ */}
      {/* ADDITIONAL SERVICES TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="additional-services"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6 data-[state=inactive]:hidden"
      >
        <TableRenderer table={additionalServicesTable} columns={additionalServicesColumns} />
      </TabsContent>
      {/* ============================================================================ */}
      {/* RETURNS TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="returns"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6 data-[state=inactive]:hidden"
      >
        <TableRenderer table={returnsTable} columns={returnsColumns} />
      </TabsContent>
      {/* ============================================================================ */}
      {/* RECEIVING TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="receiving"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6 data-[state=inactive]:hidden"
      >
        <TableRenderer table={receivingTable} columns={receivingColumns} />
      </TabsContent>
      {/* ============================================================================ */}
      {/* STORAGE TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="storage"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6 data-[state=inactive]:hidden"
      >
        <TableRenderer table={storageTable} columns={storageColumns} />
      </TabsContent>
      {/* ============================================================================ */}
      {/* CREDITS TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="credits"
        className="relative flex flex-col gap-4 overflow-auto px-4 lg:px-6 data-[state=inactive]:hidden"
      >
        <TableRenderer table={creditsTable} columns={creditsColumns} />
      </TabsContent>
    </Tabs>

    {/* Export Sheet */}
    <Sheet open={exportSheetOpen} onOpenChange={setExportSheetOpen}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Export Data</SheetTitle>
          <SheetDescription>
            Choose your export format and options
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 py-6">
          <div className="flex flex-col gap-2">
            <Label>Format</Label>
            <Select value={exportFormat} onValueChange={setExportFormat}>
              <SelectTrigger>
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="csv">CSV</SelectItem>
                <SelectItem value="xlsx">Excel (XLSX)</SelectItem>
                <SelectItem value="json">JSON</SelectItem>
                <SelectItem value="pdf">PDF</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline">Cancel</Button>
          </SheetClose>
          <Button onClick={() => {
            console.log(`Exporting as ${exportFormat}...`)
            toast(`Exporting data as ${exportFormat.toUpperCase()}...`)
            setExportSheetOpen(false)
          }}>
            Export
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>

    {/* Filters Sheet */}
    <Sheet open={filtersSheetOpen} onOpenChange={setFiltersSheetOpen}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Filters</SheetTitle>
          <SheetDescription>
            Filter and refine your data
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 py-6">
          {/* Status Filter */}
          <div className="flex flex-col gap-2">
            <Label>Status</Label>
            <Select defaultValue="all">
              <SelectTrigger>
                <SelectValue placeholder="Select status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Statuses</SelectItem>
                <SelectItem value="shipped">Shipped</SelectItem>
                <SelectItem value="processing">Processing</SelectItem>
                <SelectItem value="delivered">Delivered</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Order Type Filter */}
          <div className="flex flex-col gap-2">
            <Label>Order Type</Label>
            <Select defaultValue="all">
              <SelectTrigger>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="b2b">B2B</SelectItem>
                <SelectItem value="d2c">D2C</SelectItem>
                <SelectItem value="wholesale">Wholesale</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Date Range Filter */}
          <div className="flex flex-col gap-2">
            <Label>Date Range</Label>
            <Select defaultValue="all">
              <SelectTrigger>
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Time</SelectItem>
                <SelectItem value="today">Today</SelectItem>
                <SelectItem value="week">This Week</SelectItem>
                <SelectItem value="month">This Month</SelectItem>
                <SelectItem value="custom">Custom Range</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <SheetFooter>
          <SheetClose asChild>
            <Button variant="outline">Clear Filters</Button>
          </SheetClose>
          <SheetClose asChild>
            <Button>Apply Filters</Button>
          </SheetClose>
        </SheetFooter>
      </SheetContent>
    </Sheet>
    </>
  )
}


