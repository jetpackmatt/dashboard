"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import {
  FilterIcon,
  ColumnsIcon,
  ChevronDownIcon,
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  InfoIcon,
} from "lucide-react"

import { SiteHeader } from "@/components/site-header"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
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
import { cn } from "@/lib/utils"
import { format } from "date-fns"

import careData from "../care-data.json"

interface Ticket {
  id: number
  dateCreated: string
  type: string
  status: string
  manager: string
  issue: string
  shipDate: string
  orderId: string
  carrier: string
  tracking: string
  credit: number
  currency: string
  notes: string
  reshipment?: string
  whatToReship?: string
  reshipmentId?: number
  compensationRequest?: string
  shipId?: string
  inventoryId?: string
  trackingId?: string
  workOrderId?: string
}

// Helper function to get status badge colors
function getStatusColors(status: string) {
  switch (status) {
    case "Resolved":
      return "font-medium bg-emerald-100/50 text-slate-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-slate-100 dark:border-emerald-800/50"
    case "Credit Approved":
      return "font-medium bg-blue-100/50 text-slate-900 border-blue-200/50 dark:bg-blue-900/15 dark:text-slate-100 dark:border-blue-800/50"
    case "Credit Requested":
      return "font-medium bg-amber-100/50 text-slate-900 border-amber-200/50 dark:bg-amber-900/15 dark:text-slate-100 dark:border-amber-800/50"
    case "Under Review":
      return "font-medium bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50"
    case "Input Required":
      return "font-medium bg-red-100/50 text-slate-900 border-red-200/50 dark:bg-red-900/15 dark:text-slate-100 dark:border-red-800/50"
    default:
      return "font-medium bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50"
  }
}

