"use client"

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  ColumnsIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  PlusIcon,
  PencilIcon,
  SearchIcon,
  XIcon,
  DownloadIcon,
  FileTextIcon,
  ImageIcon,
  FileIcon,
  FileSpreadsheetIcon,
} from "lucide-react"
import { DateRange } from "react-day-picker"
import { useDebouncedCallback } from "use-debounce"

import { SiteHeader } from "@/components/site-header"
import { JetpackLoader } from "@/components/jetpack-loader"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { toast } from "sonner"
import { CARE_TABLE_CONFIG, getRedistributedWidths } from "@/lib/table-config"
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
import { InlineDateRangePicker } from "@/components/ui/inline-date-range-picker"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { MultiSelectFilter, FilterOption } from "@/components/ui/multi-select-filter"
import { cn } from "@/lib/utils"
import { useClient } from "@/components/client-context"
import { ClientBadge, JETPACK_INTERNAL_ID } from "@/components/transactions/client-badge"
import { getTrackingUrl, getCarrierDisplayName } from "@/components/transactions/cell-renderers"
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

// Carrier options for the dropdown (consolidated display names)
const CARRIER_OPTIONS = [
  'Amazon',
  'APC',
  'BetterTrucks',
  'Canada Post',
  'Cirro',
  'DHL Ecom',
  'DHL Express',
  'FedEx',
  'GoFo Express',
  'LaserShip',
  'OnTrac',
  'OSM',
  'Passport',
  'Prepaid',
  'ShipBob',
  'TForce',
  'UniUni',
  'UPS',
  'UPS MI',
  'USPS',
  'Veho',
]
import { ShipmentDetailsDrawer } from "@/components/shipment-details-drawer"
import { ClaimSubmissionDialog } from "@/components/claims/claim-submission-dialog"
import { FileUpload } from "@/components/claims/file-upload"

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
  { value: 'custom', label: 'Custom' },
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


// Ticket type filter options — non-claim types first, then claim issues
const ISSUE_TYPE_OPTIONS: FilterOption[] = [
  { value: 'type:Track', label: 'Track' },
  { value: 'type:Work Order', label: 'Request' },
  { value: 'type:Technical', label: 'Technical' },
  { value: 'type:Inquiry', label: 'Inquiry' },
  { value: 'issue:Loss', label: 'Lost in Transit' },
  { value: 'issue:Damage', label: 'Damage' },
  { value: 'issue:Pick Error', label: 'Incorrect Items' },
  { value: 'issue:Short Ship', label: 'Incorrect Quantity' },
  { value: 'issue:Other', label: 'Other' },
]

// All possible statuses - defined at module level to avoid recreating on each render
const ALL_STATUSES = ["Input Required", "Under Review", "Credit Requested", "Credit Approved", "Resolved"]

// Default statuses to show when no filter is active (excludes Resolved)
const DEFAULT_STATUSES = ALL_STATUSES.filter(s => s !== "Resolved")

// Helper function to get status badge colors
function getStatusColors(status: string) {
  switch (status) {
    case "Resolved":
      return "bg-emerald-100/50 text-emerald-700 border-emerald-200/50 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800/50"
    case "Credit Approved":
      return "bg-emerald-100/50 text-emerald-700 border-emerald-200/50 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-800/50"
    case "Credit Requested":
      return "bg-orange-100/50 text-orange-700 border-orange-200/50 dark:bg-orange-900/20 dark:text-orange-300 dark:border-orange-800/50"
    case "Under Review":
      return "bg-blue-100/50 text-blue-700 border-blue-200/50 dark:bg-blue-900/20 dark:text-blue-300 dark:border-blue-800/50"
    case "Input Required":
      return "bg-red-100/50 text-red-700 border-red-200/50 dark:bg-red-900/20 dark:text-red-300 dark:border-red-800/50"
    default:
      return "bg-slate-100/50 text-slate-700 border-slate-200/50 dark:bg-slate-900/20 dark:text-slate-300 dark:border-slate-800/50"
  }
}

// Helper function to get ticket type badge colors
// Claims (warm red family) vs non-claims (cool colors) for instant scanning
function getTicketTypeColors(ticketType: string, issueType?: string) {
  // For claims, color by the claim family (all same warm red)
  if (ticketType === 'Claim') {
    return "bg-red-100/40 text-red-600 border-red-200/40 dark:bg-red-900/15 dark:text-red-400 dark:border-red-800/40"
  }
  // Non-claim types get cool colors
  switch (ticketType) {
    case "Track":
      return "bg-violet-100/50 text-violet-700 border-violet-200/50 dark:bg-violet-900/20 dark:text-violet-300 dark:border-violet-800/50"
    case "Work Order":
      return "bg-teal-100/50 text-teal-700 border-teal-200/50 dark:bg-teal-900/20 dark:text-teal-300 dark:border-teal-800/50"
    case "Technical":
      return "bg-slate-100/50 text-slate-700 border-slate-200/50 dark:bg-slate-900/20 dark:text-slate-300 dark:border-slate-800/50"
    case "Inquiry":
      return "bg-cyan-100/50 text-cyan-700 border-cyan-200/50 dark:bg-cyan-900/20 dark:text-cyan-300 dark:border-cyan-800/50"
    default:
      return "bg-slate-100/50 text-slate-700 border-slate-200/50 dark:bg-slate-900/20 dark:text-slate-300 dark:border-slate-800/50"
  }
}

// Get display label for unified ticket type column
// Claims show their issue type, non-claims show their ticket type
function getTicketTypeLabel(ticketType: string, issueType?: string) {
  if (ticketType === 'Claim') {
    // Map database issue types to user-friendly labels
    switch (issueType) {
      case 'Loss':
        return 'Lost in Transit'
      case 'Short Ship':
        return 'Incorrect Quantity'
      case 'Pick Error':
        return 'Incorrect Items'
      default:
        return issueType || 'Claim'
    }
  }
  return ticketType === 'Work Order' ? 'Request' : ticketType
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
      return "bg-orange-400 border-orange-400 shadow-sm shadow-orange-400/30"
    case "Under Review":
      return "bg-blue-500 border-blue-500 shadow-sm shadow-blue-500/30"
    case "Input Required":
      return "bg-red-500 border-red-500 shadow-sm shadow-red-500/30"
    default:
      return "bg-slate-400 border-slate-400 shadow-sm shadow-slate-400/30"
  }
}

// Helper function to get file type icon based on MIME type or extension
function getFileIcon(fileType: string, fileName?: string) {
  const type = fileType.toLowerCase()

  // Check MIME types first
  if (type === 'application/pdf' || type === 'pdf') {
    return <FileTextIcon className="h-4 w-4 text-red-500 shrink-0" />
  } else if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(type)) {
    return <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />
  } else if (
    type === 'application/vnd.ms-excel' ||
    type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    type === 'text/csv' ||
    ['xls', 'xlsx', 'csv'].includes(type)
  ) {
    return <FileSpreadsheetIcon className="h-4 w-4 text-green-600 shrink-0" />
  } else if (
    type === 'application/msword' ||
    type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ['doc', 'docx'].includes(type)
  ) {
    return <FileTextIcon className="h-4 w-4 text-blue-600 shrink-0" />
  } else {
    // Fallback: try to detect from filename extension
    if (fileName) {
      const ext = fileName.split('.').pop()?.toLowerCase()
      if (ext === 'pdf') return <FileTextIcon className="h-4 w-4 text-red-500 shrink-0" />
      if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext || '')) return <ImageIcon className="h-4 w-4 text-blue-500 shrink-0" />
      if (['xls', 'xlsx', 'csv'].includes(ext || '')) return <FileSpreadsheetIcon className="h-4 w-4 text-green-600 shrink-0" />
      if (['doc', 'docx'].includes(ext || '')) return <FileTextIcon className="h-4 w-4 text-blue-600 shrink-0" />
    }
    return <FileIcon className="h-4 w-4 text-slate-500 shrink-0" />
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

