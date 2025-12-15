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
import { cn } from "@/lib/utils"
import { format } from "date-fns"

import invoicesData from "../invoices-data.json"

interface Invoice {
  issueDate: string
  invoiceNumber: string
  amount: number
  currency: string
  status: string
  summaryPdfUrl: string
  detailsXlsUrl: string
}

export default function InvoicesPage() {
  const [filtersSheetOpen, setFiltersSheetOpen] = React.useState(false)
  const [dateRange, setDateRange] = React.useState<{
    from: Date | undefined
    to: Date | undefined
  }>({
    from: undefined,
    to: undefined,
  })

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1)
  const [itemsPerPage, setItemsPerPage] = React.useState(30)

  // Column visibility state
  const [columnVisibility, setColumnVisibility] = React.useState({
    issueDate: true,
    invoiceNumber: true,
    amount: true,
    currency: true,
    status: true,
    summaryPdf: true,
    detailsXls: true,
  })

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

  // Pagination logic
  const totalInvoices = invoicesData.length
  const totalPages = Math.ceil(totalInvoices / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const paginatedInvoices = invoicesData.slice(startIndex, endIndex)

  return (
    <>
      <SiteHeader sectionName="Invoices" />
      <div className="flex flex-1 flex-col overflow-x-hidden bg-background rounded-t-xl">
        <div className="@container/main flex flex-1 flex-col gap-2 w-full">
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 w-full px-4 lg:px-6">
            {/* Description Text */}
            <p className="text-sm text-muted-foreground">
              Browse your current and previous invoices here.
            </p>

            {/* Date Range Filter and Action Buttons */}
            <div className="flex items-center justify-between gap-4">
              {/* Date Range Picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-shrink-0"
                  >
                    <CalendarIcon className="h-4 w-4" />
                    <span className="ml-2 hidden 2xl:inline">
                      {dateRange.from ? (
                        dateRange.to ? (
                          <>
                            {format(dateRange.from, "LLL dd, y")} -{" "}
                            {format(dateRange.to, "LLL dd, y")}
                          </>
                        ) : (
                          format(dateRange.from, "LLL dd, y")
                        )
                      ) : (
                        "Date Range"
                      )}
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={{
                      from: dateRange.from,
                      to: dateRange.to,
                    }}
                    onSelect={(range) => {
                      setDateRange({
                        from: range?.from,
                        to: range?.to,
                      })
                    }}
                    numberOfMonths={2}
                  />
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
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.issueDate}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, issueDate: value })
                      }
                    >
                      Issue Date
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.invoiceNumber}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, invoiceNumber: value })
                      }
                    >
                      Invoice #
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.amount}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, amount: value })
                      }
                    >
                      Amount
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.currency}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, currency: value })
                      }
                    >
                      Currency
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
                      checked={columnVisibility.summaryPdf}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, summaryPdf: value })
                      }
                    >
                      Summary PDF
                    </DropdownMenuCheckboxItem>
                    <DropdownMenuCheckboxItem
                      checked={columnVisibility.detailsXls}
                      onCheckedChange={(value) =>
                        setColumnVisibility({ ...columnVisibility, detailsXls: value })
                      }
                    >
                      Details XLS
                    </DropdownMenuCheckboxItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>

            {/* Invoices Table */}
            <div className="overflow-x-auto overflow-y-hidden rounded-lg border border-border">
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-muted">
                  <TableRow>
                    {columnVisibility.issueDate && (
                      <TableHead>Issue Date</TableHead>
                    )}
                    {columnVisibility.invoiceNumber && (
                      <TableHead>Invoice #</TableHead>
                    )}
                    {columnVisibility.amount && (
                      <TableHead className="text-right">Amount</TableHead>
                    )}
                    {columnVisibility.currency && (
                      <TableHead>Currency</TableHead>
                    )}
                    {columnVisibility.status && (
                      <TableHead>Status</TableHead>
                    )}
                    {columnVisibility.summaryPdf && (
                      <TableHead className="text-center">Summary PDF</TableHead>
                    )}
                    {columnVisibility.detailsXls && (
                      <TableHead className="text-center">Details XLS</TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(paginatedInvoices as Invoice[]).map((invoice) => (
                    <TableRow key={invoice.invoiceNumber}>
                      {columnVisibility.issueDate && (
                        <TableCell className="font-medium">
                          {formatDate(invoice.issueDate)}
                        </TableCell>
                      )}
                      {columnVisibility.invoiceNumber && (
                        <TableCell className="font-mono text-sm">
                          {invoice.invoiceNumber}
                        </TableCell>
                      )}
                      {columnVisibility.amount && (
                        <TableCell className="text-right font-semibold">
                          {formatCurrency(invoice.amount, invoice.currency)}
                        </TableCell>
                      )}
                      {columnVisibility.currency && (
                        <TableCell>
                          <Badge variant="outline" className="font-medium bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50">{invoice.currency}</Badge>
                        </TableCell>
                      )}
                      {columnVisibility.status && (
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={invoice.status === "Paid"
                              ? "font-medium bg-emerald-100/50 text-slate-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-slate-100 dark:border-emerald-800/50"
                              : "font-medium bg-red-100/50 text-slate-900 border-red-200/50 dark:bg-red-900/15 dark:text-slate-100 dark:border-red-800/50"}
                          >
                            {invoice.status}
                          </Badge>
                        </TableCell>
                      )}
                      {columnVisibility.summaryPdf && (
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 p-0"
                            onClick={() => {
                              console.log("Download PDF:", invoice.summaryPdfUrl)
                            }}
                          >
                            <FileTextIcon className="h-5 w-5 text-red-600" />
                            <span className="sr-only">Download PDF Summary</span>
                          </Button>
                        </TableCell>
                      )}
                      {columnVisibility.detailsXls && (
                        <TableCell className="text-center">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-9 w-9 p-0"
                            onClick={() => {
                              console.log("Download XLS:", invoice.detailsXlsUrl)
                            }}
                          >
                            <FileSpreadsheetIcon className="h-5 w-5 text-green-600" />
                            <span className="sr-only">Download XLS Details</span>
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Pagination Controls */}
            <div className="flex items-center justify-between px-4">
              <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
                {totalInvoices} total invoice(s)
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
              <Label>Status</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="unpaid">Unpaid</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Currency</Label>
              <Select>
                <SelectTrigger>
                  <SelectValue placeholder="All currencies" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All currencies</SelectItem>
                  <SelectItem value="usd">USD</SelectItem>
                  <SelectItem value="cad">CAD</SelectItem>
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
