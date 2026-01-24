"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  FilterIcon,
  ColumnsIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  PlusIcon,
  Loader2Icon,
  PencilIcon,
  SearchIcon,
  CalendarIcon,
  XIcon,
  DownloadIcon,
  FileTextIcon,
  ImageIcon,
  FileIcon,
} from "lucide-react"
import { format } from "date-fns"
import { DateRange } from "react-day-picker"
import { useDebouncedCallback } from "use-debounce"

import { SiteHeader } from "@/components/site-header"
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { MultiSelectFilter, FilterOption } from "@/components/ui/multi-select-filter"
import { cn } from "@/lib/utils"
import { useClient } from "@/components/client-context"
import { ClientBadge } from "@/components/transactions/client-badge"
import { getTrackingUrl } from "@/components/transactions/cell-renderers"
import { ShipmentDetailsDrawer } from "@/components/shipment-details-drawer"

// Import static data as fallback
import careDataStatic from "../care-data.json"

// Event interface for timeline
interface TicketEvent {
  status: string
  note: string
  createdAt: string
  createdBy: string
}

// Internal note interface (for internal notes timeline)
interface InternalNote {
  note: string
  createdAt: string
  createdBy: string
}

// File attachment interface
interface FileAttachment {
  name: string
  url: string
  type: string // file extension: pdf, jpg, png, etc.
  uploadedAt: string
}

// Partner type for tickets
type Partner = 'shipbob' | 'eshipper'

// API response ticket interface
interface Ticket {
  id: string
  ticketNumber: number
  clientId: string | null
  clientName: string
  partner: Partner
  ticketType: string
  issueType: string | null
  status: string
  manager: string | null
  orderId: string | null
  shipmentId: string | null
  shipDate: string | null
  carrier: string | null
  trackingNumber: string | null
  reshipmentStatus: string | null
  whatToReship: string | null
  reshipmentId: string | null
  compensationRequest: string | null
  creditAmount: number
  currency: string
  workOrderId: string | null
  inventoryId: string | null
  description: string | null
  internalNotes: InternalNote[] | null
  // Attachments
  attachments: FileAttachment[] | null
  // Events timeline
  events: TicketEvent[]
  latestNote: string | null
  lastUpdated: string | null
  // Timestamps
  createdAt: string
  updatedAt: string
  resolvedAt: string | null
}

// Static data ticket interface (for fallback)
interface StaticTicket {
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
  attachments?: { name: string; url: string; type: string; uploadedAt: string }[]
}

// Date range presets
type DateRangePreset = 'today' | '7d' | '30d' | '60d' | 'mtd' | 'ytd' | 'all' | 'custom'

const DATE_RANGE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '7d', label: '7D' },
  { value: '30d', label: '30D' },
  { value: '60d', label: '60D' },
  { value: 'mtd', label: 'MTD' },
  { value: 'ytd', label: 'YTD' },
  { value: 'all', label: 'All' },
]

function getDateRangeFromPreset(preset: DateRangePreset): { from: Date; to: Date } | null {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())

  switch (preset) {
    case 'today':
      return { from: today, to: today }
    case '7d':
      const sevenDaysAgo = new Date(today)
      sevenDaysAgo.setDate(today.getDate() - 6)
      return { from: sevenDaysAgo, to: today }
    case '30d':
      const thirtyDaysAgo = new Date(today)
      thirtyDaysAgo.setDate(today.getDate() - 29)
      return { from: thirtyDaysAgo, to: today }
    case '60d':
      const sixtyDaysAgo = new Date(today)
      sixtyDaysAgo.setDate(today.getDate() - 59)
      return { from: sixtyDaysAgo, to: today }
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

// Filter options for multi-select
const STATUS_OPTIONS: FilterOption[] = [
  { value: 'Input Required', label: 'Input Required' },
  { value: 'Under Review', label: 'Under Review' },
  { value: 'Credit Requested', label: 'Credit Requested' },
  { value: 'Credit Approved', label: 'Credit Approved' },
  { value: 'Resolved', label: 'Resolved' },
]

const TYPE_OPTIONS: FilterOption[] = [
  { value: 'Claim', label: 'Claim' },
  { value: 'Work Order', label: 'Request' },
  { value: 'Technical', label: 'Technical' },
  { value: 'Inquiry', label: 'Inquiry' },
]

const ISSUE_OPTIONS: FilterOption[] = [
  { value: 'Loss', label: 'Loss' },
  { value: 'Damage', label: 'Damage' },
  { value: 'Pick Error', label: 'Pick Error' },
  { value: 'Short Ship', label: 'Short Ship' },
  { value: 'Other', label: 'Other' },
]

// All possible statuses - defined at module level to avoid recreating on each render
const ALL_STATUSES = ["Input Required", "Under Review", "Credit Requested", "Credit Approved", "Resolved"]

// Default statuses to show when no filter is active (excludes Resolved)
const DEFAULT_STATUSES = ALL_STATUSES.filter(s => s !== "Resolved")

// Helper function to get status badge colors
function getStatusColors(status: string) {
  switch (status) {
    case "Resolved":
      return "font-medium bg-emerald-100/50 text-slate-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-slate-100 dark:border-emerald-800/50"
    case "Credit Approved":
      return "font-medium bg-emerald-100/50 text-slate-900 border-emerald-200/50 dark:bg-emerald-900/15 dark:text-slate-100 dark:border-emerald-800/50"
    case "Credit Requested":
      return "font-medium bg-amber-100/50 text-slate-900 border-amber-200/50 dark:bg-amber-900/15 dark:text-slate-100 dark:border-amber-800/50"
    case "Under Review":
      return "font-medium bg-blue-100/50 text-slate-900 border-blue-200/50 dark:bg-blue-900/15 dark:text-slate-100 dark:border-blue-800/50"
    case "Input Required":
      return "font-medium bg-red-100/50 text-slate-900 border-red-200/50 dark:bg-red-900/15 dark:text-slate-100 dark:border-red-800/50"
    default:
      return "font-medium bg-slate-100/50 text-slate-900 border-slate-200/50 dark:bg-slate-900/15 dark:text-slate-100 dark:border-slate-800/50"
  }
}

// Helper function to get status text color for timeline (no background)
// Only "Input Required" gets colored text (red) to draw customer attention
function getStatusTextColor(status: string) {
  switch (status) {
    case "Input Required":
      return "text-red-600 dark:text-red-400"
    default:
      return "text-foreground"
  }
}

// Helper function to get status dot color for timeline (filled circle)
function getStatusDotColor(status: string) {
  switch (status) {
    case "Resolved":
      return "bg-emerald-500 border-emerald-500 shadow-sm shadow-emerald-500/30"
    case "Credit Approved":
      return "bg-emerald-500 border-emerald-500 shadow-sm shadow-emerald-500/30"
    case "Credit Requested":
      return "bg-amber-400 border-amber-400 shadow-sm shadow-amber-400/30"
    case "Under Review":
      return "bg-blue-500 border-blue-500 shadow-sm shadow-blue-500/30"
    case "Input Required":
      return "bg-red-500 border-red-500 shadow-sm shadow-red-500/30"
    default:
      return "bg-slate-400 border-slate-400 shadow-sm shadow-slate-400/30"
  }
}

// Helper function to get file type icon based on extension
function getFileIcon(fileType: string) {
  const type = fileType.toLowerCase()
  if (type === 'pdf') {
    return <FileTextIcon className="h-3.5 w-3.5 text-red-500" />
  } else if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(type)) {
    return <ImageIcon className="h-3.5 w-3.5 text-blue-500" />
  } else {
    return <FileIcon className="h-3.5 w-3.5 text-slate-500" />
  }
}

// Convert static ticket to API format
function staticToApiTicket(s: StaticTicket): Ticket {
  return {
    id: s.id.toString(),
    ticketNumber: s.id,
    clientId: null,
    clientName: 'Demo Client',
    partner: 'shipbob', // Default to ShipBob for demo data
    ticketType: s.type,
    issueType: s.issue,
    status: s.status,
    manager: s.manager,
    orderId: s.orderId,
    shipmentId: s.shipId || null,
    shipDate: s.shipDate,
    carrier: s.carrier,
    trackingNumber: s.tracking || s.trackingId || null,
    reshipmentStatus: s.reshipment || null,
    whatToReship: s.whatToReship || null,
    reshipmentId: s.reshipmentId?.toString() || null,
    compensationRequest: s.compensationRequest || null,
    creditAmount: s.credit,
    currency: s.currency,
    workOrderId: s.workOrderId || null,
    inventoryId: s.inventoryId || null,
    description: s.notes,
    internalNotes: null,
    attachments: s.attachments || null,
    // Demo events for static data
    events: [],
    latestNote: null,
    lastUpdated: s.dateCreated,
    createdAt: s.dateCreated,
    updatedAt: s.dateCreated,
    resolvedAt: null,
  }
}