export default function CarePage() {
  const { selectedClientId, isAdmin, effectiveIsCareAdmin, clients } = useClient()
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [claimDialogOpen, setClaimDialogOpen] = React.useState(false)

  // Data state
  const [tickets, setTickets] = React.useState<Ticket[]>([])
  const [totalCount, setTotalCount] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [createDialogError, setCreateDialogError] = React.useState<string | null>(null)
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

  // Filter state - multi-select arrays
  const [statusFilter, setStatusFilter] = React.useState<string[]>([])
  const [typeFilter, setTypeFilter] = React.useState<string[]>([])
  const [issueFilter, setIssueFilter] = React.useState<string[]>([])
  // Combined issue/type selection (prefixed values like "type:Claim", "issue:Loss")
  const issueTypeSelection = React.useMemo(() => [
    ...typeFilter.map(v => `type:${v}`),
    ...issueFilter.map(v => `issue:${v}`),
  ], [typeFilter, issueFilter])

  // Memoize selected statuses to prevent infinite loops in useCallback dependencies
  const selectedStatuses = React.useMemo(() => {
    return statusFilter.length > 0 ? statusFilter : DEFAULT_STATUSES
  }, [statusFilter])

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1)
  const [itemsPerPage, setItemsPerPage] = React.useState(30)

  // Expanded row state
  const [expandedRowId, setExpandedRowId] = React.useState<string | null>(null)

  // Client attribution state (admin/care_admin only)
  const [confirmAttribution, setConfirmAttribution] = React.useState<{ticketId: string, clientId: string, clientName: string} | null>(null)
  const [isAttributing, setIsAttributing] = React.useState(false)

  // Handle attributing a ticket to a client
  async function handleAttributeClient(ticketId: string, clientId: string, clientName: string) {
    setIsAttributing(true)
    try {
      const res = await fetch(`/api/data/care-tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId }),
      })
      if (res.ok) {
        toast.success(`Ticket attributed to ${clientName}`)
        fetchTickets()
      } else {
        const data = await res.json()
        toast.error(data.error || 'Failed to attribute ticket')
      }
    } catch {
      toast.error('Failed to attribute ticket')
    }
    setIsAttributing(false)
    setConfirmAttribution(null)
  }

  // Column visibility state
  // Order: Client, Created, Reference, Credit, Type, Status, Updated, Description
  const DEFAULT_CARE_COLUMNS = React.useMemo(() => ({
    client: true,
    dateCreated: true,
    reference: true,
    credit: true,
    type: true,
    status: true,
    lastUpdated: true,
    latestNotes: true,
  }), [])
  const [columnVisibility, setColumnVisibility] = React.useState({
    client: true,
    dateCreated: true,
    reference: true,
    credit: true,
    type: true,
    status: true,
    lastUpdated: true,
    latestNotes: true,
  })

  // Column selector quota (excludes 'client' which is auto-managed by admin/brand context)
  const toggleableColumnKeys = ['dateCreated', 'reference', 'credit', 'type', 'status', 'lastUpdated', 'latestNotes'] as const
  const enabledColumnCount = toggleableColumnKeys.filter(k => columnVisibility[k]).length
  const totalColumnCount = toggleableColumnKeys.length
  const hasColumnCustomizations = toggleableColumnKeys.some(k => columnVisibility[k] !== DEFAULT_CARE_COLUMNS[k])

  // Load preferences from localStorage (column visibility, column order, page size)
  const carePrefs = useTablePreferences('care', 30)

  // Define which columns are draggable (exclude client/partner - they stay fixed)
  // Default order: Date, Reference ID, Type, Status, Age, Credit, Description
  const draggableColumnIds = ['dateCreated', 'reference', 'type', 'status', 'lastUpdated', 'credit', 'latestNotes']
  const draggableColumns = CARE_TABLE_CONFIG.columns.filter(c => draggableColumnIds.includes(c.id))

  // Apply user's drag order to draggable columns
  const orderedDraggableColumns = useColumnOrder(
    CARE_TABLE_CONFIG,
    draggableColumns,
    carePrefs.columnOrder
  )

  // DnD state
  const [activeColumnId, setActiveColumnId] = React.useState<string | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  )
  const activeColumn = activeColumnId
    ? CARE_TABLE_CONFIG.columns.find(c => c.id === activeColumnId)
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
        carePrefs.setColumnOrder(arrayMove(currentIds, oldIndex, newIndex))
      }
    }
  }, [orderedDraggableColumns, carePrefs])

  // Calculate column widths from config (using ordered draggable columns)
  const columnWidths = React.useMemo(() => {
    // Build list of visible column configs IN DISPLAY ORDER
    // Fixed columns first (client, partner), then ordered draggable columns
    const visibleConfigs = [
      ...(isAdmin && !selectedClientId && columnVisibility.client
        ? [CARE_TABLE_CONFIG.columns.find(c => c.id === 'client')!]
        : []),
      ...(isAdmin && !selectedClientId
        ? [CARE_TABLE_CONFIG.columns.find(c => c.id === 'partner')!]
        : []),
      ...orderedDraggableColumns.filter(col =>
        col.id in columnVisibility && columnVisibility[col.id as keyof typeof columnVisibility]
      ),
    ].filter(Boolean)

    const redistributed = getRedistributedWidths(visibleConfigs)
    const widths: Record<string, string> = {}
    for (const [id, w] of Object.entries(redistributed)) {
      widths[id] = `${w}%`
    }
    return widths
  }, [orderedDraggableColumns, columnVisibility, isAdmin, selectedClientId])

  // Sorting state - defaults to Date column, newest first
  const [sortColumn, setSortColumn] = React.useState<'date' | 'age' | 'credit'>('date')
  const [sortDirection, setSortDirection] = React.useState<'asc' | 'desc'>('desc')

  // Handle column sort click
  const handleSort = (column: 'date' | 'age' | 'credit') => {
    if (sortColumn === column) {
      // Toggle direction if same column
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      // New column, default to desc
      setSortColumn(column)
      setSortDirection('desc')
    }
  }

  // Get the most relevant reference ID for a ticket based on its type
  const getReferenceId = (ticket: Ticket): string | null => {
    // For Claims and Track tickets, prioritize shipment ID, then order ID
    if (ticket.ticketType === 'Claim' || ticket.ticketType === 'Track') {
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
    ticketType: 'Track',
    shipmentId: '',
    clientId: '', // For admin/care team to select brand
    carrier: '',
    trackingNumber: '',
    description: '',
    attachments: [] as { name: string; url: string; size: number; type: string }[],
  })
  const [isCreating, setIsCreating] = React.useState(false)

  // Shipment lookup state for auto-populate
  const [isLookingUpShipment, setIsLookingUpShipment] = React.useState(false)
  const [shipmentLookupError, setShipmentLookupError] = React.useState<string | null>(null)

  // Debounced shipment lookup to auto-populate carrier, tracking, and client
  const lookupShipment = useDebouncedCallback(async (shipmentId: string) => {
    if (!shipmentId || shipmentId.length < 5) {
      return
    }

    setIsLookingUpShipment(true)
    setShipmentLookupError(null)

    try {
      const response = await fetch(`/api/data/shipments/${shipmentId}`)
      if (response.ok) {
        const data = await response.json()
        if (data.shipment) {
          setCreateForm(prev => ({
            ...prev,
            carrier: data.shipment.carrier ? getCarrierDisplayName(data.shipment.carrier) : '',
            trackingNumber: data.shipment.tracking_id || '',
            // Auto-populate client if shipment has one
            clientId: data.shipment.client_id || prev.clientId,
          }))
        }
      } else if (response.status === 404) {
        // Shipment not found - that's okay, user might be typing a new one
        setShipmentLookupError(null)
      } else {
        setShipmentLookupError('Failed to lookup shipment')
      }
    } catch {
      setShipmentLookupError('Failed to lookup shipment')
    } finally {
      setIsLookingUpShipment(false)
    }
  }, 500)

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
  const [deleteType, setDeleteType] = React.useState<'archive' | 'permanent'>('archive')

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
  const [addReshipmentIdOpenForTicket, setAddReshipmentIdOpenForTicket] = React.useState<string | null>(null)
  const [newReshipmentId, setNewReshipmentId] = React.useState('')
  const [isSavingReshipmentId, setIsSavingReshipmentId] = React.useState(false)
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
    (columnVisibility.credit ? 1 : 0) +
    (columnVisibility.type ? 1 : 0) +
    (columnVisibility.status ? 1 : 0) +
    (columnVisibility.lastUpdated ? 1 : 0) +
    (columnVisibility.latestNotes ? 1 : 0)

  const handleIssueTypeChange = (values: string[]) => {
    setTypeFilter(values.filter(v => v.startsWith('type:')).map(v => v.slice(5)))
    setIssueFilter(values.filter(v => v.startsWith('issue:')).map(v => v.slice(6)))
    setCurrentPage(1)
  }

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
      setDateRange(undefined)
    } else if (preset === 'all') {
      setDateRange(undefined)
    } else {
      const range = getDateRangeFromPreset(preset)
      if (range) {
        setDateRange({ from: range.from, to: range.to })
      }
    }
    setCurrentPage(1)
  }

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
      setTickets(data.data || [])
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

  const formatDate = (dateString: string | null): React.ReactNode => {
    if (!dateString) return <span className="text-muted-foreground">-</span>
    const date = new Date(dateString)
    // Short format: Feb 7 (month name + day)
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  const formatTimeOnly = (dateString: string | null): React.ReactNode => {
    if (!dateString) return <span className="text-muted-foreground">-</span>
    const date = new Date(dateString)
    // Format: H:MM AM/PM
    let hours = date.getHours()
    const minutes = date.getMinutes().toString().padStart(2, '0')
    const ampm = hours >= 12 ? 'PM' : 'AM'
    hours = hours % 12
    hours = hours ? hours : 12 // 0 should be 12
    return `${hours}:${minutes} ${ampm}`
  }

  const formatDateTime = (dateString: string | null, createdBy?: string | null): React.ReactNode => {
    if (!dateString) return <span className="text-muted-foreground">-</span>
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

    if (days < 1) return 'Today'
    return `${Math.round(days)}d`
  }


  // Sort tickets by date (most recent first) - for static data
  const sortedTickets = React.useMemo(() => {
    const ticketsToSort = [...tickets]

    // Calculate age in ms for sorting
    const getAgeMs = (ticket: Ticket) => {
      const startDate = new Date(ticket.createdAt)
      const endDate = ticket.resolvedAt ? new Date(ticket.resolvedAt) : new Date()
      return endDate.getTime() - startDate.getTime()
    }

    if (sortColumn === 'date') {
      ticketsToSort.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime()
        const dateB = new Date(b.createdAt).getTime()
        return sortDirection === 'asc' ? dateA - dateB : dateB - dateA
      })
    } else if (sortColumn === 'age') {
      ticketsToSort.sort((a, b) => {
        const ageA = getAgeMs(a)
        const ageB = getAgeMs(b)
        return sortDirection === 'asc' ? ageA - ageB : ageB - ageA
      })
    } else if (sortColumn === 'credit') {
      ticketsToSort.sort((a, b) => {
        return sortDirection === 'asc' ? a.creditAmount - b.creditAmount : b.creditAmount - a.creditAmount
      })
    } else {
      // Default: newest first
      ticketsToSort.sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime()
        const dateB = new Date(b.createdAt).getTime()
        return dateB - dateA
      })
    }

    return ticketsToSort
  }, [tickets, sortColumn, sortDirection])

  // Pagination for static data (API handles its own pagination)
  const displayedTickets = React.useMemo(() => {
    if (!usingStaticData) return sortedTickets
    const startIndex = (currentPage - 1) * itemsPerPage
    return sortedTickets.slice(startIndex, startIndex + itemsPerPage)
  }, [sortedTickets, currentPage, itemsPerPage, usingStaticData])

  const totalPages = Math.ceil(totalCount / itemsPerPage)

  // Handle create ticket
  const handleCreateTicket = async () => {
    // Determine the effective client ID
    // For admins with no specific client selected, use the form's clientId
    // For brand users, use their selectedClientId
    const effectiveClientId = (selectedClientId && selectedClientId !== 'all')
      ? selectedClientId
      : createForm.clientId

    if (!effectiveClientId) {
      setCreateDialogError('Please select a brand.')
      return
    }

    // Validate required fields
    if (!createForm.description.trim()) {
      setCreateDialogError('Description is required.')
      return
    }

    // For Track type, shipment fields are required
    if (createForm.ticketType === 'Track') {
      if (!createForm.shipmentId.trim()) {
        setCreateDialogError('Shipment ID is required for Track tickets.')
        return
      }
      if (!createForm.carrier.trim()) {
        setCreateDialogError('Carrier is required for Track tickets.')
        return
      }
      if (!createForm.trackingNumber.trim()) {
        setCreateDialogError('Tracking Number is required for Track tickets.')
        return
      }
    }

    setCreateDialogError(null)
    setIsCreating(true)
    try {
      const response = await fetch('/api/data/care-tickets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          clientId: effectiveClientId,
          ticketType: createForm.ticketType,
          shipmentId: createForm.shipmentId || null,
          carrier: createForm.carrier || null,
          trackingNumber: createForm.trackingNumber || null,
          description: createForm.description || null,
          attachments: createForm.attachments.length > 0 ? createForm.attachments : null,
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to create ticket')
      }

      // Reset form and close dialog
      setCreateForm({
        ticketType: 'Track',
        shipmentId: '',
        clientId: '',
        carrier: '',
        trackingNumber: '',
        description: '',
        attachments: [],
      })
      setShipmentLookupError(null)
      setCreateDialogOpen(false)
      // Refresh tickets
      fetchTickets()
    } catch (err) {
      setCreateDialogError(err instanceof Error ? err.message : 'Failed to create ticket')
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

  // Handle delete ticket (archive or permanent)
  const handleDeleteTicket = async () => {
    if (!deletingTicket) return

    setIsDeleting(true)
    try {
      const url = deleteType === 'permanent'
        ? `/api/data/care-tickets/${deletingTicket.id}?permanent=true`
        : `/api/data/care-tickets/${deletingTicket.id}`

      const response = await fetch(url, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to delete ticket')
      }

      // Close dialog and refresh
      setDeleteDialogOpen(false)
      setDeletingTicket(null)
      setDeleteType('archive') // Reset to default
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

  // Handle add reshipment ID
  const handleAddReshipmentId = async (ticketId: string) => {
    if (!newReshipmentId.trim()) return

    setIsSavingReshipmentId(true)
    try {
      const response = await fetch(`/api/data/care-tickets/${ticketId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reshipmentId: newReshipmentId.trim(),
        }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to save reshipment ID')
      }

      // Close popover and refresh
      setAddReshipmentIdOpenForTicket(null)
      setNewReshipmentId('')
      fetchTickets()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save reshipment ID')
    } finally {
      setIsSavingReshipmentId(false)
    }
  }

  // Get short compensation alias for display
  const getShortCompensation = (compensation: string | null): string => {
    if (!compensation) return '-'
    if (compensation.toLowerCase().includes('manufacturing cost')) return 'Credit Mfg Cost'
    if (compensation.toLowerCase().includes('return label')) return 'Return Label'
    if (compensation.toLowerCase().includes('credit')) return 'Credit'
    return compensation
  }

  return (
    <>
      <SiteHeader sectionName="Jetpack Care" />
      <div className="flex flex-1 flex-col overflow-x-hidden bg-background rounded-t-xl">
        <div className="flex flex-col w-full h-[calc(100vh-64px)] px-4 lg:px-6">
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
        <div className="sticky top-0 z-20 -mx-4 lg:-mx-6 mb-3 bg-muted/60 dark:bg-zinc-900/60 rounded-t-xl font-inter text-xs">
          {/* Controls row: Search + Date Range (left) | Filters + New Ticket + Columns (right) */}
          <div className="px-4 lg:px-6 py-3 flex items-center justify-between gap-4">
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

              {/* Date Range - Preset dropdown + Inline date range picker (shown only for Custom) */}
              <div className="flex items-center gap-1.5">
                <Select
                  value={datePreset || 'all'}
                  onValueChange={(value) => {
                    if (value) {
                      handleDatePresetChange(value as DateRangePreset)
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
                      setCurrentPage(1)
                    }}
                    autoOpen
                  />
                )}
              </div>

              {/* Loading indicator */}
              {isLoading && (
                <div className="flex items-center gap-1.5">
                  <JetpackLoader size="sm" />
                  <span className="text-xs text-muted-foreground">Loading</span>
                </div>
              )}

              {/* Demo data indicator */}
              {usingStaticData && (
                <span className="text-xs text-amber-600 dark:text-amber-400">(Demo data)</span>
              )}
            </div>

            {/* RIGHT SIDE: Status + Ticket Type filters + New Ticket + Columns */}
            <div className="flex items-center gap-2">
              {/* Status Filter */}
              <MultiSelectFilter
                options={STATUS_OPTIONS}
                selected={statusFilter}
                onSelectionChange={(values) => {
                  setStatusFilter(values)
                  setCurrentPage(1)
                }}
                placeholder="Status"
                className="w-[120px]"
              />

              {/* Ticket Type Filter */}
              <MultiSelectFilter
                options={ISSUE_TYPE_OPTIONS}
                selected={issueTypeSelection}
                onSelectionChange={handleIssueTypeChange}
                placeholder="Ticket Type"
                className="w-[140px]"
              />

              {/* Clear filters */}
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="text-muted-foreground hover:text-foreground transition-colors"
                  title="Clear filters"
                >
                  <XIcon className="h-3.5 w-3.5" />
                </button>
              )}

              {/* Submit a Claim Button - only show if using real data */}
              {!usingStaticData && (
                <Button size="sm" variant="outline" className="h-[30px] bg-red-100/50 text-red-700 border-red-200 hover:bg-red-200/50 dark:bg-red-900/20 dark:text-red-400 dark:border-red-800/30 dark:hover:bg-red-900/30" onClick={() => setClaimDialogOpen(true)}>
                  <PlusIcon className="h-4 w-4 mr-1 text-red-700 dark:text-red-400" />
                  <span className="hidden lg:inline">Submit a Claim</span>
                </Button>
              )}

              {/* New Ticket Button - only show if using real data */}
              {!usingStaticData && (
                <Button size="sm" variant="outline" className="h-[30px] bg-[#328bcb]/15 text-[#1a5f96] border-[#328bcb]/30 hover:bg-[#328bcb]/25 dark:bg-[#328bcb]/20 dark:text-[#5aa8dc] dark:border-[#328bcb]/40 dark:hover:bg-[#328bcb]/30" onClick={() => setCreateDialogOpen(true)}>
                  <PlusIcon className="h-4 w-4 mr-1 text-[#1a5f96] dark:text-[#5aa8dc]" />
                  <span className="hidden lg:inline">New Ticket</span>
                </Button>
              )}

              {/* Columns button */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" className="h-[30px] flex-shrink-0 items-center text-muted-foreground">
                    <ColumnsIcon className="h-4 w-4" />
                    <span className="ml-[3px] text-xs hidden lg:inline leading-none">
                      ({enabledColumnCount}/{totalColumnCount})
                    </span>
                    <ChevronDownIcon className="h-4 w-4 lg:ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-1 flex items-center justify-between">
                    <span>{enabledColumnCount} of {totalColumnCount} columns</span>
                    {hasColumnCustomizations && (
                      <button
                        onClick={() => setColumnVisibility(DEFAULT_CARE_COLUMNS)}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Reset
                      </button>
                    )}
                  </div>
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
                    checked={columnVisibility.credit}
                    onCheckedChange={(value) =>
                      setColumnVisibility({ ...columnVisibility, credit: value })
                    }
                  >
                    Credit
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

        </div>

        {/* Care Tickets Table */}
        <div className="relative flex flex-col flex-1 min-h-0 overflow-y-auto -mx-4 lg:-mx-6">
          <TooltipProvider>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <table className="w-full text-xs font-inter" style={{ tableLayout: 'fixed' }}>
                  <colgroup>
                    {/* Fixed columns */}
                    {columnVisibility.client && isAdmin && !selectedClientId && columnWidths.client && (
                      <col style={{ width: columnWidths.client }} />
                    )}
                    {isAdmin && !selectedClientId && columnWidths.partner && (
                      <col style={{ width: columnWidths.partner }} />
                    )}
                    {/* Draggable columns in orderedDraggableColumns order */}
                    {orderedDraggableColumns.map(col => {
                      if (!columnVisibility[col.id as keyof typeof columnVisibility]) return null
                      if (!columnWidths[col.id]) return null
                      return <col key={col.id} style={{ width: columnWidths[col.id] }} />
                    })}
                  </colgroup>
                  <thead className="sticky top-0 z-10 bg-surface dark:bg-zinc-900">
                    <SortableContext
                      items={orderedDraggableColumns.map(c => c.id)}
                      strategy={horizontalListSortingStrategy}
                    >
                      <tr className="h-11">
                        {/* Fixed columns - NOT wrapped in SortableHeader */}
                        {/* Client column - only visible for admins viewing all clients */}
                        {columnVisibility.client && isAdmin && !selectedClientId && (
                          <th className="text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide pl-4 lg:pl-6 pr-2"></th>
                        )}
                        {/* Partner column - only visible for admins viewing all clients */}
                        {isAdmin && !selectedClientId && (
                          <th className="text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide"></th>
                        )}

                        {/* Draggable columns - render in orderedDraggableColumns order */}
                        {(() => {
                          // Find the first visible column ID
                          const firstVisibleColId = orderedDraggableColumns.find(c =>
                            columnVisibility[c.id as keyof typeof columnVisibility]
                          )?.id

                          return orderedDraggableColumns.map(col => {
                            if (!columnVisibility[col.id as keyof typeof columnVisibility]) return null

                            // Determine if fixed columns are showing
                            const hasFixedColumns = (columnVisibility.client && isAdmin && !selectedClientId) ||
                                                   (isAdmin && !selectedClientId)
                            // Only apply left padding to the FIRST visible column when no fixed columns
                            const isFirstVisibleColumn = !hasFixedColumns && col.id === firstVisibleColId

                          if (col.id === 'dateCreated') {
                            return (
                              <SortableHeader
                                key={col.id}
                                columnId={col.id}
                                className={cn(
                                  "text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide select-none hover:text-foreground transition-colors",
                                  isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                )}
                                onClick={() => handleSort('date')}
                              >
                                <span className="inline-flex items-center gap-1">
                                  Date
                                  {sortColumn === 'date' && (
                                    sortDirection === 'asc' ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />
                                  )}
                                </span>
                              </SortableHeader>
                            )
                          }

                          if (col.id === 'reference') {
                            return (
                              <SortableHeader
                                key={col.id}
                                columnId={col.id}
                                className={cn(
                                  "text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide",
                                  isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                )}
                              >
                                Reference ID
                              </SortableHeader>
                            )
                          }

                          if (col.id === 'lastUpdated') {
                            return (
                              <SortableHeader
                                key={col.id}
                                columnId={col.id}
                                className={cn(
                                  "text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide select-none hover:text-foreground transition-colors",
                                  isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                )}
                                onClick={() => handleSort('age')}
                              >
                                <span className="inline-flex items-center gap-1">
                                  Age
                                  {sortColumn === 'age' && (
                                    sortDirection === 'asc' ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />
                                  )}
                                </span>
                              </SortableHeader>
                            )
                          }

                          if (col.id === 'type') {
                            return (
                              <SortableHeader
                                key={col.id}
                                columnId={col.id}
                                className={cn(
                                  "text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide",
                                  isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                )}
                              >
                                Type
                              </SortableHeader>
                            )
                          }

                          if (col.id === 'status') {
                            return (
                              <SortableHeader
                                key={col.id}
                                columnId={col.id}
                                className={cn(
                                  "text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide",
                                  isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                )}
                              >
                                Status
                              </SortableHeader>
                            )
                          }

                          if (col.id === 'credit') {
                            return (
                              <SortableHeader
                                key={col.id}
                                columnId={col.id}
                                className={cn(
                                  "text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide select-none hover:text-foreground transition-colors",
                                  isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                )}
                                onClick={() => handleSort('credit')}
                              >
                                <span className="inline-flex items-center gap-1">
                                  Credit
                                  {sortColumn === 'credit' && (
                                    sortDirection === 'asc' ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />
                                  )}
                                </span>
                              </SortableHeader>
                            )
                          }

                          if (col.id === 'latestNotes') {
                            return (
                              <SortableHeader
                                key={col.id}
                                columnId={col.id}
                                className={cn(
                                  "text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide hidden lg:table-cell pr-4 lg:pr-6 transition-opacity duration-200",
                                  expandedRowId ? 'opacity-0' : 'opacity-100',
                                  isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                )}
                              >
                                Description
                              </SortableHeader>
                            )
                          }

                          return null
                          })
                        })()}
                      </tr>
                    </SortableContext>
                  </thead>
                  <tbody>
                    {isLoading ? (
                      <tr>
                        <td
                          colSpan={actualColumnCount}
                          className="h-32 text-center align-middle"
                        >
                          <div className="flex items-center justify-center gap-2">
                            <JetpackLoader size="md" />
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
                              "h-10 cursor-pointer transition-all duration-200",
                              expandedRowId === ticket.id
                                ? "bg-muted/50 dark:bg-muted/50"
                                : "hover:bg-muted/50 border-b border-border",
                              // Dim other rows when one is expanded
                              expandedRowId && expandedRowId !== ticket.id && "opacity-40"
                            )}
                            onClick={() => setExpandedRowId(expandedRowId === ticket.id ? null : ticket.id)}
                          >
                            {/* Client badge - only visible for admins viewing all clients */}
                            {columnVisibility.client && isAdmin && !selectedClientId && (
                              <td className="align-middle pl-4 lg:pl-6 pr-8">
                                {ticket.clientId ? (
                                  <ClientBadge clientId={ticket.clientId} />
                                ) : (isAdmin || effectiveIsCareAdmin) ? (
                                  <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                      <button
                                        className="inline-flex items-center justify-center w-6 h-5 text-[10px] rounded bg-zinc-200/60 dark:bg-zinc-700/60 text-zinc-500 dark:text-zinc-400 hover:bg-zinc-300/80 dark:hover:bg-zinc-600/80 transition-colors"
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                        <PlusIcon className="h-3 w-3" />
                                      </button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
                                      <DropdownMenuLabel>Attribute to Brand</DropdownMenuLabel>
                                      <DropdownMenuSeparator />
                                      {clients.filter(c => c.merchant_id).map(client => (
                                        <DropdownMenuItem
                                          key={client.id}
                                          onClick={() => setConfirmAttribution({ ticketId: ticket.id, clientId: client.id, clientName: client.company_name })}
                                        >
                                          {client.company_name}
                                        </DropdownMenuItem>
                                      ))}
                                      <DropdownMenuSeparator />
                                      <DropdownMenuItem
                                        onClick={() => setConfirmAttribution({ ticketId: ticket.id, clientId: JETPACK_INTERNAL_ID, clientName: 'Jetpack (Parent)' })}
                                      >
                                        <span className="text-orange-600 dark:text-orange-400 font-medium">Jetpack (Parent)</span>
                                      </DropdownMenuItem>
                                    </DropdownMenuContent>
                                  </DropdownMenu>
                                ) : (
                                  <span className="text-muted-foreground">—</span>
                                )}
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

                            {/* Draggable columns in orderedDraggableColumns order */}
                            {(() => {
                              // Find the first visible column ID
                              const firstVisibleColId = orderedDraggableColumns.find(c =>
                                columnVisibility[c.id as keyof typeof columnVisibility]
                              )?.id

                              return orderedDraggableColumns.map(col => {
                                if (!columnVisibility[col.id as keyof typeof columnVisibility]) return null

                                // Determine if fixed columns are showing
                                const hasFixedColumns = (columnVisibility.client && isAdmin && !selectedClientId) ||
                                                       (isAdmin && !selectedClientId)
                                // Only apply left padding to the FIRST visible column when no fixed columns
                                const isFirstVisibleColumn = !hasFixedColumns && col.id === firstVisibleColId

                              if (col.id === 'dateCreated') {
                                return (
                                  <td key={col.id} className={cn(
                                    "align-middle text-muted-foreground whitespace-nowrap",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
                                    {formatDate(ticket.createdAt)}
                                  </td>
                                )
                              }

                              if (col.id === 'reference') {
                                return (
                                  <td key={col.id} className={cn(
                                    "align-middle font-mono text-muted-foreground",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
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
                                      getReferenceId(ticket) || <span className="text-muted-foreground">-</span>
                                    )}
                                  </td>
                                )
                              }

                              if (col.id === 'lastUpdated') {
                                return (
                                  <td key={col.id} className={cn(
                                    "align-middle text-muted-foreground whitespace-nowrap",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
                                    {formatAge(ticket.createdAt, ticket.resolvedAt)}
                                  </td>
                                )
                              }

                              if (col.id === 'type') {
                                return (
                                  <td key={col.id} className={cn(
                                    "align-middle",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
                                    <Badge variant="outline" className={cn("whitespace-nowrap min-w-[72px] justify-center text-[11px]", getTicketTypeColors(ticket.ticketType, ticket.issueType || undefined))}>
                                      {getTicketTypeLabel(ticket.ticketType, ticket.issueType || undefined)}
                                    </Badge>
                                  </td>
                                )
                              }

                              if (col.id === 'status') {
                                return (
                                  <td key={col.id} className={cn(
                                    "align-middle",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
                                    <Badge
                                      variant="outline"
                                      className={cn("whitespace-nowrap min-w-[72px] justify-center text-[11px]", getStatusColors(ticket.status))}
                                    >
                                      {ticket.status}
                                    </Badge>
                                  </td>
                                )
                              }

                              if (col.id === 'credit') {
                                return (
                                  <td key={col.id} className={cn(
                                    "align-middle whitespace-nowrap",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
                                    {ticket.creditAmount > 0 ? (
                                      <span className="text-foreground">{formatCurrency(ticket.creditAmount)}</span>
                                    ) : (
                                      <span className="text-muted-foreground/40">-</span>
                                    )}
                                  </td>
                                )
                              }

                              if (col.id === 'latestNotes') {
                                return (
                                  <td key={col.id} className={cn(
                                    "align-middle hidden lg:table-cell",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
                                    {expandedRowId !== ticket.id && (
                                      <p className="text-muted-foreground truncate pr-4 lg:pr-6">
                                        {ticket.description || <span className="text-muted-foreground">-</span>}
                                      </p>
                                    )}
                                    {expandedRowId === ticket.id && (
                                      <div className="flex justify-end pr-3">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); setExpandedRowId(null) }}
                                          className="p-1 rounded-md text-muted-foreground/50 hover:text-foreground transition-colors"
                                          aria-label="Collapse ticket"
                                        >
                                          <XIcon className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    )}
                                  </td>
                                )
                              }

                              return null
                              })
                            })()}
                          </tr>
                          <AnimatePresence>
                          {expandedRowId === ticket.id && (
                            <tr
                              key={`expanded-${ticket.id}`}
                            >
                              {/* Full-width expanded panel */}
                              <td
                                colSpan={actualColumnCount}
                                className="p-0 border-t-0 bg-muted/50 dark:bg-muted/50"
                              >
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2, ease: "easeOut" }}
                                >
                                  <div className="pt-3 pb-5 font-outfit">
                                    <div className="flex items-start pl-4 lg:pl-6 pr-4">
                                      {/* Left Column: Credit/Buttons only */}
                                      <div className="flex-shrink-0 pr-[18px] w-[143px]">
                                          {/* Credit Card - contextual based on state */}
                                          {(ticket.compensationRequest || ticket.creditAmount > 0 || ticket.status === 'Credit Requested' || ticket.status === 'Credit Approved') && (
                                            <div className={cn(
                                              "rounded-xl px-3 py-2",
                                              ticket.status === 'Resolved' || ticket.status === 'Credit Approved'
                                                ? "bg-emerald-50 dark:bg-emerald-900/40"
                                                : ticket.status === 'Credit Requested'
                                                  ? "bg-orange-50 dark:bg-orange-900/40"
                                                  : "bg-card"
                                            )}>
                                              <div className={cn(
                                                "text-[9px] font-medium uppercase tracking-wider mb-0.5 whitespace-nowrap",
                                                ticket.status === 'Resolved' || ticket.status === 'Credit Approved'
                                                  ? "text-emerald-600 dark:text-emerald-400"
                                                  : ticket.status === 'Credit Requested'
                                                    ? "text-orange-700 dark:text-orange-300"
                                                    : "text-muted-foreground"
                                              )}>
                                                {ticket.status === 'Credit Approved' ? 'Credit Approved' : ticket.status === 'Credit Requested' ? 'Credit Requested' : 'Credit'}
                                              </div>
                                              <div className={cn(
                                                "text-lg font-semibold",
                                                ticket.status === 'Resolved' || ticket.status === 'Credit Approved'
                                                  ? "text-emerald-700 dark:text-emerald-300"
                                                  : ticket.status === 'Credit Requested'
                                                    ? "text-foreground"
                                                    : "text-foreground"
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
                                            <div className="flex flex-col gap-1.5 w-full mt-2.5">
                                              <button
                                                className="w-full px-3 py-1.5 text-[11px] font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted/50 transition-colors"
                                                onClick={(e) => openStatusDialog(ticket, e)}
                                              >
                                                Update Status
                                              </button>
                                              <button
                                                className="w-full px-3 py-1.5 text-[11px] font-medium rounded-md border border-border bg-background text-foreground hover:bg-muted/50 transition-colors"
                                                onClick={(e) => openEditDialog(ticket, e)}
                                              >
                                                Edit Ticket
                                              </button>
                                              <button
                                                className="w-full px-3 py-1.5 text-[11px] font-medium rounded-md border border-border bg-background text-muted-foreground hover:bg-muted/50 transition-colors"
                                                onClick={(e) => openDeleteDialog(ticket, e)}
                                              >
                                                Delete Ticket
                                              </button>
                                            </div>
                                          )}

                                          {/* Files Card - below buttons */}
                                          {ticket.attachments && ticket.attachments.length > 0 && (
                                            <div className="mt-3 bg-card rounded-xl p-3">
                                              <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2">Files</div>
                                              <div className="flex flex-col gap-1.5">
                                                {ticket.attachments.map((file, idx) => (
                                                  <a
                                                    key={idx}
                                                    href={file.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-2 px-2 py-1.5 text-[11px] font-medium bg-background rounded-md border border-border/50 hover:bg-muted/50 transition-colors"
                                                  >
                                                    {getFileIcon(file.type, file.name)}
                                                    <span className="truncate">{file.name}</span>
                                                  </a>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                        </div>

                                      {/* Center column: Details Card + Internal Notes (stacked) */}
                                      <div className="flex flex-col w-[484px] flex-shrink-0">
                                        {/* Details Card - no min-height, flows naturally */}
                                        <div className="bg-card rounded-xl p-4">
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
                                              <hr className="border-border/50 my-3" />
                                              <div className="grid grid-cols-3 gap-x-6">
                                                <div>
                                                  <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">Reshipment</div>
                                                  <div className="text-xs font-medium truncate">
                                                    {ticket.reshipmentStatus === "Please reship for me" ? "Reship for me" :
                                                     ticket.reshipmentStatus === "I've already reshipped" ? "Already reshipped" :
                                                     ticket.reshipmentStatus || "-"}
                                                  </div>
                                                </div>
                                                {/* Only show Reshipment ID column if not "Don't reship" */}
                                                {ticket.reshipmentStatus !== "Don't reship" && (
                                                  <div>
                                                    <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">Reshipment ID</div>
                                                    {ticket.reshipmentId ? (
                                                      <button
                                                        className="text-xs font-mono truncate text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                                                        onClick={(e) => {
                                                          e.stopPropagation()
                                                          setSelectedShipmentId(ticket.reshipmentId)
                                                          setShipmentDrawerOpen(true)
                                                        }}
                                                      >
                                                        {ticket.reshipmentId}
                                                      </button>
                                                    ) : ticket.reshipmentStatus === "Please reship for me" ? (
                                                      <Popover open={addReshipmentIdOpenForTicket === ticket.id} onOpenChange={(open) => {
                                                        setAddReshipmentIdOpenForTicket(open ? ticket.id : null)
                                                        if (!open) setNewReshipmentId('')
                                                      }}>
                                                        <PopoverTrigger asChild>
                                                          <button className="text-xs font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1">
                                                            <PlusIcon className="h-3 w-3" />
                                                            Add
                                                          </button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-56 p-3" align="start">
                                                          <div className="space-y-2">
                                                            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide">Reshipment ID</div>
                                                            <Input
                                                              placeholder="Enter ID..."
                                                              value={newReshipmentId}
                                                              onChange={(e) => setNewReshipmentId(e.target.value)}
                                                              className="h-8 text-sm"
                                                              autoFocus
                                                            />
                                                            <div className="flex justify-end gap-2">
                                                              <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-7 text-xs"
                                                                onClick={() => {
                                                                  setAddReshipmentIdOpenForTicket(null)
                                                                  setNewReshipmentId('')
                                                                }}
                                                              >
                                                                Cancel
                                                              </Button>
                                                              <Button
                                                                size="sm"
                                                                className="h-7 text-xs"
                                                                onClick={() => handleAddReshipmentId(ticket.id)}
                                                                disabled={!newReshipmentId.trim() || isSavingReshipmentId}
                                                              >
                                                                {isSavingReshipmentId ? (
                                                                  <JetpackLoader size="sm" />
                                                                ) : (
                                                                  'Save'
                                                                )}
                                                              </Button>
                                                            </div>
                                                          </div>
                                                        </PopoverContent>
                                                      </Popover>
                                                    ) : (
                                                      <div className="text-xs font-mono truncate">-</div>
                                                    )}
                                                  </div>
                                                )}
                                                {/* Compensation - only for Pick Error */}
                                                {ticket.issueType === 'Pick Error' && (
                                                  <div>
                                                    <div className="text-[10px] font-medium text-muted-foreground/70 uppercase tracking-wider mb-1">Compensation</div>
                                                    <div className="text-xs font-medium truncate">{getShortCompensation(ticket.compensationRequest)}</div>
                                                  </div>
                                                )}
                                              </div>
                                            </>
                                          ) : (
                                            null
                                          )}
                                        </div>

                                        {/* Internal Notes - directly under details card */}
                                        {isAdmin && (
                                          <div className="mt-3">
                                            <div className="bg-card rounded-xl p-3">
                                              <div className="flex items-center justify-between mb-2">
                                                <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Internal Notes</div>
                                                <Popover open={addNoteOpenForTicket === ticket.id} onOpenChange={(open) => {
                                                  setAddNoteOpenForTicket(open ? ticket.id : null)
                                                  if (!open) setNewNoteText('')
                                                }}>
                                                  <PopoverTrigger asChild>
                                                    <button className="flex items-center justify-center w-5 h-5 text-muted-foreground bg-muted/50 hover:bg-muted rounded-md transition-colors border border-border/50">
                                                      <PlusIcon className="h-3 w-3" />
                                                    </button>
                                                  </PopoverTrigger>
                                                  <PopoverContent className="w-72 p-3" align="end">
                                                    <div className="space-y-2">
                                                      <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide">Add Internal Note</div>
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
                                                          className="h-7 text-xs"
                                                          onClick={() => handleAddInternalNote(ticket.id)}
                                                          disabled={!newNoteText.trim() || isAddingNote}
                                                        >
                                                          {isAddingNote ? (
                                                            <JetpackLoader size="sm" />
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
                                                <div className="divide-y divide-border/50">
                                                  {ticket.internalNotes.map((note, idx) => (
                                                    <div key={idx} className="py-2 first:pt-0 last:pb-0">
                                                      <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">{note.note}</p>
                                                      <div className="flex items-center gap-2 mt-1 text-[10px] text-muted-foreground/60">
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
                                      <div className="flex-1 ml-4 flex flex-col">
                                        {/* Combined Description & Activity card */}
                                        <div className="bg-card rounded-xl px-5 py-4 flex-1">
                                              {/* Description section */}
                                              {ticket.description && (
                                                <div className="mb-8">
                                                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-2.5">Description</div>
                                                  <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                                    {ticket.description}
                                                  </p>
                                                </div>
                                              )}

                                              {/* Activity section */}
                                              {ticket.events && ticket.events.length > 0 && (
                                                <>
                                                  <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-3.5">Activity</div>
                                                  <div className="relative">
                                                    {/* Vertical line */}
                                                    <div className="absolute left-[5px] top-2 bottom-2 w-px bg-border" />

                                                    <div className="space-y-5">
                                                      {ticket.events.map((event, idx) => (
                                                        <div key={idx} className="relative flex gap-4 pl-6">
                                                          {/* Timeline dot */}
                                                          <div className={cn(
                                                            "absolute left-0 top-0.5 w-[11px] h-[11px] rounded-full border-2",
                                                            idx === 0
                                                              ? getStatusDotColor(event.status)
                                                              : "bg-background border-border"
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

                {/* Drag overlay - ghost header during drag */}
                <DragOverlay dropAnimation={null}>
                  {activeColumn ? (
                    <div className="px-2 py-2 text-[10px] font-medium text-zinc-500 uppercase tracking-wide bg-surface border rounded shadow-md">
                      {activeColumn.header}
                    </div>
                  ) : null}
                </DragOverlay>
              </DndContext>
          </TooltipProvider>
          {/* Pagination Controls - Sticky at bottom */}
          <div className="sticky bottom-0 bg-background px-4 lg:px-6 py-3 flex items-center justify-between border-t border-border/40">
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
        </div>
      </div>



      {/* Create Ticket Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={(open) => {
        setCreateDialogOpen(open)
        if (!open) {
          setCreateDialogError(null)
          setShipmentLookupError(null)
        }
      }}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="text-xl">Create New Ticket</DialogTitle>
            <DialogDescription>
              Create a support ticket for tracking, work orders, technical issues, or general inquiries.
            </DialogDescription>
          </DialogHeader>

          {/* Error messages */}
          {createDialogError && (
            <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-300 flex items-center justify-between">
              <span>{createDialogError}</span>
              <button
                onClick={() => setCreateDialogError(null)}
                className="text-red-500 hover:text-red-700 dark:hover:text-red-300"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="space-y-5 py-2">
            {/* Row 1: Ticket Type + Shipment ID */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="ticketType" className="text-sm font-medium">
                  Ticket Type <span className="text-red-500">*</span>
                </Label>
                <Select
                  value={createForm.ticketType}
                  onValueChange={(value) => {
                    setCreateForm({ ...createForm, ticketType: value })
                    setCreateDialogError(null)
                  }}
                >
                  <SelectTrigger id="ticketType" className="h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Track">Track</SelectItem>
                    <SelectItem value="Work Order">Work Order</SelectItem>
                    <SelectItem value="Technical">Technical</SelectItem>
                    <SelectItem value="Inquiry">Inquiry</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="shipmentId" className="text-sm font-medium">
                  Shipment ID {createForm.ticketType === 'Track' && <span className="text-red-500">*</span>}
                </Label>
                <div className="relative">
                  <Input
                    id="shipmentId"
                    value={createForm.shipmentId}
                    onChange={(e) => {
                      const value = e.target.value
                      setCreateForm({ ...createForm, shipmentId: value })
                      lookupShipment(value)
                    }}
                    placeholder="e.g., 330867617"
                    className="h-10 pr-8"
                  />
                  {isLookingUpShipment && (
                    <JetpackLoader size="sm" className="absolute right-3 top-3" />
                  )}
                </div>
              </div>
            </div>

            {/* Row 2: Brand (for admins) + Carrier + Tracking */}
            <div className={`grid gap-4 ${isAdmin && (!selectedClientId || selectedClientId === 'all') ? 'grid-cols-3' : 'grid-cols-2'}`}>
              {/* Brand selector - only shown for admins when no specific client is selected */}
              {isAdmin && (!selectedClientId || selectedClientId === 'all') && (
                <div className="space-y-2">
                  <Label htmlFor="clientId" className="text-sm font-medium">
                    Brand <span className="text-red-500">*</span>
                  </Label>
                  <Select
                    value={createForm.clientId}
                    onValueChange={(value) => setCreateForm({ ...createForm, clientId: value })}
                  >
                    <SelectTrigger id="clientId" className="h-10">
                      <SelectValue placeholder="Select brand..." />
                    </SelectTrigger>
                    <SelectContent>
                      {clients.filter(client => client.merchant_id).map((client) => (
                        <SelectItem key={client.id} value={client.id}>
                          {client.company_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="carrier" className="text-sm font-medium">
                  Carrier {createForm.ticketType === 'Track' && <span className="text-red-500">*</span>}
                </Label>
                <Select
                  value={createForm.carrier}
                  onValueChange={(value) => setCreateForm({ ...createForm, carrier: value })}
                  disabled={isLookingUpShipment}
                >
                  <SelectTrigger id="carrier" className="h-10">
                    <SelectValue placeholder={isLookingUpShipment ? "..." : "Select carrier..."} />
                  </SelectTrigger>
                  <SelectContent>
                    {CARRIER_OPTIONS.map((carrier) => (
                      <SelectItem key={carrier} value={carrier}>
                        {carrier}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="trackingNumber" className="text-sm font-medium">
                  Tracking {createForm.ticketType === 'Track' && <span className="text-red-500">*</span>}
                </Label>
                <Input
                  id="trackingNumber"
                  value={createForm.trackingNumber}
                  onChange={(e) => setCreateForm({ ...createForm, trackingNumber: e.target.value })}
                  placeholder={isLookingUpShipment ? "Loading..." : "e.g., 773892456821"}
                  className="h-10"
                  disabled={isLookingUpShipment}
                />
              </div>
            </div>

            {/* Shipment lookup error */}
            {shipmentLookupError && (
              <p className="text-xs text-amber-600 dark:text-amber-400 -mt-2">
                {shipmentLookupError}
              </p>
            )}

            {/* Description */}
            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">
                Description <span className="text-red-500">*</span>
              </Label>
              <Textarea
                id="description"
                value={createForm.description}
                onChange={(e) => setCreateForm({ ...createForm, description: e.target.value })}
                placeholder="Describe the issue or request in detail..."
                rows={4}
                className="resize-none"
              />
            </div>

            {/* File Upload */}
            <div className="space-y-2">
              <Label className="text-sm font-medium">
                Attachments <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <FileUpload
                value={createForm.attachments}
                onChange={(files) => setCreateForm({ ...createForm, attachments: files })}
                maxFiles={10}
                maxSizeMb={15}
                accept="image/png,image/jpeg,.pdf,.xls,.xlsx,.csv,.doc,.docx"
              />
              <p className="text-xs text-muted-foreground">
                Accepted: PNG, JPG, PDF, XLS, CSV, DOC (max 15MB each)
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setCreateDialogOpen(false)
                setCreateForm({
                  ticketType: 'Track',
                  shipmentId: '',
                  clientId: '',
                  carrier: '',
                  trackingNumber: '',
                  description: '',
                  attachments: [],
                })
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleCreateTicket}
              disabled={isCreating}
            >
              {isCreating ? (
                <>
                  <JetpackLoader className="h-4 w-4 mr-2 animate-spin" />
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
                    <SelectItem value="Track">Track</SelectItem>
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
                  <JetpackLoader className="h-4 w-4 mr-2 animate-spin" />
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
      <Dialog open={deleteDialogOpen} onOpenChange={(open) => {
        setDeleteDialogOpen(open)
        if (!open) setDeleteType('archive') // Reset when closing
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete Ticket</DialogTitle>
            <DialogDescription>
              Choose how you want to delete this ticket.
            </DialogDescription>
          </DialogHeader>
          {deletingTicket && (
            <div className="py-4 space-y-4">
              {/* Ticket info */}
              <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50 p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">
                    Ticket #{deletingTicket.ticketNumber}
                  </span>
                  <Badge variant="outline">
                    {deletingTicket.ticketType}
                  </Badge>
                </div>
                {deletingTicket.description && (
                  <p className="text-sm text-muted-foreground line-clamp-2">
                    {deletingTicket.description}
                  </p>
                )}
              </div>

              {/* Delete type selection */}
              <div className="space-y-3">
                <button
                  type="button"
                  onClick={() => setDeleteType('archive')}
                  className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                    deleteType === 'archive'
                      ? 'border-amber-500 bg-amber-50 dark:bg-amber-900/20'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      deleteType === 'archive' ? 'border-amber-500' : 'border-slate-400'
                    }`}>
                      {deleteType === 'archive' && (
                        <div className="w-2 h-2 rounded-full bg-amber-500" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-sm">Archive</p>
                      <p className="text-xs text-muted-foreground">
                        Hide from view but keep data. Can be recovered later.
                      </p>
                    </div>
                  </div>
                </button>

                <button
                  type="button"
                  onClick={() => setDeleteType('permanent')}
                  className={`w-full text-left p-3 rounded-lg border-2 transition-colors ${
                    deleteType === 'permanent'
                      ? 'border-red-500 bg-red-50 dark:bg-red-900/20'
                      : 'border-slate-200 dark:border-slate-700 hover:border-slate-300'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      deleteType === 'permanent' ? 'border-red-500' : 'border-slate-400'
                    }`}>
                      {deleteType === 'permanent' && (
                        <div className="w-2 h-2 rounded-full bg-red-500" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-sm text-red-600 dark:text-red-400">Permanently Delete</p>
                      <p className="text-xs text-muted-foreground">
                        Remove ticket and all attached files forever. Cannot be undone.
                      </p>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant={deleteType === 'permanent' ? 'destructive' : 'default'}
              onClick={handleDeleteTicket}
              disabled={isDeleting}
              className={deleteType === 'archive' ? 'bg-amber-600 hover:bg-amber-700 text-white' : ''}
            >
              {isDeleting ? (
                <>
                  <JetpackLoader className="h-4 w-4 mr-2 animate-spin" />
                  {deleteType === 'permanent' ? 'Deleting...' : 'Archiving...'}
                </>
              ) : (
                deleteType === 'permanent' ? 'Permanently Delete' : 'Archive Ticket'
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
                  <JetpackLoader className="h-4 w-4 mr-2 animate-spin" />
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

      {/* Client Attribution Confirmation Dialog */}
      <AlertDialog open={!!confirmAttribution} onOpenChange={(open) => { if (!open) setConfirmAttribution(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Attribute Ticket</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to attribute this ticket to <strong>{confirmAttribution?.clientName}</strong>?
              {confirmAttribution?.clientId === JETPACK_INTERNAL_ID &&
                " This will mark it as a parent credit — a cost Jetpack absorbed that was not passed on to any client."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isAttributing}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isAttributing}
              onClick={() => {
                if (confirmAttribution) {
                  handleAttributeClient(confirmAttribution.ticketId, confirmAttribution.clientId, confirmAttribution.clientName)
                }
              }}
            >
              {isAttributing ? 'Attributing...' : 'Attribute'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Claim Submission Dialog */}
      <ClaimSubmissionDialog
        open={claimDialogOpen}
        onOpenChange={setClaimDialogOpen}
        onSuccess={() => {
          // Refresh the tickets list after successful claim submission
          fetchTickets()
        }}
      />
    </>
  )
}