export default function CarePage() {
  const router = useRouter()

  // Initialize fromDashboard by reading sessionStorage synchronously
  const [fromDashboard] = React.useState(() => {
    if (typeof window !== "undefined") {
      const navigationFlag = sessionStorage.getItem('navigatingFromDashboard')
      if (navigationFlag === 'true') {
        sessionStorage.removeItem('navigatingFromDashboard')
        return true
      }
    }
    return false
  })

  const [isNavigatingBack, setIsNavigatingBack] = React.useState(false)
  const [filtersSheetOpen, setFiltersSheetOpen] = React.useState(false)
  const [dateRange, setDateRange] = React.useState<{
    from: Date | undefined
    to: Date | undefined
  }>({
    from: undefined,
    to: undefined,
  })

  // Status filter state
  const allStatuses = ["Input Required", "Under Review", "Credit Requested", "Credit Approved", "Resolved"]
  const [selectedStatuses, setSelectedStatuses] = React.useState<string[]>(
    allStatuses.filter(status => status !== "Resolved")
  )

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1)
  const [itemsPerPage, setItemsPerPage] = React.useState(30)

  // Expanded row state
  const [expandedRowId, setExpandedRowId] = React.useState<number | null>(null)

  // Column visibility state
  const [columnVisibility, setColumnVisibility] = React.useState({
    dateCreated: true,
    type: true,
    issue: true,
    age: true,
    status: true,
    description: true,
  })

  // Intercept clicks back to Dashboard
  React.useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const link = target.closest('a[href="/dashboard"]')

      if (link) {
        e.preventDefault()
        setIsNavigatingBack(true)
        sessionStorage.setItem('navigatingFromCare', 'true')

        setTimeout(() => {
          router.push("/dashboard")
        }, 400)
      }
    }

    document.addEventListener("click", handleClick, true)
    return () => document.removeEventListener("click", handleClick, true)
  }, [router])

  const formatCurrency = (amount: number, currency: string) => {
    return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric"
    })
  }

  const calculateAge = (dateString: string) => {
    const createdDate = new Date(dateString)
    const today = new Date()
    const diffTime = Math.abs(today.getTime() - createdDate.getTime())
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24))
    return diffDays
  }

  const toggleStatus = (status: string) => {
    setSelectedStatuses(prev =>
      prev.includes(status)
        ? prev.filter(s => s !== status)
        : [...prev, status]
    )
    setCurrentPage(1) // Reset to first page when filter changes
  }

  // Sort, filter and pagination logic
  const sortedTickets = [...careData].sort((a, b) => {
    const dateA = new Date(a.dateCreated).getTime()
    const dateB = new Date(b.dateCreated).getTime()
    return dateB - dateA // Most recent first
  })

  const filteredTickets = sortedTickets.filter(ticket =>
    selectedStatuses.includes(ticket.status)
  )
  const totalTickets = filteredTickets.length
  const totalPages = Math.ceil(totalTickets / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedTickets = filteredTickets.slice(startIndex, endIndex)

  return (
    <>
      <SiteHeader sectionName="Jetpack Care Central" />
      <motion.div
        initial={fromDashboard ? { y: 700 } : false}
        animate={{ y: isNavigatingBack ? 700 : 0 }}
        transition={{
          type: "spring",
          stiffness: 100,
          damping: 20,
          mass: 0.8,
        }}
        className="flex flex-1 flex-col overflow-x-hidden"
      >
        <div className="@container/main flex flex-1 flex-col gap-2 w-full">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 w-full px-4 lg:px-6">
            {/* Description Text */}
            <p className="text-sm text-muted-foreground">
              Keep track of your open care issues, claims, credits, and resolutions.
            </p>

            {/* Status Filter and Action Buttons */}
            <div className="flex items-center justify-between gap-4">
              {/* Status Filter - Desktop (visible checkboxes) */}
              <div className="hidden lg:flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium text-muted-foreground">Filter View:</span>
                <div className="inline-flex rounded-md border border-border overflow-hidden">
                  {allStatuses.map((status, index) => (
                    <button
                      key={status}
                      onClick={() => toggleStatus(status)}
                      className={cn(
                        "px-2.5 py-1 text-xs font-medium transition-all border-r border-border last:border-r-0",
                        selectedStatuses.includes(status)
                          ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                          : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {status}
                    </button>
                  ))}
                </div>
              </div>

              {/* Status Filter - Mobile/Tablet (dropdown) */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="lg:hidden flex-shrink-0">
                    <FilterIcon className="h-4 w-4" />
                    <span className="ml-2">Status ({selectedStatuses.length})</span>
                    <ChevronDownIcon className="h-4 w-4 ml-2" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  {allStatuses.map((status) => (
                    <DropdownMenuCheckboxItem
                      key={status}
                      checked={selectedStatuses.includes(status)}
                      onCheckedChange={() => toggleStatus(status)}
                    >
                      {status}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>

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
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.dateCreated}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, dateCreated: value })
                      }
                    >
                      Date Created
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.type}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, type: value })
                      }
                    >
                      Type
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.issue}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, issue: value })
                      }
                    >
                      Issue
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.age}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, age: value })
                      }
                    >
                      Age
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
                      checked={columnVisibility.description}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, description: value })
                      }
                    >
                      Description
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Care Tickets Table */}
            <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border">
              <TooltipProvider>
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-muted">
                    <TableRow>
                      {columnVisibility.dateCreated && (
                        <TableHead>Date Created</TableHead>
                      )}
                      {columnVisibility.type && (
                        <TableHead>Type</TableHead>
                      )}
                      {columnVisibility.issue && (
                        <TableHead>Issue</TableHead>
                      )}
                      {columnVisibility.age && (
                        <TableHead>Age</TableHead>
                      )}
                      {columnVisibility.status && (
                        <TableHead>Status</TableHead>
                      )}
                      {columnVisibility.description && (
                        <TableHead className="hidden lg:table-cell">Description</TableHead>
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(paginatedTickets as Ticket[]).map((ticket) => (
                      <React.Fragment key={ticket.id}>
                        <TableRow
                          className={cn(
                            "cursor-pointer transition-colors border-b",
                            expandedRowId === ticket.id
                              ? "bg-accent/30 dark:bg-accent/20"
                              : "hover:bg-accent/20 dark:hover:bg-accent/10"
                          )}
                          onClick={() => setExpandedRowId(expandedRowId === ticket.id ? null : ticket.id)}
                        >
                          {columnVisibility.dateCreated && (
                            <TableCell className="font-medium">
                              {formatDate(ticket.dateCreated)}
                            </TableCell>
                          )}
                          {columnVisibility.type && (
                            <TableCell>
                              <Badge variant="outline" className="font-medium bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50">
                                {ticket.type}
                              </Badge>
                            </TableCell>
                          )}
                          {columnVisibility.issue && (
                            <TableCell>
                              <Tooltip delayDuration={300}>
                                <TooltipTrigger asChild>
                                  <Badge variant="outline" className="cursor-help font-medium bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50">
                                    {ticket.issue}
                                  </Badge>
                                </TooltipTrigger>
                                <TooltipContent
                                  side="right"
                                  align="start"
                                  className="max-w-[min(400px,calc(100vw-2rem))] whitespace-pre-wrap"
                                >
                                  <p className="text-sm">{ticket.notes}</p>
                                </TooltipContent>
                              </Tooltip>
                            </TableCell>
                          )}
                          {columnVisibility.age && (
                            <TableCell className="font-medium">
                              {calculateAge(ticket.dateCreated)} days
                            </TableCell>
                          )}
                          {columnVisibility.status && (
                            <TableCell>
                              <Badge
                                variant="outline"
                                className={getStatusColors(ticket.status)}
                              >
                                {ticket.status}
                              </Badge>
                            </TableCell>
                          )}
                          {columnVisibility.description && (
                            <TableCell className="hidden lg:table-cell max-w-md">
                              <p className="text-sm truncate">{ticket.notes}</p>
                            </TableCell>
                          )}
                        </TableRow>
                        {expandedRowId === ticket.id && (
                          <TableRow className="border-b-0">
                            <TableCell
                              colSpan={Object.values(columnVisibility).filter(Boolean).length}
                              className="bg-muted/60 dark:bg-muted/40 p-0 border-t-2 border-t-border shadow-inner"
                            >
                              <motion.div
                                initial={{ opacity: 0, height: 0 }}
                                animate={{ opacity: 1, height: "auto" }}
                                exit={{ opacity: 0, height: 0 }}
                                transition={{ duration: 0.2 }}
                              >
                                {ticket.type === "Claim" && (
                                  <div className="p-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                                      <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Order ID</p>
                                        <p className="text-sm font-mono font-medium">{ticket.orderId}</p>
                                      </div>
                                      <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Ship Date</p>
                                        <p className="text-sm font-medium">{formatDate(ticket.shipDate)}</p>
                                      </div>
                                      <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Carrier</p>
                                        <p className="text-sm font-medium">{ticket.carrier}</p>
                                      </div>
                                      <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Tracking Number</p>
                                        <p className="text-sm font-mono font-medium">{ticket.tracking}</p>
                                      </div>
                                      {ticket.reshipment && (
                                        <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                          <p className="text-xs font-medium text-muted-foreground mb-1">Reshipment</p>
                                          <p className="text-sm font-medium">{ticket.reshipment}</p>
                                        </div>
                                      )}
                                      {ticket.whatToReship && (
                                        <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                          <p className="text-xs font-medium text-muted-foreground mb-1">What to Reship?</p>
                                          <p className="text-sm font-medium">{ticket.whatToReship}</p>
                                        </div>
                                      )}
                                      {ticket.reshipmentId && (
                                        <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                          <p className="text-xs font-medium text-muted-foreground mb-1">Reshipment ID</p>
                                          <p className="text-sm font-mono font-medium">{ticket.reshipmentId}</p>
                                        </div>
                                      )}
                                      {ticket.compensationRequest && (
                                        <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                          <p className="text-xs font-medium text-muted-foreground mb-1">Compensation Request</p>
                                          <p className="text-sm font-medium">{ticket.compensationRequest}</p>
                                        </div>
                                      )}
                                      <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Credit</p>
                                        <p className="text-sm font-semibold">{ticket.credit > 0 ? formatCurrency(ticket.credit, ticket.currency) : "-"}</p>
                                      </div>
                                      <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                        <p className="text-xs font-medium text-muted-foreground mb-1">Currency</p>
                                        <p className="text-sm font-medium">{ticket.currency}</p>
                                      </div>
                                    </div>
                                    <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                      <p className="text-xs font-medium text-muted-foreground mb-2">Description</p>
                                      <p className="text-sm whitespace-pre-wrap">{ticket.notes}</p>
                                    </div>
                                  </div>
                                )}
                                {(ticket.type === "Inquiry" || ticket.type === "Work Order" || ticket.type === "Technical") && (
                                  <div className="p-6">
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
                                      {ticket.shipId && (
                                        <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                          <p className="text-xs font-medium text-muted-foreground mb-1">Ship ID</p>
                                          <p className="text-sm font-mono font-medium">{ticket.shipId}</p>
                                        </div>
                                      )}
                                      {ticket.inventoryId && (
                                        <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                          <p className="text-xs font-medium text-muted-foreground mb-1">Inventory ID</p>
                                          <p className="text-sm font-mono font-medium">{ticket.inventoryId}</p>
                                        </div>
                                      )}
                                      {ticket.trackingId && (
                                        <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                          <p className="text-xs font-medium text-muted-foreground mb-1">Tracking ID</p>
                                          <p className="text-sm font-mono font-medium">{ticket.trackingId}</p>
                                        </div>
                                      )}
                                      {ticket.workOrderId && (
                                        <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                          <p className="text-xs font-medium text-muted-foreground mb-1">Work Order ID</p>
                                          <p className="text-sm font-mono font-medium">{ticket.workOrderId}</p>
                                        </div>
                                      )}
                                    </div>
                                    <div className="rounded-md border border-border/50 bg-muted dark:bg-muted/20 p-3 shadow-sm">
                                      <p className="text-xs font-medium text-muted-foreground mb-2">Description</p>
                                      <p className="text-sm whitespace-pre-wrap">{ticket.notes}</p>
                                    </div>
                                  </div>
                                )}
                              </motion.div>
                            </TableCell>
                          </TableRow>
                        )}
                      </React.Fragment>
                    ))}
                  </TableBody>
                </Table>
              </TooltipProvider>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between px-4">
              <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                {totalTickets} total ticket(s)
              </div>
              <div className="flex w-full items-center gap-8 lg:w-fit">
                <div className="hidden items-center gap-2 lg:flex">
                  <Label htmlFor="rows-per-page" className="text-sm font-medium">
                    Rows per page
                  </Label>
                  <Select
                    value={`${itemsPerPage}`}
                    onValueChange={(value) => {
                      setItemsPerPage(Number(value))
                      setCurrentPage(1) // Reset to first page when changing page size
                    }}
                  >
                    <SelectTrigger className="w-20" id="rows-per-page">
                      <SelectValue placeholder={itemsPerPage} />
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
                  Page {currentPage} of {totalPages}
                </div>
                <div className="ml-auto flex items-center gap-2 lg:ml-0">
                  <Button
                    variant="outline"
                    className="hidden h-8 w-8 p-0 lg:flex"
                    onClick={() => setCurrentPage(1)}
                    disabled={currentPage === 1}
                  >
                    <span className="sr-only">Go to first page</span>
                    <ChevronsLeftIcon />
                  </Button>
                  <Button
                    variant="outline"
                    className="size-8"
                    size="icon"
                    onClick={() => setCurrentPage(currentPage - 1)}
                    disabled={currentPage === 1}
                  >
                    <span className="sr-only">Go to previous page</span>
                    <ChevronLeftIcon />
                  </Button>
                  <Button
                    variant="outline"
                    className="size-8"
                    size="icon"
                    onClick={() => setCurrentPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                  >
                    <span className="sr-only">Go to next page</span>
                    <ChevronRightIcon />
                  </Button>
                  <Button
                    variant="outline"
                    className="hidden size-8 lg:flex"
                    size="icon"
                    onClick={() => setCurrentPage(totalPages)}
                    disabled={currentPage === totalPages}
                  >
                    <span className="sr-only">Go to last page</span>
                    <ChevronsRightIcon />
                  </Button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </motion.div>

      {/* Filters Sheet */}
      <Sheet open={filtersSheetOpen} onOpenChange={setFiltersSheetOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Filter Tickets</SheetTitle>
            <SheetDescription>
              Apply filters to narrow down your ticket list
            </SheetDescription>
          </SheetHeader>
          <div className="flex flex-col gap-6 py-6">
            <div className="flex flex-col gap-2">
              <Label>Status</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="under-review">Under Review</SelectItem>
                  <SelectItem value="credit-requested">Credit Requested</SelectItem>
                  <SelectItem value="credit-approved">Credit Approved</SelectItem>
                  <SelectItem value="input-required">Input Required</SelectItem>
                  <SelectItem value="resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Issue Type</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="All types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All types</SelectItem>
                  <SelectItem value="loss">Loss</SelectItem>
                  <SelectItem value="damage">Damage</SelectItem>
                  <SelectItem value="pick-error">Pick Error</SelectItem>
                  <SelectItem value="short-ship">Short Ship</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
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
