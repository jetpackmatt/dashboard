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
  CopyIcon,
  CheckCircle2Icon,
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
import { CARE_TABLE_CONFIG } from "@/lib/table-config"
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
import { MultiSelectFilter } from "@/components/ui/multi-select-filter"
import { cn } from "@/lib/utils"
import { useClient } from "@/components/client-context"
import { ClientBadge, JETPACK_INTERNAL_ID } from "@/components/transactions/client-badge"
import { getTrackingUrl, getCarrierDisplayName } from "@/components/transactions/cell-renderers"
import { TrackingLink } from "@/components/tracking-link"
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
import { useUserSettings } from "@/hooks/use-user-settings"
import { useColumnOrder } from "@/hooks/use-responsive-table"

import { ShipmentDetailsDrawer } from "@/components/shipment-details-drawer"
import { ClaimSubmissionDialog } from "@/components/claims/claim-submission-dialog"
import { FileUpload } from "@/components/claims/file-upload"
import { DeleteTicketDialog } from "@/components/care/delete-ticket-dialog"
import { StatusUpdateDialog } from "@/components/care/status-update-dialog"
import { EditTicketDialog } from "@/components/care/edit-ticket-dialog"
import { CreateTicketDialog } from "@/components/care/create-ticket-dialog"
import type { Ticket, TicketEvent, InternalNote, FileAttachment, Partner, DateRangePreset } from "@/lib/care/types"
import { CARRIER_OPTIONS, DATE_RANGE_PRESETS, STATUS_OPTIONS, ISSUE_TYPE_OPTIONS, ALL_STATUSES, DEFAULT_STATUSES } from "@/lib/care/constants"
import {
  getDateRangeFromPreset,
  getStatusColors,
  getExpandedRowTint,
  getExpandedPanelTint,
  getTicketTypeColors,
  getTicketTypeLabel,
  getStatusTextColor,
  getStatusDotColor,
  getFileIcon,
} from "@/lib/care/helpers"
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
  const { selectedClientId, isAdmin, effectiveIsAdmin, effectiveIsCareUser, effectiveIsCareAdmin, clients } = useClient()
  const canViewAllBrands = effectiveIsAdmin || effectiveIsCareUser
  const { settings: userSettings } = useUserSettings()
  const [createDialogOpen, setCreateDialogOpen] = React.useState(false)
  const [claimDialogOpen, setClaimDialogOpen] = React.useState(false)

  // Data state
  const [tickets, setTickets] = React.useState<Ticket[]>([])
  const [totalCount, setTotalCount] = React.useState(0)
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [createDialogError, setCreateDialogError] = React.useState<string | null>(null)

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
  // When no filter is active: use preference to decide whether to include Resolved
  const selectedStatuses = React.useMemo(() => {
    if (statusFilter.length > 0) return statusFilter
    return userSettings.hideResolvedTickets ? DEFAULT_STATUSES : ALL_STATUSES
  }, [statusFilter, userSettings.hideResolvedTickets])

  // Pagination state
  const [currentPage, setCurrentPage] = React.useState(1)

  // Expanded row state
  const [expandedRowId, setExpandedRowId] = React.useState<string | null>(null)
  const scrollContainerRef = React.useRef<HTMLDivElement>(null)
  const [containerWidth, setContainerWidth] = React.useState(1200)

  React.useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    const ro = new ResizeObserver(([entry]) => {
      setContainerWidth(entry.contentRect.width)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

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
  const carePrefs = useTablePreferences('care', userSettings.defaultPageSize)

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
  const getReferenceId = (ticket: Ticket): string => {
    // For Claims and Shipment Inquiry tickets, prioritize shipment ID, then order ID
    if (ticket.ticketType === 'Claim' || ticket.ticketType === 'Shipment Inquiry') {
      return ticket.shipmentId || ticket.orderId || String(ticket.ticketNumber)
    }
    // For Requests, use work order ID or inventory ID
    if (ticket.ticketType === 'Request') {
      return ticket.workOrderId || ticket.inventoryId || String(ticket.ticketNumber)
    }
    // For Technical/Inquiry, use order ID or shipment ID
    return ticket.orderId || ticket.shipmentId || String(ticket.ticketNumber)
  }

  // Create ticket form state

  // Edit ticket state
  const [editDialogOpen, setEditDialogOpen] = React.useState(false)
  const [editingTicket, setEditingTicket] = React.useState<Ticket | null>(null)

  // Delete ticket state
  const [deleteDialogOpen, setDeleteDialogOpen] = React.useState(false)
  const [deletingTicket, setDeletingTicket] = React.useState<Ticket | null>(null)

  // Status update state
  const [statusDialogOpen, setStatusDialogOpen] = React.useState(false)
  const [statusTicket, setStatusTicket] = React.useState<Ticket | null>(null)

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
    (columnVisibility.client && canViewAllBrands && !selectedClientId ? 1 : 0) +
    (canViewAllBrands && !selectedClientId ? 1 : 0) + // Partner column
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
      params.set('limit', carePrefs.pageSize.toString())
      params.set('offset', ((currentPage - 1) * carePrefs.pageSize).toString())

      const response = await fetch(`/api/data/care-tickets?${params}`)

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Failed to fetch tickets' }))
        throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()
      setTickets(data.data || [])
      setTotalCount(data.totalCount || 0)
      setError(null)
    } catch (err) {
      console.error('Error fetching care tickets:', err)
      setError(err instanceof Error ? err.message : 'Failed to load tickets')
      setTickets([])
      setTotalCount(0)
    } finally {
      setIsLoading(false)
    }
  }, [selectedClientId, selectedStatuses, typeFilter, issueFilter, dateRange, searchQuery, currentPage, carePrefs.pageSize])

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

  // API handles its own pagination, so we just display what we received
  const displayedTickets = sortedTickets

  const totalPages = Math.ceil(totalCount / carePrefs.pageSize)


  // Open edit dialog with ticket data
  const openEditDialog = (ticket: Ticket, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent row expansion
    setEditingTicket(ticket)
    setEditDialogOpen(true)
  }

  // Open delete confirmation dialog
  const openDeleteDialog = (ticket: Ticket, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent row expansion
    setDeletingTicket(ticket)
    setDeleteDialogOpen(true)
  }

  // Handle delete ticket (archive or permanent)
  // Open status update dialog
  const openStatusDialog = (ticket: Ticket, e: React.MouseEvent) => {
    e.stopPropagation() // Prevent row expansion
    setStatusTicket(ticket)
    setStatusDialogOpen(true)
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

      const data = await response.json()

      // Update ticket inline without full refresh
      setTickets(prev => prev.map(t => {
        if (t.id !== ticketId) return t
        const newNote: InternalNote = {
          note: newNoteText.trim(),
          createdAt: new Date().toISOString(),
          createdBy: data.ticket?.internal_notes?.[0]?.createdBy || 'You',
        }
        return {
          ...t,
          internalNotes: [newNote, ...(t.internalNotes || [])],
        }
      }))

      setAddNoteOpenForTicket(null)
      setNewNoteText('')
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
      <SiteHeader sectionName="Jetpack Care">
        {isLoading && (
          <div className="flex items-center gap-1.5 ml-[10px]">
            <JetpackLoader size="md" />
            <span className="text-xs text-muted-foreground">Loading</span>
          </div>
        )}
      </SiteHeader>
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
        <div className="sticky top-0 z-20 -mx-4 lg:-mx-6 mb-3 bg-muted/60 dark:bg-zinc-900/60 rounded-t-xl font-roboto text-xs">
          {/* Controls row: Search + Date Range (left) | Filters + New Ticket + Columns (right) */}
          <div className="px-4 lg:px-6 h-[70px] flex items-center justify-between gap-4">
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
                  <SelectContent align="start" className="font-roboto text-xs">
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

            </div>

            {/* RIGHT SIDE: Status + Ticket Type filters + New Ticket + Columns */}
            <div className="flex items-center gap-2">
              {/* Clear filters */}
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="inline-flex items-center gap-1 h-[22px] px-1.5 rounded text-[11px] text-muted-foreground hover:text-foreground bg-muted/50 hover:bg-muted transition-colors"
                  title="Clear filters"
                >
                  <XIcon className="h-3 w-3" />
                  <span>Clear</span>
                </button>
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

              {/* Submit a Claim Button */}
              <Button size="sm" variant="ghost" className="h-[30px] bg-[#eb9458]/20 text-[#c06520] font-medium border-0 hover:bg-[#eb9458]/30 dark:bg-[#eb9458]/25 dark:text-[#f0a868] dark:hover:bg-[#eb9458]/35" onClick={() => setClaimDialogOpen(true)}>
                <PlusIcon className="h-4 w-4 mr-1" />
                <span className="hidden lg:inline">Submit a Claim</span>
              </Button>

              {/* New Ticket Button */}
              <Button size="sm" variant="ghost" className="h-[30px] bg-[#328bcb]/15 text-[#1a5f96] font-medium border-0 hover:bg-[#328bcb]/25 dark:bg-[#328bcb]/20 dark:text-[#5aa8dc] dark:hover:bg-[#328bcb]/30" onClick={() => setCreateDialogOpen(true)}>
                <PlusIcon className="h-4 w-4 mr-1" />
                <span className="hidden lg:inline">New Ticket</span>
              </Button>

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
        <div ref={scrollContainerRef} className="relative flex flex-col flex-1 min-h-0 overflow-y-auto overflow-x-hidden -mx-4 lg:-mx-6">
          <TooltipProvider>
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <table className="w-full text-[13px] font-roboto" style={{ tableLayout: 'auto' }}>
                  <thead className="sticky top-0 z-10 bg-surface dark:bg-zinc-900">
                    <SortableContext
                      items={orderedDraggableColumns.map(c => c.id)}
                      strategy={horizontalListSortingStrategy}
                    >
                      <tr className={cn("h-[45px] transition-opacity duration-200", expandedRowId ? 'opacity-30' : 'opacity-100')}>
                        {/* Fixed columns - NOT wrapped in SortableHeader */}
                        {/* Client column - only visible for admins viewing all clients */}
                        {columnVisibility.client && canViewAllBrands && !selectedClientId && (
                          <th className="w-px whitespace-nowrap text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide pl-4 lg:pl-6 pr-2"></th>
                        )}
                        {/* Partner column - only visible for admins viewing all clients */}
                        {canViewAllBrands && !selectedClientId && (
                          <th className="w-px whitespace-nowrap px-2 text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide"></th>
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
                            const hasFixedColumns = (columnVisibility.client && canViewAllBrands && !selectedClientId) ||
                                                   (canViewAllBrands && !selectedClientId)
                            // Only apply left padding to the FIRST visible column when no fixed columns
                            const isFirstVisibleColumn = !hasFixedColumns && col.id === firstVisibleColId

                          if (col.id === 'dateCreated') {
                            return (
                              <SortableHeader
                                key={col.id}
                                columnId={col.id}
                                className={cn(
                                  "px-4 text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide whitespace-nowrap select-none hover:text-foreground transition-colors",
                                  isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                )}
                                onClick={() => handleSort('date')}
                              >
                                <span className="inline-flex items-center gap-1">
                                  Date
                                  {sortColumn === 'date' && (
                                    sortDirection === 'asc' ? <ChevronUpIcon className="h-3 w-3 text-foreground" /> : <ChevronDownIcon className="h-3 w-3 text-foreground" />
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
                                  "px-2 text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide whitespace-nowrap",
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
                                  "px-4 text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide whitespace-nowrap select-none hover:text-foreground transition-colors",
                                  isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                )}
                                onClick={() => handleSort('age')}
                              >
                                <span className="inline-flex items-center gap-1">
                                  Age
                                  {sortColumn === 'age' && (
                                    sortDirection === 'asc' ? <ChevronUpIcon className="h-3 w-3 text-foreground" /> : <ChevronDownIcon className="h-3 w-3 text-foreground" />
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
                                  "px-2 text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide whitespace-nowrap",
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
                                  "px-2 text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide whitespace-nowrap",
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
                                  "px-4 text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide whitespace-nowrap select-none hover:text-foreground transition-colors",
                                  isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                )}
                                onClick={() => handleSort('credit')}
                              >
                                <span className="inline-flex items-center gap-1">
                                  Credit
                                  {sortColumn === 'credit' && (
                                    sortDirection === 'asc' ? <ChevronUpIcon className="h-3 w-3 text-foreground" /> : <ChevronDownIcon className="h-3 w-3 text-foreground" />
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
                                  "px-2 text-left align-middle text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wide whitespace-nowrap hidden lg:table-cell pr-4 lg:pr-6",
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
                      null
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
                              "h-[50px] cursor-pointer transition-all duration-200",
                              expandedRowId === ticket.id
                                ? cn("border-b border-transparent", getExpandedRowTint(ticket.status))
                                : "border-b border-border/50 dark:bg-[hsl(220,8%,8%)] dark:hover:bg-[hsl(220,8%,10%)] hover:bg-muted/30",
                              // Dim other rows when one is expanded
                              expandedRowId && expandedRowId !== ticket.id && "opacity-40"
                            )}
                            onClick={() => setExpandedRowId(expandedRowId === ticket.id ? null : ticket.id)}
                          >
                            {/* Client badge - only visible for admins viewing all clients */}
                            {columnVisibility.client && canViewAllBrands && !selectedClientId && (
                              <td className="w-px whitespace-nowrap align-middle pl-4 lg:pl-6 pr-2">
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
                            {canViewAllBrands && !selectedClientId && (
                              <td className="w-px whitespace-nowrap px-2 align-middle">
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
                                const hasFixedColumns = (columnVisibility.client && canViewAllBrands && !selectedClientId) ||
                                                       (canViewAllBrands && !selectedClientId)
                                // Only apply left padding to the FIRST visible column when no fixed columns
                                const isFirstVisibleColumn = !hasFixedColumns && col.id === firstVisibleColId

                              if (col.id === 'dateCreated') {
                                return (
                                  <td key={col.id} className={cn(
                                    "px-4 align-middle text-muted-foreground whitespace-nowrap",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
                                    {formatDate(ticket.createdAt)}
                                  </td>
                                )
                              }

                              if (col.id === 'reference') {
                                const refId = getReferenceId(ticket)
                                return (
                                  <td key={col.id} className={cn(
                                    "px-2 align-middle font-mono text-muted-foreground whitespace-nowrap overflow-hidden",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
                                    {refId ? (
                                      <div className="group/cell flex items-center gap-1.5">
                                        {ticket.shipmentId ? (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation()
                                              setSelectedShipmentId(ticket.shipmentId as string)
                                              setShipmentDrawerOpen(true)
                                            }}
                                            className="text-primary hover:underline cursor-pointer truncate"
                                          >
                                            {ticket.shipmentId}
                                          </button>
                                        ) : (
                                          <span className="truncate">{refId}</span>
                                        )}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation()
                                            navigator.clipboard.writeText(refId)
                                            toast.success("Reference ID copied")
                                          }}
                                          className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
                                          title="Copy Reference ID"
                                        >
                                          <CopyIcon className="h-3.5 w-3.5" />
                                        </button>
                                      </div>
                                    ) : (
                                      <span className="text-muted-foreground">-</span>
                                    )}
                                  </td>
                                )
                              }

                              if (col.id === 'lastUpdated') {
                                return (
                                  <td key={col.id} className={cn(
                                    "px-4 align-middle text-muted-foreground whitespace-nowrap",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
                                    {formatAge(ticket.createdAt, ticket.resolvedAt)}
                                  </td>
                                )
                              }

                              if (col.id === 'type') {
                                return (
                                  <td key={col.id} className={cn(
                                    "px-2 align-middle whitespace-nowrap",
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
                                    "px-2 align-middle whitespace-nowrap",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
                                    <Badge
                                      variant="outline"
                                      className={cn("whitespace-nowrap min-w-[72px] justify-center text-[11px] gap-1", getStatusColors(ticket.status))}
                                    >
                                      {ticket.status === 'Resolved' && <CheckCircle2Icon className="h-3 w-3" />}
                                      {ticket.status}
                                    </Badge>
                                  </td>
                                )
                              }

                              if (col.id === 'credit') {
                                return (
                                  <td key={col.id} className={cn(
                                    "px-4 align-middle whitespace-nowrap",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
                                    <span className={cn(
                                      expandedRowId === ticket.id && "invisible"
                                    )}>
                                    {ticket.creditAmount > 0 ? (
                                      <span className="text-foreground">{formatCurrency(ticket.creditAmount)}</span>
                                    ) : (ticket.compensationRequest || ticket.status === 'Credit Requested' || ticket.status === 'Credit Approved') ? (
                                      <span className="text-muted-foreground/60">TBD</span>
                                    ) : (
                                      <span className="text-muted-foreground/40">-</span>
                                    )}
                                    </span>
                                  </td>
                                )
                              }

                              if (col.id === 'latestNotes') {
                                return (
                                  <td key={col.id} className={cn(
                                    "px-2 align-middle hidden lg:table-cell",
                                    isFirstVisibleColumn && 'pl-4 lg:pl-6'
                                  )}>
                                    <div className="relative" style={{ maxWidth: Math.max(100, containerWidth - 710) }}>
                                      {/* Always render description to preserve column width in table-layout:auto */}
                                      <p className={cn(
                                        "text-muted-foreground truncate pr-4 lg:pr-6",
                                        expandedRowId === ticket.id && "invisible"
                                      )}>
                                        {ticket.description || <span className="text-muted-foreground">-</span>}
                                      </p>
                                      {expandedRowId === ticket.id && (
                                        <div className="absolute inset-0 flex items-center justify-end pr-3">
                                          <button
                                            onClick={(e) => { e.stopPropagation(); setExpandedRowId(null) }}
                                            className="p-1 rounded-md text-muted-foreground/50 hover:text-foreground transition-colors"
                                            aria-label="Collapse ticket"
                                          >
                                            <XIcon className="h-3.5 w-3.5" />
                                          </button>
                                        </div>
                                      )}
                                    </div>
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
                                className={cn("p-0 border-t-0 shadow-[0_4px_12px_-4px_rgba(0,0,0,0.08)]", getExpandedPanelTint(ticket.status))}
                              >
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  transition={{ duration: 0.2, ease: "easeOut" }}
                                  className="overflow-hidden"
                                  style={{ maxWidth: containerWidth }}
                                >
                                  <div className="border-t-2 border-white border-b-2 border-white dark:border-white/15">
                                    <div className="flex items-stretch overflow-hidden">
                                      {/* Left Column: Credit/Buttons/Files */}
                                      <div className="flex-shrink-0 w-[180px] border-r-2 border-white dark:border-r-white/15 flex flex-col">
                                          {/* Credit Card - contextual based on state */}
                                          {(ticket.compensationRequest || ticket.creditAmount > 0 || ticket.status === 'Credit Requested' || ticket.status === 'Credit Approved' || ticket.status === 'Credit Denied') && (
                                            <div className="pl-4 lg:pl-6 pr-[calc(1rem+5px)] py-[calc(1rem+2px)] border-b-2 border-white dark:border-b-white/15">
                                              <div className={cn(
                                                "text-[9px] font-medium uppercase tracking-wider mb-0.5 whitespace-nowrap",
                                                ticket.status === 'Resolved' || ticket.status === 'Credit Approved'
                                                  ? "text-emerald-600 dark:text-emerald-400"
                                                  : ticket.status === 'Credit Denied'
                                                    ? "text-red-600 dark:text-red-400"
                                                    : ticket.status === 'Credit Requested'
                                                      ? "text-orange-700 dark:text-orange-300"
                                                      : "text-muted-foreground"
                                              )}>
                                                {ticket.status === 'Credit Approved' ? 'Credit Approved' : ticket.status === 'Credit Denied' ? 'Credit Denied' : ticket.status === 'Credit Requested' ? 'Credit Requested' : 'Credit'}
                                              </div>
                                              <div className={cn(
                                                "text-lg font-semibold",
                                                ticket.status === 'Resolved' || ticket.status === 'Credit Approved'
                                                  ? "text-emerald-700 dark:text-emerald-300"
                                                  : ticket.status === 'Credit Denied'
                                                    ? "text-red-700 dark:text-red-300 line-through"
                                                    : "text-foreground"
                                              )}>
                                                {ticket.creditAmount > 0 ? formatCurrency(ticket.creditAmount) : 'TBD'}
                                              </div>
                                              {(ticket.status === 'Credit Requested' || ticket.status === 'Credit Approved' || ticket.status === 'Credit Denied') && (
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
                                                        : ticket.status === 'Credit Denied'
                                                          ? `Denied on ${month}/${day}`
                                                          : `Requested on ${month}/${day}`
                                                    }
                                                    return null
                                                  })()}
                                                </div>
                                              )}
                                            </div>
                                          )}

                                          {/* Action Buttons */}
                                          <div className="flex flex-col w-full px-3 lg:px-4 py-4 gap-1.5 border-b-2 border-white dark:border-b-white/15 bg-white/25 dark:bg-black/20">
                                            <button
                                              className="w-full px-2.5 py-[6px] text-[11px] font-medium text-foreground bg-white/60 dark:bg-white/10 hover:bg-white dark:hover:bg-white/10 rounded ring-1 ring-black/[0.12] dark:ring-white/10 transition-all text-left"
                                              onClick={(e) => { e.stopPropagation(); openStatusDialog(ticket, e) }}
                                            >
                                              Update Status
                                            </button>
                                            <button
                                              className="w-full px-2.5 py-[6px] text-[11px] font-medium text-foreground bg-white/60 dark:bg-white/10 hover:bg-white dark:hover:bg-white/10 rounded ring-1 ring-black/[0.12] dark:ring-white/10 transition-all text-left"
                                              onClick={(e) => { e.stopPropagation(); openEditDialog(ticket, e) }}
                                            >
                                              Edit Ticket
                                            </button>
                                            <button
                                              className="w-full px-2.5 py-[6px] text-[11px] font-medium text-destructive bg-white/60 dark:bg-white/10 hover:bg-white dark:hover:bg-white/10 rounded ring-1 ring-black/[0.12] dark:ring-white/10 transition-all text-left"
                                              onClick={(e) => { e.stopPropagation(); openDeleteDialog(ticket, e) }}
                                            >
                                              Delete Ticket
                                            </button>
                                          </div>

                                          {/* Files Section - only in left column when carrier/tracking are shown in center */}
                                          {ticket.attachments && ticket.attachments.length > 0 && !!(ticket.carrier || ticket.trackingNumber) && (
                                            <div className="flex-1 pl-4 lg:pl-6 pr-7 pt-5 pb-7">
                                              <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-3">Files</div>
                                              <div className="flex flex-col gap-1.5">
                                                {ticket.attachments.map((file, idx) => (
                                                  <a
                                                    key={idx}
                                                    href={file.url}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="flex items-center gap-2 py-1 text-[11px] font-medium text-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors min-w-0"
                                                  >
                                                    {getFileIcon(file.type, file.name)}
                                                    <span className="truncate block">{file.name}</span>
                                                  </a>
                                                ))}
                                              </div>
                                            </div>
                                          )}
                                        </div>

                                      {/* Center column: Details + Internal Notes */}
                                      <div className="flex flex-col flex-1 border-r-2 border-white dark:border-r-white/15">
                                        {/* Details Section */}
                                        <div className="border-b-2 border-white dark:border-b-white/15">
                                          {/* Row 1: Ticket # + (Carrier/Tracking OR Files OR Internal Notes) */}
                                          {(() => {
                                            const hasCarrierOrTracking = !!(ticket.carrier || ticket.trackingNumber)
                                            const hasFiles = ticket.attachments && ticket.attachments.length > 0
                                            // What fills the 2nd+3rd columns: carrier/tracking > files > internal notes > nothing
                                            const fillMode = hasCarrierOrTracking ? 'carrier-tracking' : hasFiles ? 'files' : (effectiveIsAdmin || effectiveIsCareUser) ? 'internal-notes' : 'ticket-only'
                                            return (
                                              <div className={cn(
                                                "grid",
                                                fillMode === 'carrier-tracking' ? "grid-cols-3" : fillMode === 'ticket-only' ? "grid-cols-1" : "grid-cols-[1fr_2fr]",
                                                ticket.ticketType === 'Claim' && ticket.issueType !== 'Loss' && ticket.issueType !== 'Damage' && "border-b-2 border-white dark:border-b-white/15"
                                              )}>
                                                <div className={cn("px-5 py-7", fillMode !== 'ticket-only' && "border-r-2 border-white dark:border-r-white/15")}>
                                                  <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-1.5">Ticket #</div>
                                                  <div className="group/cell flex items-center gap-1.5">
                                                    <span className="text-[13px] font-mono truncate">{ticket.ticketNumber}</span>
                                                    {ticket.ticketNumber && (
                                                      <button
                                                        onClick={(e) => {
                                                          e.stopPropagation()
                                                          navigator.clipboard.writeText(ticket.ticketNumber.toString())
                                                          toast.success("Ticket # copied")
                                                        }}
                                                        className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
                                                        title="Copy Ticket #"
                                                      >
                                                        <CopyIcon className="h-3.5 w-3.5" />
                                                      </button>
                                                    )}
                                                  </div>
                                                </div>
                                                {fillMode === 'carrier-tracking' && (
                                                  <>
                                                    <div className="px-5 py-7 border-r-2 border-white dark:border-r-white/15">
                                                      <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-1.5">Carrier</div>
                                                      <div className="text-[13px] font-medium truncate">{ticket.carrier || '-'}</div>
                                                    </div>
                                                    <div className="px-5 py-7">
                                                      <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-1.5">Tracking #</div>
                                                      {ticket.trackingNumber ? (
                                                        <div className="group/cell flex items-center gap-1.5">
                                                          <TrackingLink
                                                            trackingNumber={ticket.trackingNumber}
                                                            carrier={ticket.carrier || ''}
                                                            className="text-[13px] font-mono truncate text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline"
                                                          >
                                                            {ticket.trackingNumber}
                                                          </TrackingLink>
                                                          <button
                                                            onClick={(e) => {
                                                              e.stopPropagation()
                                                              navigator.clipboard.writeText(ticket.trackingNumber || '')
                                                              toast.success("Tracking # copied")
                                                            }}
                                                            className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
                                                            title="Copy Tracking #"
                                                          >
                                                            <CopyIcon className="h-3.5 w-3.5" />
                                                          </button>
                                                        </div>
                                                      ) : (
                                                        <div className="text-[13px] font-mono truncate">-</div>
                                                      )}
                                                    </div>
                                                  </>
                                                )}
                                                {fillMode === 'files' && (
                                                  <div className="px-5 py-7">
                                                    <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-3">Files</div>
                                                    <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                                      {ticket.attachments!.map((file, idx) => (
                                                        <a
                                                          key={idx}
                                                          href={file.url}
                                                          target="_blank"
                                                          rel="noopener noreferrer"
                                                          className="flex items-center gap-2 py-1 text-[11px] font-medium text-foreground hover:text-blue-600 dark:hover:text-blue-400 transition-colors min-w-0"
                                                        >
                                                          {getFileIcon(file.type, file.name)}
                                                          <span className="truncate block">{file.name}</span>
                                                        </a>
                                                      ))}
                                                    </div>
                                                  </div>
                                                )}
                                                {fillMode === 'internal-notes' && (
                                                  <div className="px-5 py-7 bg-white/25 dark:bg-black/20">
                                                    <div className="flex items-center gap-2 mb-2">
                                                      <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">Internal Notes</div>
                                                      <Popover open={addNoteOpenForTicket === ticket.id} onOpenChange={(open) => {
                                                        setAddNoteOpenForTicket(open ? ticket.id : null)
                                                        if (!open) setNewNoteText('')
                                                      }}>
                                                        <PopoverTrigger asChild>
                                                          <button className="flex items-center justify-center w-4 h-4 text-muted-foreground hover:text-foreground transition-colors">
                                                            <PlusIcon className="h-3.5 w-3.5" />
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
                                                            <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">{note.note}</p>
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
                                                )}
                                              </div>
                                            )
                                          })()}

                                          {/* Claim-specific rows - varies by issue type */}
                                          {ticket.ticketType === 'Claim' && ticket.issueType !== 'Loss' && ticket.issueType !== 'Damage' ? (
                                            <>
                                              <div className="grid grid-cols-3">
                                                <div className="px-5 py-7 border-r-2 border-white dark:border-r-white/15">
                                                  <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-1.5">Reshipment</div>
                                                  <div className="text-[13px] font-medium truncate">
                                                    {ticket.reshipmentStatus === "Please reship for me" ? "Reship for me" :
                                                     ticket.reshipmentStatus === "I've already reshipped" ? "Already reshipped" :
                                                     ticket.reshipmentStatus || "-"}
                                                  </div>
                                                </div>
                                                {/* Only show Reshipment ID column if not "Don't reship" */}
                                                {ticket.reshipmentStatus !== "Don't reship" && (
                                                  <div className="px-5 py-7 border-r-2 border-white dark:border-r-white/15">
                                                    <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-1.5">Reshipment ID</div>
                                                    {ticket.reshipmentId ? (
                                                      <div className="group/cell flex items-center gap-1.5">
                                                        <button
                                                          className="text-[13px] font-mono truncate text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 hover:underline text-left"
                                                          onClick={(e) => {
                                                            e.stopPropagation()
                                                            setSelectedShipmentId(ticket.reshipmentId)
                                                            setShipmentDrawerOpen(true)
                                                          }}
                                                        >
                                                          {ticket.reshipmentId}
                                                        </button>
                                                        <button
                                                          onClick={(e) => {
                                                            e.stopPropagation()
                                                            navigator.clipboard.writeText(ticket.reshipmentId || '')
                                                            toast.success("Reshipment ID copied")
                                                          }}
                                                          className="p-0.5 hover:bg-muted rounded text-muted-foreground hover:text-foreground transition-colors flex-shrink-0 opacity-0 group-hover/cell:opacity-100"
                                                          title="Copy Reshipment ID"
                                                        >
                                                          <CopyIcon className="h-3.5 w-3.5" />
                                                        </button>
                                                      </div>
                                                    ) : ticket.reshipmentStatus === "Please reship for me" ? (
                                                      <Popover open={addReshipmentIdOpenForTicket === ticket.id} onOpenChange={(open) => {
                                                        setAddReshipmentIdOpenForTicket(open ? ticket.id : null)
                                                        if (!open) setNewReshipmentId('')
                                                      }}>
                                                        <PopoverTrigger asChild>
                                                          <button className="text-[13px] font-medium text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1">
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
                                                      <div className="text-[13px] font-mono truncate">-</div>
                                                    )}
                                                  </div>
                                                )}
                                                {/* Compensation - only for Pick Error */}
                                                {ticket.issueType === 'Pick Error' && (
                                                  <div className="px-5 py-7">
                                                    <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-1.5">Compensation</div>
                                                    <div className="text-[13px] font-medium truncate">{getShortCompensation(ticket.compensationRequest)}</div>
                                                  </div>
                                                )}
                                              </div>
                                            </>
                                          ) : (
                                            null
                                          )}
                                        </div>

                                        {/* Internal Notes Section - only here when carrier/tracking or files exist (otherwise shown in top row) */}
                                        {(effectiveIsAdmin || effectiveIsCareUser) && !!(ticket.carrier || ticket.trackingNumber || (ticket.attachments && ticket.attachments.length > 0)) && (
                                          <div className="flex-1 bg-white/25 dark:bg-black/20">
                                            <div className="p-5">
                                              <div className="flex items-center gap-2 mb-2">
                                                <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider">Internal Notes</div>
                                                <Popover open={addNoteOpenForTicket === ticket.id} onOpenChange={(open) => {
                                                  setAddNoteOpenForTicket(open ? ticket.id : null)
                                                  if (!open) setNewNoteText('')
                                                }}>
                                                  <PopoverTrigger asChild>
                                                    <button className="flex items-center justify-center w-4 h-4 text-muted-foreground hover:text-foreground transition-colors">
                                                      <PlusIcon className="h-3.5 w-3.5" />
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
                                                      <p className="text-[13px] text-foreground whitespace-pre-wrap leading-relaxed">{note.note}</p>
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

                                      {/* Right section: Description and Activity */}
                                      <div className="flex-1 min-w-0 flex flex-col">
                                        {/* Description section */}
                                        {ticket.description && (
                                          <div className="px-6 py-[calc(1.75rem-0.5px)] border-b-2 border-white dark:border-b-white/15 bg-white/25 dark:bg-black/20">
                                            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-1.5">Description</div>
                                            <p className="text-[13px] text-foreground whitespace-pre-wrap break-words leading-relaxed">
                                              {ticket.description}
                                            </p>
                                          </div>
                                        )}

                                        {/* Activity section */}
                                        {ticket.events && ticket.events.length > 0 && (
                                          <div className="px-6 py-5 flex-1 font-outfit">
                                            <div className="text-[10px] font-medium text-zinc-500 dark:text-zinc-500 uppercase tracking-wider mb-3.5">Activity</div>
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
                                                                "text-[13px] leading-relaxed",
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
                                          </div>
                                        )}
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
                  value={`${carePrefs.pageSize}`}
                  onValueChange={(value) => {
                    carePrefs.setPageSize(Number(value))
                    setCurrentPage(1) // Reset to first page when changing page size
                  }}
                >
                  <SelectTrigger className="w-20" id="rows-per-page">
                    <SelectValue placeholder={carePrefs.pageSize} />
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
      <CreateTicketDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onCreated={async () => {
          fetchTickets()
        }}
        selectedClientId={selectedClientId}
        clients={clients}
        isAdmin={effectiveIsAdmin || effectiveIsCareUser}
      />

      {/* Edit Ticket Dialog */}
      <EditTicketDialog
        open={editDialogOpen}
        onOpenChange={(open) => {
          setEditDialogOpen(open)
          if (!open) setEditingTicket(null)
        }}
        ticket={editingTicket}
        onUpdate={async () => {
          setEditingTicket(null)
          fetchTickets()
        }}
      />

      {/* Delete Confirmation Dialog */}
      <DeleteTicketDialog
        open={deleteDialogOpen}
        onOpenChange={(open) => {
          setDeleteDialogOpen(open)
          if (!open) setDeletingTicket(null)
        }}
        ticket={deletingTicket}
        onDelete={async () => {
          setDeletingTicket(null)
          setExpandedRowId(null)
          fetchTickets()
        }}
      />

      {/* Status Update Dialog */}
      <StatusUpdateDialog
        open={statusDialogOpen}
        onOpenChange={setStatusDialogOpen}
        ticket={statusTicket}
        onUpdate={async () => {
          setStatusTicket(null)
          fetchTickets()
        }}
      />

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