export default function CarePage() {
  const { selectedClientId, isAdmin } = useClient()
  const [filtersSheetOpen, setFiltersSheetOpen] = React.useState(false)
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)

  // Data state
  const [tickets, setTickets] = React.useState<Ticket[]>([])
  const [totalCount, setTotalCount] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [usingStaticData, setUsingStaticData] = React.useState(false)

  // Search state
  const [searchInput, setSearchInput] = React.useState('')
  const [searchQuery, setSearchQuery] = React.useState('')

  // Debounced search
  const debouncedSearch = useDebouncedCallback((value: string) => {
    setSearchQuery(value)
  }, 300)

  // Date range state
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(undefined)
  const [datePreset, setDatePreset] = React.useState<DateRangePreset | undefined>('all')
  const [isCustomRangeOpen, setIsCustomRangeOpen] = React.useState(false)
  const [isAwaitingEndDate, setIsAwaitingEndDate] = React.useState(false)

  // Filter state - multi-select arrays
  const [statusFilter, setStatusFilter] = React.useState<string[]>([])
  const [typeFilter, setTypeFilter] = React.useState<string[]>([])
  const [issueFilter, setIssueFilter] = React.useState<string[]>([])
  const [filtersExpanded, setFiltersExpanded] = React.useState(false)

  // Memoize selected statuses to prevent infinite loops in useCallback dependencies
  const selectedStatuses = React.useMemo(() => {
    return statusFilter.length > 0 ? statusFilter : DEFAULT_STATUSES
  }, [statusFilter])

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1)
  const [itemsPerPage, setItemsPerPage] = React.useState(30)

  // Expanded row state
  const [expandedRowId, setExpandedRowId] = React.useState<string | null>(null)

  // Column visibility state
  // Order: Client, Created, Reference, Type, Issue, Status, Updated, Description
  const [columnVisibility, setColumnVisibility] = React.useState({
    client: true,
    dateCreated: true,
    reference: true,
    type: true,
    issue: true,
    status: true,
    lastUpdated: true,
    latestNotes: true,
  })

  // Get the most relevant reference ID for a ticket based on its type
  const getReferenceId = (ticket: Ticket): string | null => {
    // For Claims, prioritize shipment ID, then order ID
    if (ticket.ticketType === 'Claim') {
      return ticket.shipmentId || ticket.orderId || null
    }
    // For Work Orders, use work order ID or inventory ID
    if (ticket.ticketType === 'Work Order') {
      return ticket.workOrderId || ticket.inventoryId || null
    }
    // For Technical/Inquiry, use order ID or shipment ID
    return ticket.orderId || ticket.shipmentId || null
  }

  // Create ticket form state
  const [createForm, setCreateForm] = React.useState({
    ticketType: 'Claim',
    issueType: '',
    orderId: '',
    carrier: '',
    trackingNumber: '',
    description: '',
    reshipmentStatus: '',
    whatToReship: '',
    compensationRequest: '',
    creditAmount: '',
    currency: 'USD',
  })
  const [isCreating, setIsCreating] = React.useState(false)

  // Edit ticket state
  const [editDialogOpen, setEditDialogOpen] = React.useState(false)
  const [editingTicket, setEditingTicket] = React.useState<Ticket | null>(null)
  const [editForm, setEditForm] = React.useState({
    ticketType: '',
    issueType: '',
    status: '',
    manager: '',
    orderId: '',
    shipmentId: '',
    shipDate: '',
    carrier: '',
    trackingNumber: '',
    description: '',
    internalNote: '', // New internal note to add (singular)
    reshipmentStatus: '',
    whatToReship: '',
    reshipmentId: '',
    compensationRequest: '',
    creditAmount: '',
    currency: 'USD',
    workOrderId: '',
    inventoryId: '',
  })
  const [isUpdating, setIsUpdating] = React.useState(false)

  // Delete ticket state
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [deletingTicket, setDeletingTicket] = React.useState<Ticket | null>(null)
  const [isDeleting, setIsDeleting] = React.useState(false)

  // Status update state
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false)
  const [statusTicket, setStatusTicket] = React.useState<Ticket | null>(null)
  const [newStatus, setNewStatus] = React.useState('')
  const [statusNote, setStatusNote] = React.useState('')
  const [isUpdatingStatus, setIsUpdatingStatus] = React.useState(false)

  // Shipment details drawer state
  const [shipmentDrawerOpen, setShipmentDrawerOpen] = React.useState(false)
  const [selectedShipmentId, setSelectedShipmentId] = React.useState<string | null>(null)

  // Add internal note state
  const [addNoteOpenForTicket, setAddNoteOpenForTicket] = React.useState<string | null>(null)
  const [newNoteText, setNewNoteText] = React.useState('')
  const [isAddingNote, setIsAddingNote] = React.useState(false)

  // Compute filter counts
  const hasFilters = statusFilter.length > 0 || typeFilter.length > 0 || issueFilter.length > 0
  const filterCount = statusFilter.length + typeFilter.length + issueFilter.length

  // Calculate actual rendered column count (for colSpan)
  const actualColumnCount =
    (columnVisibility.client && isAdmin && !selectedClientId ? 1 : 0) +
    (isAdmin && !selectedClientId ? 1 : 0) + // Partner column
    (columnVisibility.dateCreated ? 1 : 0) +
    (columnVisibility.reference ? 1 : 0) +
    (columnVisibility.type ? 1 : 0) +
    (columnVisibility.issue ? 1 : 0) +
    (columnVisibility.status ? 1 : 0) +
    (columnVisibility.lastUpdated ? 1 : 0) +
    (columnVisibility.latestNotes ? 1 : 0)

  const clearFilters = () => {
    setStatusFilter([])
    setTypeFilter([])
    setIssueFilter([])
    setDateRange(undefined)
    setDatePreset('all')
    setCurrentPage(1)
  }

  // Handle date preset change
  const handleDatePresetChange = (preset: DateRangePreset) => {
    setDatePreset(preset)
    if (preset === 'custom') {
      setIsCustomRangeOpen(true)
    } else if (preset === 'all') {
      setDateRange(undefined)
      setIsCustomRangeOpen(false)
    } else {
      const range = getDateRangeFromPreset(preset)
      if (range) {
        setDateRange({ from: range.from, to: range.to })
      }
      setIsCustomRangeOpen(false)
    }
    setCurrentPage(1)
  }

  // Handle custom range selection
  const handleCustomRangeSelect = (range: { from: Date | undefined; to: Date | undefined }) => {
    if (!isAwaitingEndDate) {
      const clickedDate = range.from || range.to
      if (clickedDate) {
        setDateRange({ from: clickedDate, to: undefined })
        setIsAwaitingEndDate(true)
      }
      return
    }
    if (range.from && range.to && range.from.getTime() !== range.to.getTime()) {
      setDateRange(range)
      setDatePreset('custom')
      setIsCustomRangeOpen(false)
      setIsAwaitingEndDate(false)
      setCurrentPage(1)
    } else if (range.from && range.to) {
      setDateRange(range)
    } else {
      setDateRange(range)
    }
  }

  // Format custom range display
  const customRangeLabel = React.useMemo(() => {
    if (dateRange?.from && dateRange?.to) {
      return `${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d')}`
    }
    return 'Custom'
  }, [dateRange])

  // Fetch tickets from API
  const fetchTickets = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (selectedClientId && selectedClientId !== 'all') {
        params.set('clientId', selectedClientId)
      }
      if (selectedStatuses.length > 0 && selectedStatuses.length < ALL_STATUSES.length) {
        params.set('status', selectedStatuses.join(','))
      }
      if (typeFilter.length > 0) {
        params.set('type', typeFilter.join(','))
      }
      if (issueFilter.length > 0) {
        params.set('issue', issueFilter.join(','))
      }
      if (dateRange?.from) {
        params.set('startDate', dateRange.from.toISOString().split('T')[0])
      }
      if (dateRange?.to) {
        params.set('endDate', dateRange.to.toISOString().split('T')[0])
      }
      if (searchQuery) {
        params.set('search', searchQuery)
      }
      params.set('limit', itemsPerPage.toString())
      params.set('offset', ((currentPage - 1) * itemsPerPage).toString())

      const response = await fetch(`/api/data/care-tickets?${params}`)

      if (!response.ok) {
        // If 500 error (likely table doesn't exist), fall back to static data
        if (response.status === 500) {
          console.log('Care tickets API not available, using static data')
          setUsingStaticData(true)
          const staticTickets = (careDataStatic as StaticTicket[]).map(staticToApiTicket)
          // Apply status filter to static data
          const filtered = staticTickets.filter(t => selectedStatuses.includes(t.status))
          setTickets(filtered)
          setTotalCount(filtered.length)
          setIsLoading(false)
          return
        }
        throw new Error('Failed to fetch tickets')
      }

      const data = await response.json()
      // Inject demo attachments for testing file display
      // All Claim types except Loss get one file, one Damage claim gets two files
      let firstDamageSeen = false
      const ticketsWithDemoFiles = (data.data || []).map((t: Ticket) => {
        // Only add files to Claim tickets that are NOT Loss type
        if (t.ticketType === 'Claim' && t.issueType !== 'Loss') {
          // First Damage claim gets two files
          if (t.issueType === 'Damage' && !firstDamageSeen) {
            firstDamageSeen = true
            return {
              ...t,
              attachments: [
                { name: 'damage-photo.jpg', url: '#', type: 'jpg' },
                { name: 'claim-form.pdf', url: '#', type: 'pdf' },
              ]
            }
          }
          // Other non-Loss claims get one file based on issue type
          if (t.issueType === 'Damage') {
            return { ...t, attachments: [{ name: 'damage-photo.jpg', url: '#', type: 'jpg' }] }
          }
          if (t.issueType === 'Pick Error') {
            return { ...t, attachments: [{ name: 'wrong-item-photo.jpg', url: '#', type: 'jpg' }] }
          }
          if (t.issueType === 'Short Ship') {
            return { ...t, attachments: [{ name: 'packing-slip.pdf', url: '#', type: 'pdf' }] }
          }
          // Default for any other claim issues
          return { ...t, attachments: [{ name: 'evidence.jpg', url: '#', type: 'jpg' }] }
        }
        return t
      })
      setTickets(ticketsWithDemoFiles)
      setTotalCount(data.totalCount || 0)
      setUsingStaticData(false)
    } catch (err) {
      console.error('Error fetching care tickets:', err)
      // Fall back to static data on any error
      setUsingStaticData(true)
      const staticTickets = (careDataStatic as StaticTicket[]).map(staticToApiTicket)
      const filtered = staticTickets.filter(t => selectedStatuses.includes(t.status))
      setTickets(filtered)
      setTotalCount(filtered.length)
    } finally {
      setIsLoading(false)
    }
  }, [selectedClientId, selectedStatuses, typeFilter, issueFilter, dateRange, searchQuery, currentPage, itemsPerPage])

  // Fetch on mount and when filters change
  React.useEffect(() => {
    fetchTickets()
  }, [fetchTickets])

  const formatCurrency = (amount: number) => {
    return `$${amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  }

  const formatDate = (dateString: string | null) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    // Short format: MM/DD (no year to save space)
    const month = (date.getMonth() + 1).toString()
    const day = date.getDate().toString()
    return `${month}/${day}`
  }

  const formatTimeOnly = (dateString: string | null) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    // Format: H:MM AM/PM
    let hours = date.getHours()
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12
    hours = hours ? hours : 12 // 0 should be 12
    return `${hours}:${minutes} ${ampm}`
  }

  const formatDateTime = (dateString: string | null, createdBy?: string | null) => {
    if (!dateString) return '-'
    const date = new Date(dateString)
    // Format: MM/DD/YY at H:MM AM/PM by FirstName
    const month = (date.getMonth() + 1).toString()
    const day = date.getDate().toString()
    const year = date.getFullYear().toString().slice(-2)
    let hours = date.getHours()
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12
    hours = hours ? hours : 12 // 0 should be 12
    let result = `${month}/${day}/${year} at ${hours}:${minutes} ${ampm}`
    if (createdBy) {
      // Get first name only (split by space, take first part)
      const firstName = createdBy.split(' ')[0]
      result += ` by ${firstName}`
    }
    return result
  }

  // Calculate ticket age in days (frozen at resolution time for resolved tickets)
  const formatAge = (createdAt: string, resolvedAt: string | null) => {
    const startDate = new Date(createdAt)
    const endDate = resolvedAt ? new Date(resolvedAt) : new Date()
    const diffMs = endDate.getTime() - startDate.getTime()
    const days = diffMs / (1000 * 60 * 60 * 24)
    return `${days.toFixed(1)}d`
  }


  // Sort tickets by date (most recent first) - for static data
  const sortedTickets = React.useMemo(() => {
    if (!usingStaticData) return tickets
    return [...tickets].sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime()
      const dateB = new Date(b.createdAt).getTime()
      return dateB - dateA
    })
  }, [tickets, usingStaticData])

  // Pagination for static data (API handles its own pagination)
  const displayedTickets = React.useMemo(() => {
    if (!usingStaticData) return sortedTickets
    const startIndex = (currentPage - 1) * itemsPerPage
    return sortedTickets.slice(startIndex, startIndex + itemsPerPage)
  }, [sortedTickets, currentPage, itemsPerPage, usingStaticData])

  const totalPages = Math.ceil(totalCount / itemsPerPage)

  // Handle create ticket
  const handleCreateTicket = async () => {
    if (!selectedClientId || selectedClientId === 'all') {
      setError('Please select a client first')
      return
    }

    setIsCreating(true)
    try {
      const response = await fetch('/api/data/care-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: selectedClientId,
          ticketType: createForm.ticketType,
          issueType: createForm.issueType || null,
          orderId: createForm.orderId || null,
          carrier: createForm.carrier || null,
          trackingNumber: createForm.trackingNumber || null,
          description: createForm.description || null,
          reshipmentStatus: createForm.reshipmentStatus || null,
          whatToReship: createForm.whatToReship || null,
          compensationRequest: createForm.compensationRequest || null,
          creditAmount: createForm.creditAmount ? parseFloat(createForm.creditAmount) : 0,
          currency: createForm.currency,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create ticket')
      }

      // Reset form and close dialog
      setCreateForm({
        ticketType: 'Claim',
        issueType: '',
        orderId: '',
        carrier: '',
        trackingNumber: '',
        description: '',
        reshipmentStatus: '',
        whatToReship: '',
        compensationRequest: '',
        creditAmount: '',
        currency: 'USD',
      })
      setCreateDialogOpen(false)
      // Refresh tickets
      fetchTickets()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create ticket')
    } finally {
      setIsCreating(false)
    }
  }

  // Open edit dialog with ticket data
  const openEditDialog = (ticket: Ticket, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent row expansion
    setEditingTicket(ticket)
    setEditForm({
      ticketType: ticket.ticketType || '',
      issueType: ticket.issueType || '',
      status: ticket.status || '',
      manager: ticket.manager || '',
      orderId: ticket.orderId || '',
      shipmentId: ticket.shipmentId || '',
      shipDate: ticket.shipDate ? ticket.shipDate.split('T')[0] : '',
      carrier: ticket.carrier || '',
      trackingNumber: ticket.trackingNumber || '',
      description: ticket.description || '',
      internalNote: '', // Start empty - user adds a NEW note, doesn't edit existing ones
      reshipmentStatus: ticket.reshipmentStatus || '',
      whatToReship: ticket.whatToReship || '',
      reshipmentId: ticket.reshipmentId || '',
      compensationRequest: ticket.compensationRequest || '',
      creditAmount: ticket.creditAmount?.toString() || '',
      currency: ticket.currency || 'USD',
      workOrderId: ticket.workOrderId || '',
      inventoryId: ticket.inventoryId || '',
    })
    setEditDialogOpen(true)
  }

  // Handle update ticket
  const handleUpdateTicket = async () => {
    if (!editingTicket) return

    setIsUpdating(true)
    try {
      const response = await fetch(`/api/data/care-tickets/${editingTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ticketType: editForm.ticketType || null,
          issueType: editForm.issueType || null,
          status: editForm.status || null,
          manager: editForm.manager || null,
          orderId: editForm.orderId || null,
          shipmentId: editForm.shipmentId || null,
          shipDate: editForm.shipDate || null,
          carrier: editForm.carrier || null,
          trackingNumber: editForm.trackingNumber || null,
          description: editForm.description || null,
          internalNote: editForm.internalNote || null,
          reshipmentStatus: editForm.reshipmentStatus || null,
          whatToReship: editForm.whatToReship || null,
          reshipmentId: editForm.reshipmentId || null,
          compensationRequest: editForm.compensationRequest || null,
          creditAmount: editForm.creditAmount ? parseFloat(editForm.creditAmount) : 0,
          currency: editForm.currency,
          workOrderId: editForm.workOrderId || null,
          inventoryId: editForm.inventoryId || null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update ticket')
      }

      // Close dialog and refresh
      setEditDialogOpen(false)
      setEditingTicket(null)
      fetchTickets()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update ticket')
    } finally {
      setIsUpdating(false)
    }
  }

  // Open delete confirmation dialog
  const openDeleteDialog = (ticket: Ticket, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent row expansion
    setDeletingTicket(ticket)
    setDeleteDialogOpen(true)
  }

  // Handle soft delete ticket (set status to 'Deleted')
  const handleDeleteTicket = async () => {
    if (!deletingTicket) return

    setIsDeleting(true)
    try {
      const response = await fetch(`/api/data/care-tickets/${deletingTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'Deleted',
          eventNote: 'Ticket deleted',
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete ticket')
      }

      // Close dialog and refresh
      setDeleteDialogOpen(false)
      setDeletingTicket(null)
      setExpandedRowId(null) // Collapse the row
      fetchTickets()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete ticket')
    } finally {
      setIsDeleting(false)
    }
  }

  // Open status update dialog
  const openStatusDialog = (ticket: Ticket, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent row expansion
    setStatusTicket(ticket)
    setNewStatus(ticket.status)
    setStatusNote('')
    setStatusDialogOpen(true)
  }

  // Handle status update
  const handleStatusUpdate = async () => {
    if (!statusTicket || !newStatus) return

    setIsUpdatingStatus(true)
    try {
      const response = await fetch(`/api/data/care-tickets/${statusTicket.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: newStatus,
          eventNote: statusNote || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update status')
      }

      // Close dialog and refresh
      setStatusDialogOpen(false)
      setStatusTicket(null)
      setNewStatus('')
      setStatusNote('')
      fetchTickets()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update status')
    } finally {
      setIsUpdatingStatus(false)
    }
  }

  // Handle add internal note
  const handleAddInternalNote = async (ticketId: string) => {
    if (!newNoteText.trim()) return

    setIsAddingNote(true)
    try {
      const response = await fetch(`/api/data/care-tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          internalNote: newNoteText.trim(),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to add note')
      }

      // Close popover and refresh
      setAddNoteOpenForTicket(null)
      setNewNoteText('')
      fetchTickets()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add note')
    } finally {
      setIsAddingNote(false)
    }
  }

  return (
    <>
      <SiteHeader sectionName="Jetpack Care" />
      <div className="flex flex-1 flex-col overflow-x-hidden bg-background rounded-t-xl h-[calc(100vh-64px)] px-4 lg:px-6">
        {/* Error message */}
        {error && (
          <div className="p-3 mt-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-700 dark:text-red-300">
            {error}
            <button
              onClick={() => setError(null)}
              className="ml-2 underline"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Sticky header with filter bar */}
        <div className="sticky top-0 z-20 -mx-4 lg:-mx-6 bg-muted/60 dark:bg-zinc-900/60 rounded-t-xl">
          {/* Controls row: Search + Date Range (left) | Filters + New Ticket + Columns (right) */}
          <div className="px-4 lg:px-6 py-4 flex items-center justify-between gap-4">
            {/* LEFT SIDE: Search + Date Range */}
            <div className="flex items-center gap-3">
              {/* Search Input */}
              <div className="relative w-48 2xl:w-64">
                <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search tickets..."
                  value={searchInput}
                  onChange={(e) => {
                    setSearchInput(e.target.value)
                    debouncedSearch(e.target.value)
                  }}
                  className="h-[30px] pl-9 text-sm bg-background border-border text-muted-foreground placeholder:text-muted-foreground/60"
                />
                {searchInput && (
                  <button
                    onClick={() => {
                      setSearchInput("")
                      setSearchQuery("")
                    }}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Date Range Dropdown */}
              <Popover
                open={isCustomRangeOpen}
                onOpenChange={(open) => {
                  if (open) {
                    setIsCustomRangeOpen(true)
                    setIsAwaitingEndDate(false)
                  } else {
                    setIsCustomRangeOpen(false)
                  }
                }}
                modal={false}
              >
                <div className="flex items-center gap-1">
                  <Select
                    value={datePreset === 'custom' ? 'custom' : (datePreset || 'all')}
                    onValueChange={(value) => {
                      if (value === 'custom') {
                        setIsCustomRangeOpen(true)
                      } else {
                        handleDatePresetChange(value as DateRangePreset)
                        setIsCustomRangeOpen(false)
                      }
                    }}
                  >
                    <SelectTrigger className="h-[30px] w-auto gap-1.5 text-sm bg-background">
                      <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      <SelectValue>
                        {datePreset === 'custom'
                          ? customRangeLabel
                          : DATE_RANGE_PRESETS.find(p => p.value === datePreset)?.label || 'All'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {DATE_RANGE_PRESETS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                      <SelectItem value="custom">Custom Range...</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <PopoverContent
                  className="w-auto p-3"
                  align="start"
                  onInteractOutside={(e) => e.preventDefault()}
                  onPointerDownOutside={(e) => e.preventDefault()}
                  onFocusOutside={(e) => e.preventDefault()}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Select Date Range</span>
                    </div>
                    {(dateRange?.from || dateRange?.to) && (
                      <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                        <div className="flex-1 text-xs">
                          <span className="text-muted-foreground">From: </span>
                          <span className="font-medium">
                            {dateRange?.from ? format(dateRange.from, 'MMM d, yyyy') : '—'}
                          </span>
                        </div>
                        <div className="flex-1 text-xs">
                          <span className="text-muted-foreground">To: </span>
                          <span className="font-medium">
                            {dateRange?.to ? format(dateRange.to, 'MMM d, yyyy') : '—'}
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setDateRange(undefined)
                            setDatePreset('all')
                            setIsCustomRangeOpen(false)
                            setIsAwaitingEndDate(false)
                          }}
                          className="px-2 py-1 text-xs bg-background hover:bg-muted rounded border text-muted-foreground hover:text-foreground transition-colors"
                        >
                          Reset
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
                        from: dateRange?.from,
                        to: dateRange?.to,
                      }}
                      onSelect={(range) => handleCustomRangeSelect({ from: range?.from, to: range?.to })}
                      numberOfMonths={2}
                    />
                  </div>
                </PopoverContent>
              </Popover>

              {/* Loading indicator */}
              {isLoading && (
                <div className="flex items-center gap-1.5">
                  <Loader2Icon className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span className="text-xs text-muted-foreground">Loading</span>
                </div>
              )}

              {/* Demo data indicator */}
              {usingStaticData && (
                <span className="text-xs text-amber-600 dark:text-amber-400">(Demo data)</span>
              )}
            </div>

            {/* RIGHT SIDE: Filters toggle + New Ticket + Columns */}
            <div className="flex items-center gap-2">
              {/* Filters button with badge */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFiltersExpanded(!filtersExpanded)}
                className={cn(
                  "h-[30px] flex-shrink-0 gap-1.5 text-muted-foreground",
                  filtersExpanded && "bg-accent text-accent-foreground"
                )}
              >
                <FilterIcon className="h-4 w-4" />
                <span className="hidden lg:inline">Filters</span>
                {hasFilters && (
                  <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 text-xs font-medium rounded-full bg-muted text-muted-foreground">
                    {filterCount}
                  </span>
                )}
                {filtersExpanded ? (
                  <ChevronUpIcon className="h-3.5 w-3.5 ml-0.5" />
                ) : (
                  <ChevronDownIcon className="h-3.5 w-3.5 ml-0.5" />
                )}
              </Button>

              {/* New Ticket Button - only show if using real data */}
              {!usingStaticData && (
                <Button size="sm" className="h-[30px]" onClick={() => setCreateDialogOpen(true)}>
                  <PlusIcon className="h-4 w-4 mr-1" />
                  <span className="hidden lg:inline">New Ticket</span>
                </Button>
              )}

              {/* Columns button */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-[30px] flex-shrink-0 text-muted-foreground">
                    <ColumnsIcon className="h-4 w-4" />
                    <ChevronDownIcon className="h-4 w-4 lg:ml-1" />
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
                    checked={columnVisibility.reference}
                    onCheckedChange={(value) =>
                      setColumnVisibility({ ...columnVisibility, reference: value })
                    }
                  >
                    Reference #
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
                    checked={columnVisibility.status}
                    onCheckedChange={(value) =>
                      setColumnVisibility({ ...columnVisibility, status: value })
                    }
                  >
                    Status
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={columnVisibility.lastUpdated}
                    onCheckedChange={(value) =>
                      setColumnVisibility({ ...columnVisibility, lastUpdated: value })
                    }
                  >
                    Age
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem
                    checked={columnVisibility.latestNotes}
                    onCheckedChange={(value) =>
                      setColumnVisibility({ ...columnVisibility, latestNotes: value })
                    }
                  >
                    Description
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Expandable Filter Bar */}
          {filtersExpanded && (
            <div className="px-4 lg:px-6 pt-0 pb-4 flex items-center justify-end gap-4 animate-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-2">
                {/* Clear Filters - show first, only when filters are active */}
                {hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={clearFilters}
                    className="h-[30px] px-2 gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Clear</span>
                  </Button>
                )}

                {/* Status Filter */}
                <MultiSelectFilter
                  options={STATUS_OPTIONS}
                  selected={statusFilter}
                  onSelectionChange={(values) => {
                    setStatusFilter(values)
                    setCurrentPage(1)
                  }}
                  placeholder="Status"
                  className="w-[140px]"
                />

                {/* Type Filter */}
                <MultiSelectFilter
                  options={TYPE_OPTIONS}
                  selected={typeFilter}
                  onSelectionChange={(values) => {
                    setTypeFilter(values)
                    setCurrentPage(1)
                  }}
                  placeholder="Type"
                  className="w-[120px]"
                />

                {/* Issue Filter */}
                <MultiSelectFilter
                  options={ISSUE_OPTIONS}
                  selected={issueFilter}
                  onSelectionChange={(values) => {
                    setIssueFilter(values)
                    setCurrentPage(1)
                  }}
                  placeholder="Issue"
                  className="w-[120px]"
                />
              </div>
            </div>
          )}
        </div>

        {/* Care Tickets Table */}
        <div className="flex-1 overflow-auto -mx-4 lg:-mx-6">
          <div style={{ width: '100%' }}>
            <TooltipProvider>
              <table className="w-full text-sm" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    {columnVisibility.client && isAdmin && !selectedClientId && (
                      <col style={{ width: '68px' }} />
                    )}
                    {/* Partner column - same width as client badge */}
                    {isAdmin && !selectedClientId && (
                      <col style={{ width: '36px' }} />
                    )}
                    {columnVisibility.dateCreated && <col style={{ width: '60px' }} />}
                    {columnVisibility.lastUpdated && <col style={{ width: '60px' }} />}
                    {columnVisibility.reference && <col style={{ width: '110px' }} />}
                    {columnVisibility.type && <col style={{ width: '95px' }} />}
                    {columnVisibility.issue && <col style={{ width: '95px' }} />}
                    {columnVisibility.status && <col style={{ width: '138px' }} />}
                    {columnVisibility.latestNotes && <col style={{ width: 'auto' }} />}
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-[#fcfcfc] dark:bg-zinc-900">
                    <tr className="h-11">
                      {/* Client column - only visible for admins viewing all clients */}
                      {columnVisibility.client && isAdmin && !selectedClientId && (
                        <th className="text-left align-middle text-xs font-medium text-muted-foreground pl-4 lg:pl-6 pr-2"></th>
                      )}
                      {/* Partner column - only visible for admins viewing all clients */}
                      {isAdmin && !selectedClientId && (
                        <th className="text-left align-middle text-xs font-medium text-muted-foreground"></th>
                      )}
                      {columnVisibility.dateCreated && (
                        <th className={`text-left align-middle text-xs font-medium text-muted-foreground ${!(columnVisibility.client && isAdmin && !selectedClientId) ? 'pl-4 lg:pl-6' : ''}`}>Created</th>
                      )}
                      {columnVisibility.lastUpdated && (
                        <th className="text-left align-middle text-xs font-medium text-muted-foreground">Age</th>
                      )}
                      {columnVisibility.reference && (
                        <th className="text-left align-middle text-xs font-medium text-muted-foreground">Reference #</th>
                      )}
                      {columnVisibility.type && (
                        <th className="text-left align-middle text-xs font-medium text-muted-foreground">Type</th>
                      )}
                      {columnVisibility.issue && (
                        <th className="text-left align-middle text-xs font-medium text-muted-foreground">Issue</th>
                      )}
                      {columnVisibility.status && (
                        <th className="text-left align-middle text-xs font-medium text-muted-foreground">Status</th>
                      )}
                      {columnVisibility.latestNotes && (
                        <th className="text-left align-middle text-xs font-medium text-muted-foreground hidden lg:table-cell pr-4 lg:pr-6">Description</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr>
                        <td
                          colSpan={actualColumnCount}
                          className="h-32 text-center align-middle"
                        >
                          <div className="flex items-center justify-center gap-2">
                            <Loader2Icon className="h-5 w-5 animate-spin text-muted-foreground" />
                            <span className="text-muted-foreground">Loading tickets...</span>
                          </div>
                        </td>
                      </tr>
                    ) : displayedTickets.length === 0 ? (
                      <tr>
                        <td
                          colSpan={actualColumnCount}
                          className="h-32 text-center align-middle text-muted-foreground"
                        >
                          No tickets found
                        </td>
                      </tr>
                    ) : (
                      displayedTickets.map((ticket) => (
                        <React.Fragment key={ticket.id}>
                          <tr
                            className={cn(
                              "h-12 cursor-pointer transition-all duration-200 border-b border-border",
                              expandedRowId === ticket.id
                                ? "bg-accent dark:bg-accent/70 border-b-0"
                                : "hover:bg-accent/20 dark:hover:bg-accent/10",
                              // Dim other rows when one is expanded
                              expandedRowId && expandedRowId !== ticket.id && "opacity-40"
                            )}
                            onClick={() => setExpandedRowId(expandedRowId === ticket.id ? null : ticket.id)}
                          >
                            {/* Client badge - only visible for admins viewing all clients */}
                            {columnVisibility.client && isAdmin && !selectedClientId && (
                              <td className="align-middle pl-4 lg:pl-6 pr-8">
                                <ClientBadge clientId={ticket.clientId} />
                              </td>
                            )}
                            {/* Partner badge - only visible for admins viewing all clients */}
                            {isAdmin && !selectedClientId && (
                              <td className="align-middle">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <img
                                      src={`/partner-logos/${ticket.partner || 'shipbob'}.png`}
                                      alt={ticket.partner === 'eshipper' ? 'eShipper' : 'ShipBob'}
                                      className="h-[15px] w-auto object-contain"
                                      style={{ filter: 'brightness(0) saturate(100%) invert(32%) sepia(98%) saturate(1234%) hue-rotate(200deg) brightness(93%) contrast(96%)' }}
                                    />
                                  </TooltipTrigger>
                                  <TooltipContent>
                                    <p>{ticket.partner === 'eshipper' ? 'eShipper' : 'ShipBob'}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </td>
                            )}
                            {columnVisibility.dateCreated && (
                              <td className={`align-middle text-sm text-muted-foreground whitespace-nowrap ${!(columnVisibility.client && isAdmin && !selectedClientId) ? 'pl-4 lg:pl-6' : ''}`}>
                                {formatDate(ticket.createdAt)}
                              </td>
                            )}
                            {columnVisibility.lastUpdated && (
                              <td className="align-middle text-sm text-muted-foreground whitespace-nowrap">
                                {formatAge(ticket.createdAt, ticket.resolvedAt)}
                              </td>
                            )}
                            {columnVisibility.reference && (
                              <td className="align-middle font-mono text-xs text-muted-foreground">
                                {ticket.shipmentId ? (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation()
                                      setSelectedShipmentId(ticket.shipmentId as string)
                                      setShipmentDrawerOpen(true)
                                    }}
                                    className="text-primary hover:underline cursor-pointer"
                                  >
                                    {ticket.shipmentId}
                                  </button>
                                ) : (
                                  getReferenceId(ticket) || '-'
                                )}
                              </td>
                            )}
                            {columnVisibility.type && (
                              <td className="align-middle">
                                <Badge variant="outline" className="whitespace-nowrap font-medium bg-slate-200/60 text-slate-700 border-slate-300/60 dark:bg-slate-700/40 dark:text-slate-200 dark:border-slate-600/50">
                                  {ticket.ticketType === 'Work Order' ? 'Request' : ticket.ticketType}
                                </Badge>
                              </td>
                            )}
                            {columnVisibility.issue && (
                              <td className="align-middle">
                                <Badge variant="outline" className="whitespace-nowrap font-medium bg-slate-200/60 text-slate-700 border-slate-300/60 dark:bg-slate-700/40 dark:text-slate-200 dark:border-slate-600/50">
                                  {ticket.issueType || 'N/A'}
                                </Badge>
                              </td>
                            )}
                            {columnVisibility.status && (
                              <td className="align-middle">
                                <Badge
                                  variant="outline"
                                  className={cn("whitespace-nowrap", getStatusColors(ticket.status))}
                                >
                                  {ticket.status}
                                </Badge>
                              </td>
                            )}
                            {columnVisibility.latestNotes && (
                              <td className="align-middle hidden lg:table-cell pr-4 lg:pr-6">
                                {/* Hide truncated text when expanded - the expanded panel shows full text */}
                                {expandedRowId !== ticket.id && (
                                  <p className="text-sm text-muted-foreground truncate">
                                    {ticket.description || '-'}
                                  </p>
                                )}
                              </td>
                            )}
                          </tr>
                          <AnimatePresence>
                          {expandedRowId === ticket.id && (
                            <tr
                              key={`expanded-${ticket.id}`}
                            >
                              {/* Full-width expanded panel */}
                              <td
                                colSpan={actualColumnCount}
                                className="p-0 border-t-0 bg-accent dark:bg-accent/70"
                              >
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2, ease: "easeOut" }}
                                >
                                  <div className="pt-3 pb-5">
                                    <div className="flex items-start pl-4 lg:pl-6 pr-4">
                                      {/* Left Column: Credit/Buttons only */}
                                      <div className={cn(
                                        "flex-shrink-0 pr-[18px]",
                                        isAdmin && !selectedClientId ? "w-[142px]" : "w-[82px]"
                                      )}>
                                          {/* Credit Card - contextual based on state */}
                                          {(ticket.compensationRequest || ticket.creditAmount > 0 || ticket.status === 'Credit Requested' || ticket.status === 'Credit Approved') && (
                                            <div className={cn(
                                              "rounded-xl px-3 py-2 border",
                                              ticket.status === 'Resolved' || ticket.status === 'Credit Approved'
                                                ? "bg-gradient-to-br from-emerald-50 to-emerald-100/50 dark:from-emerald-900/30 dark:to-emerald-950/20 border-emerald-200/50 dark:border-emerald-800/50"
                                                : ticket.status === 'Credit Requested'
                                                  ? "bg-gradient-to-br from-amber-50 to-amber-100/50 dark:from-amber-900/30 dark:to-amber-950/20 border-amber-200/50 dark:border-amber-800/50"
                                                  : "bg-gradient-to-br from-slate-50 to-slate-100/50 dark:from-slate-800/50 dark:to-slate-900/30 border-slate-200/50 dark:border-slate-700/50"
                                            )}>
                                              <div className={cn(
                                                "text-[9px] font-medium uppercase tracking-wider mb-0.5 whitespace-nowrap",
                                                ticket.status === 'Resolved' || ticket.status === 'Credit Approved'
                                                  ? "text-emerald-600 dark:text-emerald-400"
                                                  : ticket.status === 'Credit Requested'
                                                    ? "text-black dark:text-amber-300"
                                                    : "text-slate-500 dark:text-slate-400"
                                              )}>
                                                {ticket.status === 'Credit Approved' ? 'Credit Approved' : ticket.status === 'Credit Requested' ? 'Credit Requested' : 'Credit'}
                                              </div>
                                              <div className={cn(
                                                "text-lg font-bold",
                                                ticket.status === 'Resolved' || ticket.status === 'Credit Approved'
                                                  ? "text-emerald-700 dark:text-emerald-300"
                                                  : ticket.status === 'Credit Requested'
                                                    ? "text-black dark:text-amber-200"
                                                    : "text-slate-900 dark:text-slate-100"
                                              )}>
                                                {ticket.creditAmount > 0 ? formatCurrency(ticket.creditAmount) : 'TBD'}
                                              </div>
                                              {(ticket.status === 'Credit Requested' || ticket.status === 'Credit Approved') && (
                                                <div className="text-[10px] text-muted-foreground mt-1 leading-tight">
                                                  {(() => {
                                                    // Find the event when the status was set
                                                    const statusEvent = ticket.events?.find(e => e.status === ticket.status)
                                                    if (statusEvent) {
                                                      const date = new Date(statusEvent.createdAt)
                                                      const month = date.getMonth() + 1
                                                      const day = date.getDate()
                                                      return ticket.status === 'Credit Approved'
                                                        ? `Approved on ${month}/${day}`
                                                        : `Requested on ${month}/${day}`
                                                    }
                                                    return null
                                                  })()}
                                                </div>
                                              )}
                                            </div>
                                          )}

                                          {/* Action Buttons */}
                                          {!usingStaticData && (
                                            <div className="flex flex-col gap-[5px] w-full mt-2.5">
                                              <button
                                                className="w-full px-3 py-1.5 text-[11px] font-medium rounded-md border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 dark:hover:bg-emerald-900/50 transition-colors"
                                                onClick={(e) => openStatusDialog(ticket, e)}
                                              >
                                                Update Status
                                              </button>
                                              <button
                                                className="w-full px-3 py-1.5 text-[11px] font-medium rounded-md border border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 transition-colors"
                                                onClick={(e) => openEditDialog(ticket, e)}
                                              >
                                                Edit Ticket
                                              </button>
                                              <button
                                                className="w-full px-3 py-1.5 text-[11px] font-medium rounded-md border border-red-200 bg-red-50 text-red-700 hover:bg-red-100 dark:border-red-800 dark:bg-red-900/30 dark:text-red-300 dark:hover:bg-red-900/50 transition-colors"
                                                onClick={(e) => openDeleteDialog(ticket, e)}
                                              >
                                                Delete Ticket
                                              </button>
                                            </div>
                                          )}

                                          {/* Files Card - below buttons */}
                                          {ticket.attachments && ticket.attachments.length > 0 && (
                                            <div className="mt-3 bg-gradient-to-b from-white/80 to-white/50 dark:from-slate-600/40 dark:to-slate-700/20 rounded-xl border border-slate-200/30 dark:border-slate-600/30 p-3">
                                              <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Files</div>
                                              <div className="flex flex-col gap-1.5">
                                                {ticket.attachments.map((file, idx) => (
                                                  <a
                                                    key={idx}
                                                    href={file.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-medium bg-white dark:bg-slate-600/50 rounded border border-slate-200/60 dark:border-slate-500/40 hover:bg-slate-100 dark:hover:bg-slate-600 transition-colors"
                                                  >
                                                    {getFileIcon(file.type)}
                                                    <span className="truncate">{file.name}</span>
                                                  </a>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                        </div>

                                      {/* Center column: Details Card + Internal Notes (stacked) */}
                                      <div className="flex flex-col w-[477px] flex-shrink-0">
                                        {/* Details Card - no min-height, flows naturally */}
                                        <div className="bg-gradient-to-b from-white/80 to-white/50 dark:from-slate-600/40 dark:to-slate-700/20 rounded-xl border border-slate-200/30 dark:border-slate-600/30 p-4">
                                          {/* Row 1: Ticket #, Carrier, Tracking # */}
                                          <div className="grid grid-cols-3 gap-x-6 mb-3">
                                            <div>
                                              <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">Ticket #</div>
                                              <div className="text-xs font-mono truncate">{ticket.ticketNumber}</div>
                                            </div>
                                            <div>
                                              <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">Carrier</div>
                                              <div className="text-xs font-medium truncate">{ticket.carrier || '-'}</div>
                                            </div>
                                            <div>
                                              <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">Tracking #</div>
                                              {ticket.trackingNumber ? (
                                                (() => {
                                                  const trackingUrl = getTrackingUrl(ticket.carrier || '', ticket.trackingNumber)
                                                  return trackingUrl ? (
                                                    <a
                                                      href={trackingUrl}
                                                      target="_blank"
                                                      rel="noopener noreferrer"
                                                      className="text-xs font-mono truncate block text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                                                    >
                                                      {ticket.trackingNumber}
                                                    </a>
                                                  ) : (
                                                    <div className="text-xs font-mono truncate">{ticket.trackingNumber}</div>
                                                  )
                                                })()
                                              ) : (
                                                <div className="text-xs font-mono truncate">-</div>
                                              )}
                                            </div>
                                          </div>

                                          {/* Claim-specific rows - varies by issue type */}
                                          {ticket.ticketType === 'Claim' && ticket.issueType !== 'Loss' && ticket.issueType !== 'Damage' ? (
                                            <>
                                              <hr className="border-slate-200/50 dark:border-slate-600/50 my-3" />
                                              <div className="grid grid-cols-3 gap-x-6">
                                                <div>
                                                  <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">Reshipment</div>
                                                  <div className="text-xs font-medium truncate">
                                                    {ticket.reshipmentStatus === "Please reship for me" ? "Reship for me" :
                                                     ticket.reshipmentStatus || "-"}
                                                  </div>
                                                </div>
                                                <div>
                                                  <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">Reshipment ID</div>
                                                  <div className="text-xs font-mono truncate">{ticket.reshipmentId || '-'}</div>
                                                </div>
                                                <div>
                                                  <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">What to Reship</div>
                                                  <div className="text-xs truncate">{ticket.whatToReship || '-'}</div>
                                                </div>
                                              </div>
                                              <hr className="border-slate-200/50 dark:border-slate-600/50 my-3" />
                                              <div>
                                                <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">Compensation</div>
                                                <div className="text-xs truncate">{ticket.compensationRequest || '-'}</div>
                                              </div>
                                            </>
                                          ) : (
                                            null
                                          )}
                                        </div>

                                        {/* Internal Notes - directly under details card */}
                                        {isAdmin && (
                                          <div className="mt-3">
                                            <div className="bg-gradient-to-b from-white/80 to-white/50 dark:from-slate-600/40 dark:to-slate-700/20 rounded-xl p-3 border border-slate-200/30 dark:border-slate-600/30">
                                              <div className="flex items-center justify-between mb-2">
                                                <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Internal Notes</div>
                                                <Popover open={addNoteOpenForTicket === ticket.id} onOpenChange={(open) => {
                                                  setAddNoteOpenForTicket(open ? ticket.id : null)
                                                  if (!open) setNewNoteText('')
                                                }}>
                                                  <PopoverTrigger asChild>
                                                    <button className="flex items-center justify-center w-5 h-5 text-slate-500 dark:text-slate-400 bg-slate-100/50 dark:bg-slate-700/30 hover:bg-slate-200/60 dark:hover:bg-slate-600/40 rounded-md transition-colors border border-slate-300/40 dark:border-slate-500/40">
                                                      <PlusIcon className="h-3 w-3" />
                                                    </button>
                                                  </PopoverTrigger>
                                                  <PopoverContent className="w-72 p-3" align="end">
                                                    <div className="space-y-2">
                                                      <div className="text-xs font-medium text-muted-foreground">Add Internal Note</div>
                                                      <Textarea
                                                        placeholder="Type your note..."
                                                        value={newNoteText}
                                                        onChange={(e) => setNewNoteText(e.target.value)}
                                                        className="min-h-[80px] text-sm resize-none"
                                                        autoFocus
                                                      />
                                                      <div className="flex justify-end gap-2">
                                                        <Button
                                                          variant="ghost"
                                                          size="sm"
                                                          className="h-7 text-xs"
                                                          onClick={() => {
                                                            setAddNoteOpenForTicket(null)
                                                            setNewNoteText('')
                                                          }}
                                                        >
                                                          Cancel
                                                        </Button>
                                                        <Button
                                                          size="sm"
                                                          className="h-7 text-xs bg-amber-600 hover:bg-amber-700"
                                                          onClick={() => handleAddInternalNote(ticket.id)}
                                                          disabled={!newNoteText.trim() || isAddingNote}
                                                        >
                                                          {isAddingNote ? (
                                                            <Loader2Icon className="h-3 w-3 animate-spin" />
                                                          ) : (
                                                            'Save'
                                                          )}
                                                        </Button>
                                                      </div>
                                                    </div>
                                                  </PopoverContent>
                                                </Popover>
                                              </div>
                                              {ticket.internalNotes && ticket.internalNotes.length > 0 && (
                                                <div className="divide-y divide-amber-300/40 dark:divide-amber-700/40">
                                                  {ticket.internalNotes.map((note, idx) => (
                                                    <div key={idx} className="py-2 first:pt-0 last:pb-0">
                                                      <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{note.note}</p>
                                                      <div className="flex items-center gap-2 mt-1 text-[10px] text-amber-600/80 dark:text-amber-400/70">
                                                        <span className="font-semibold">{note.createdBy}</span>
                                                        <span>•</span>
                                                        <span>{new Date(note.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                                                      </div>
                                                    </div>
                                                  ))}
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        )}
                                      </div>

                                      {/* Right section: Description and Activity card */}
                                      <div className="flex-1 ml-3 flex flex-col">
                                        {/* Combined Description & Activity card */}
                                        <div className="bg-gradient-to-b from-white/80 to-white/50 dark:from-slate-600/40 dark:to-slate-700/20 rounded-xl p-4 border border-slate-200/30 dark:border-slate-600/30 flex-1">
                                              {/* Description section */}
                                              {ticket.description && (
                                                <div className="mb-6">
                                                  <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Description</div>
                                                  <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                                    {ticket.description}
                                                  </p>
                                                </div>
                                              )}

                                              {/* Activity section */}
                                              {ticket.events && ticket.events.length > 0 && (
                                                <>
                                                  <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Activity</div>
                                                  <div className="relative">
                                                    {/* Vertical line */}
                                                    <div className="absolute left-[5px] top-2 bottom-2 w-px bg-gradient-to-b from-primary/40 via-slate-300 to-slate-200 dark:via-slate-600 dark:to-slate-700" />

                                                    <div className="space-y-4">
                                                      {ticket.events.map((event, idx) => (
                                                        <div key={idx} className="relative flex gap-4 pl-6">
                                                          {/* Timeline dot */}
                                                          <div className={cn(
                                                            "absolute left-0 top-0.5 w-[11px] h-[11px] rounded-full border-2",
                                                            idx === 0
                                                              ? getStatusDotColor(event.status)
                                                              : "bg-background border-slate-300 dark:border-slate-600"
                                                          )} />

                                                          <div className="flex-1 min-w-0 pb-1">
                                                            <div className="flex items-baseline justify-between gap-2 mb-1">
                                                              <span className={cn(
                                                                "text-sm font-semibold",
                                                                getStatusTextColor(event.status)
                                                              )}>
                                                                {event.status}
                                                              </span>
                                                              <span className="text-[10px] text-muted-foreground/60 tabular-nums">
                                                                {formatDateTime(event.createdAt, event.createdBy)}
                                                              </span>
                                                            </div>
                                                            {event.note && (
                                                              <p className={cn(
                                                                "text-xs leading-relaxed",
                                                                idx === 0 ? "text-muted-foreground" : "text-muted-foreground/60"
                                                              )}>
                                                                {event.note}
                                                              </p>
                                                            )}
                                                          </div>
                                                        </div>
                                                      ))}
                                                    </div>
                                                  </div>
                                                </>
                                              )}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </motion.div>
                              </td>
                            </tr>
                          )}
                          </AnimatePresence>
                        </React.Fragment>
                      ))
                    )}
                  </tbody>
                </table>
              </TooltipProvider>
          </div>
        </div>

        {/* Pagination Controls - Fixed at bottom */}
        <div className="flex items-center justify-between py-4">
          <div className="hidden flex-1 text-sm text-muted-foreground lg:flex">
            {totalCount} total ticket(s)
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
              Page {currentPage} of {totalPages || 1}
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
                disabled={currentPage >= totalPages}
              >
                <span className="sr-only">Go to next page</span>
                <ChevronRightIcon />
              </Button>
              <Button
                variant="outline"
                className="hidden size-8 lg:flex"
                size="icon"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage >= totalPages}
              >
                <span className="sr-only">Go to last page</span>
                <ChevronsRightIcon />
              </Button>
            </div>
          </div>
        </div>
      </div>

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

      {/* Create Ticket Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Create New Ticket</DialogTitle>
            <DialogDescription>
              Create a new care ticket for the selected client.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ticketType">Ticket Type *</Label>
                <Select
                  value={createForm.ticketType}
                  onValueChange={(value) => setCreateForm({ ...createForm, ticketType: value })}
                >
                  <SelectTrigger id="ticketType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Claim">Claim</SelectItem>
                    <SelectItem value="Work Order">Work Order</SelectItem>
                    <SelectItem value="Technical">Technical</SelectItem>
                    <SelectItem value="Inquiry">Inquiry</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="issueType">Issue Type</Label>
                <Select
                  value={createForm.issueType}
                  onValueChange={(value) => setCreateForm({ ...createForm, issueType: value })}
                >
                  <SelectTrigger id="issueType">
                    <SelectValue placeholder="Select issue type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Loss">Loss</SelectItem>
                    <SelectItem value="Damage">Damage</SelectItem>
                    <SelectItem value="Pick Error">Pick Error</SelectItem>
                    <SelectItem value="Short Ship">Short Ship</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="orderId">Order ID</Label>
                <Input
                  id="orderId"
                  value={createForm.orderId}
                  onChange={(e) => setCreateForm({ ...createForm, orderId: e.target.value })}
                  placeholder="e.g., 1847362"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="carrier">Carrier</Label>
                <Input
                  id="carrier"
                  value={createForm.carrier}
                  onChange={(e) => setCreateForm({ ...createForm, carrier: e.target.value })}
                  placeholder="e.g., FedEx, UPS"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="trackingNumber">Tracking Number</Label>
              <Input
                id="trackingNumber"
                value={createForm.trackingNumber}
                onChange={(e) => setCreateForm({ ...createForm, trackingNumber: e.target.value })}
                placeholder="e.g., 773892456821"
              />
            </div>

            {createForm.ticketType === 'Claim' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="reshipmentStatus">Reshipment Status</Label>
                    <Select
                      value={createForm.reshipmentStatus}
                      onValueChange={(value) => setCreateForm({ ...createForm, reshipmentStatus: value })}
                    >
                      <SelectTrigger id="reshipmentStatus">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Please reship for me">Please reship for me</SelectItem>
                        <SelectItem value="I've already reshipped">I&apos;ve already reshipped</SelectItem>
                        <SelectItem value="Don't reship">Don&apos;t reship</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="compensationRequest">Compensation Request</Label>
                    <Select
                      value={createForm.compensationRequest}
                      onValueChange={(value) => setCreateForm({ ...createForm, compensationRequest: value })}
                    >
                      <SelectTrigger id="compensationRequest">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Credit to account">Credit to account</SelectItem>
                        <SelectItem value="Free replacement">Free replacement</SelectItem>
                        <SelectItem value="Refund to payment method">Refund to payment method</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="whatToReship">What to Reship</Label>
                  <Input
                    id="whatToReship"
                    value={createForm.whatToReship}
                    onChange={(e) => setCreateForm({ ...createForm, whatToReship: e.target.value })}
                    placeholder="e.g., 2x Vitamin D3 5000IU"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="creditAmount">Credit Amount</Label>
                    <Input
                      id="creditAmount"
                      type="number"
                      step="0.01"
                      value={createForm.creditAmount}
                      onChange={(e) => setCreateForm({ ...createForm, creditAmount: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="currency">Currency</Label>
                    <Select
                      value={createForm.currency}
                      onValueChange={(value) => setCreateForm({ ...createForm, currency: value })}
                    >
                      <SelectTrigger id="currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="CAD">CAD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            <div className="space-y-2">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                placeholder="Describe the issue..."
                rows={4}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateTicket} disabled={isCreating}>
              {isCreating ? (
                <>
                  <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                'Create Ticket'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Ticket Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Ticket #{editingTicket?.ticketNumber}</DialogTitle>
            <DialogDescription>
              Update the ticket details below.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            {/* Status and Type Row */}
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-status">Status *</Label>
                <Select
                  value={editForm.status}
                  onValueChange={(value) => setEditForm({ ...editForm, status: value })}
                >
                  <SelectTrigger id="edit-status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Input Required">Input Required</SelectItem>
                    <SelectItem value="Under Review">Under Review</SelectItem>
                    <SelectItem value="Credit Requested">Credit Requested</SelectItem>
                    <SelectItem value="Credit Approved">Credit Approved</SelectItem>
                    <SelectItem value="Resolved">Resolved</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-ticketType">Ticket Type *</Label>
                <Select
                  value={editForm.ticketType}
                  onValueChange={(value) => setEditForm({ ...editForm, ticketType: value })}
                >
                  <SelectTrigger id="edit-ticketType">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Claim">Claim</SelectItem>
                    <SelectItem value="Work Order">Work Order</SelectItem>
                    <SelectItem value="Technical">Technical</SelectItem>
                    <SelectItem value="Inquiry">Inquiry</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-issueType">Issue Type</Label>
                <Select
                  value={editForm.issueType}
                  onValueChange={(value) => setEditForm({ ...editForm, issueType: value })}
                >
                  <SelectTrigger id="edit-issueType">
                    <SelectValue placeholder="Select issue type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Loss">Loss</SelectItem>
                    <SelectItem value="Damage">Damage</SelectItem>
                    <SelectItem value="Pick Error">Pick Error</SelectItem>
                    <SelectItem value="Short Ship">Short Ship</SelectItem>
                    <SelectItem value="Other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Manager */}
            <div className="space-y-2">
              <Label htmlFor="edit-manager">Assigned Manager</Label>
              <Input
                id="edit-manager"
                value={editForm.manager}
                onChange={(e) => setEditForm({ ...editForm, manager: e.target.value })}
                placeholder="Manager name"
              />
            </div>

            {/* Order/Shipment Details */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-orderId">Order ID</Label>
                <Input
                  id="edit-orderId"
                  value={editForm.orderId}
                  onChange={(e) => setEditForm({ ...editForm, orderId: e.target.value })}
                  placeholder="e.g., 1847362"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-shipmentId">Shipment ID</Label>
                <Input
                  id="edit-shipmentId"
                  value={editForm.shipmentId}
                  onChange={(e) => setEditForm({ ...editForm, shipmentId: e.target.value })}
                  placeholder="e.g., 330867617"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit-shipDate">Ship Date</Label>
                <Input
                  id="edit-shipDate"
                  type="date"
                  value={editForm.shipDate}
                  onChange={(e) => setEditForm({ ...editForm, shipDate: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-carrier">Carrier</Label>
                <Input
                  id="edit-carrier"
                  value={editForm.carrier}
                  onChange={(e) => setEditForm({ ...editForm, carrier: e.target.value })}
                  placeholder="e.g., FedEx"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-trackingNumber">Tracking Number</Label>
                <Input
                  id="edit-trackingNumber"
                  value={editForm.trackingNumber}
                  onChange={(e) => setEditForm({ ...editForm, trackingNumber: e.target.value })}
                  placeholder="e.g., 773892456821"
                />
              </div>
            </div>

            {/* Claim-specific fields */}
            {editForm.ticketType === 'Claim' && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-reshipmentStatus">Reshipment Status</Label>
                    <Select
                      value={editForm.reshipmentStatus}
                      onValueChange={(value) => setEditForm({ ...editForm, reshipmentStatus: value })}
                    >
                      <SelectTrigger id="edit-reshipmentStatus">
                        <SelectValue placeholder="Select status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Please reship for me">Please reship for me</SelectItem>
                        <SelectItem value="I've already reshipped">I&apos;ve already reshipped</SelectItem>
                        <SelectItem value="Don't reship">Don&apos;t reship</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-compensationRequest">Compensation Request</Label>
                    <Select
                      value={editForm.compensationRequest}
                      onValueChange={(value) => setEditForm({ ...editForm, compensationRequest: value })}
                    >
                      <SelectTrigger id="edit-compensationRequest">
                        <SelectValue placeholder="Select type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="Credit to account">Credit to account</SelectItem>
                        <SelectItem value="Free replacement">Free replacement</SelectItem>
                        <SelectItem value="Refund to payment method">Refund to payment method</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-whatToReship">What to Reship</Label>
                    <Input
                      id="edit-whatToReship"
                      value={editForm.whatToReship}
                      onChange={(e) => setEditForm({ ...editForm, whatToReship: e.target.value })}
                      placeholder="e.g., 2x Vitamin D3 5000IU"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-reshipmentId">Reshipment ID</Label>
                    <Input
                      id="edit-reshipmentId"
                      value={editForm.reshipmentId}
                      onChange={(e) => setEditForm({ ...editForm, reshipmentId: e.target.value })}
                      placeholder="e.g., 12345"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-creditAmount">Credit Amount</Label>
                    <Input
                      id="edit-creditAmount"
                      type="number"
                      step="0.01"
                      value={editForm.creditAmount}
                      onChange={(e) => setEditForm({ ...editForm, creditAmount: e.target.value })}
                      placeholder="0.00"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-currency">Currency</Label>
                    <Select
                      value={editForm.currency}
                      onValueChange={(value) => setEditForm({ ...editForm, currency: value })}
                    >
                      <SelectTrigger id="edit-currency">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="USD">USD</SelectItem>
                        <SelectItem value="CAD">CAD</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </>
            )}

            {/* Work Order specific fields */}
            {(editForm.ticketType === 'Work Order' || editForm.ticketType === 'Technical' || editForm.ticketType === 'Inquiry') && (
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-workOrderId">Work Order ID</Label>
                  <Input
                    id="edit-workOrderId"
                    value={editForm.workOrderId}
                    onChange={(e) => setEditForm({ ...editForm, workOrderId: e.target.value })}
                    placeholder="e.g., WO-12345"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-inventoryId">Inventory ID</Label>
                  <Input
                    id="edit-inventoryId"
                    value={editForm.inventoryId}
                    onChange={(e) => setEditForm({ ...editForm, inventoryId: e.target.value })}
                    placeholder="e.g., INV-67890"
                  />
                </div>
              </div>
            )}

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="edit-description">Description</Label>
              <Textarea
                id="edit-description"
                value={editForm.description}
                onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                placeholder="Describe the issue..."
                rows={3}
              />
            </div>

            {/* Add Internal Note */}
            <div className="space-y-2">
              <Label htmlFor="edit-internalNote">Add Internal Note (Admin/Care only)</Label>
              <Textarea
                id="edit-internalNote"
                value={editForm.internalNote}
                onChange={(e) => setEditForm({ ...editForm, internalNote: e.target.value })}
                placeholder="Add a new internal note..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleUpdateTicket} disabled={isUpdating}>
              {isUpdating ? (
                <>
                  <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : (
                'Save Changes'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Ticket</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this ticket? This action will hide the ticket from the main view but it can be recovered later.
            </DialogDescription>
          </DialogHeader>
          {deletingTicket && (
            <div className="py-4">
              <div className="rounded-lg border border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-red-900 dark:text-red-100">
                    Ticket #{deletingTicket.ticketNumber}
                  </span>
                  <Badge variant="outline" className="text-red-700 border-red-300 dark:text-red-300 dark:border-red-700">
                    {deletingTicket.ticketType}
                  </Badge>
                </div>
                {deletingTicket.description && (
                  <p className="text-sm text-red-700 dark:text-red-300 line-clamp-2">
                    {deletingTicket.description}
                  </p>
                )}
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteTicket}
              disabled={isDeleting}
            >
              {isDeleting ? (
                <>
                  <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete Ticket'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Status Update Dialog */}
      <Dialog open={statusDialogOpen} onOpenChange={setStatusDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Update Status</DialogTitle>
            <DialogDescription>
              Change the status of ticket #{statusTicket?.ticketNumber}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="status-select">New Status</Label>
              <Select value={newStatus} onValueChange={setNewStatus}>
                <SelectTrigger id="status-select">
                  <SelectValue placeholder="Select status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Input Required">Input Required</SelectItem>
                  <SelectItem value="Under Review">Under Review</SelectItem>
                  <SelectItem value="Credit Requested">Credit Requested</SelectItem>
                  <SelectItem value="Credit Approved">Credit Approved</SelectItem>
                  <SelectItem value="Resolved">Resolved</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="status-note">Note (optional)</Label>
              <Textarea
                id="status-note"
                value={statusNote}
                onChange={(e) => setStatusNote(e.target.value)}
                placeholder="Add a note about this status change..."
                rows={3}
              />
            </div>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setStatusDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleStatusUpdate}
              disabled={isUpdatingStatus || newStatus === statusTicket?.status}
            >
              {isUpdatingStatus ? (
                <>
                  <Loader2Icon className="h-4 w-4 mr-2 animate-spin" />
                  Updating...
                </>
              ) : (
                'Update Status'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Shipment Details Drawer */}
      <ShipmentDetailsDrawer
        shipmentId={selectedShipmentId}
        open={shipmentDrawerOpen}
        onOpenChange={setShipmentDrawerOpen}
      />
    </>
  )
}
