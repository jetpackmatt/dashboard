"use client"

import * as React from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"
import { VisibilityState } from "@tanstack/react-table"
import {
  AlertCircleIcon,
  CalendarIcon,
  CheckCircle2Icon,
  CheckCircleIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ChevronsLeftIcon,
  ChevronsRightIcon,
  ClipboardIcon,
  ClockIcon,
  ColumnsIcon,
  DownloadIcon,
  FilterIcon,
  LoaderIcon,
  MoreVerticalIcon,
  PackageIcon,
  SearchIcon,
  TruckIcon,
  XIcon,
} from "lucide-react"
import { format } from "date-fns"
import { DateRange } from "react-day-picker"
import { toast } from "sonner"

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
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { useDebouncedCallback } from "use-debounce"
import { MultiSelectFilter, FilterOption } from "@/components/ui/multi-select-filter"
import { useDebouncedShipmentsFilters, useDebouncedUnfulfilledFilters } from "@/hooks/use-debounced-filters"
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
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs"
import { UnfulfilledTable } from "@/components/transactions/unfulfilled-table"
import { ShipmentsTable } from "@/components/transactions/shipments-table"
import { AdditionalServicesTable } from "@/components/transactions/additional-services-table"
import { ReturnsTable } from "@/components/transactions/returns-table"
import { ReceivingTable } from "@/components/transactions/receiving-table"
import { StorageTable } from "@/components/transactions/storage-table"
import { CreditsTable } from "@/components/transactions/credits-table"
import { JetpackLoader } from "@/components/jetpack-loader"
import {
  UNFULFILLED_TABLE_CONFIG,
  SHIPMENTS_TABLE_CONFIG,
  ADDITIONAL_SERVICES_TABLE_CONFIG,
  RETURNS_TABLE_CONFIG,
  RECEIVING_TABLE_CONFIG,
  STORAGE_TABLE_CONFIG,
  CREDITS_TABLE_CONFIG,
} from "@/lib/table-config"

// Cookie helpers for column visibility persistence
const COOKIE_PREFIX = 'jetpack_columns_'
const COOKIE_MAX_AGE = 365 * 24 * 60 * 60 // 1 year in seconds

function getColumnVisibilityFromCookie(tabName: string): VisibilityState | null {
  if (typeof document === 'undefined') return null

  const cookieName = `${COOKIE_PREFIX}${tabName}`
  const cookies = document.cookie.split(';')

  for (const cookie of cookies) {
    const [name, value] = cookie.trim().split('=')
    if (name === cookieName && value) {
      try {
        return JSON.parse(decodeURIComponent(value))
      } catch {
        return null
      }
    }
  }
  return null
}

function saveColumnVisibilityToCookie(tabName: string, visibility: VisibilityState) {
  if (typeof document === 'undefined') return

  const cookieName = `${COOKIE_PREFIX}${tabName}`
  const value = encodeURIComponent(JSON.stringify(visibility))
  document.cookie = `${cookieName}=${value}; max-age=${COOKIE_MAX_AGE}; path=/; SameSite=Lax`
}

function clearColumnVisibilityCookie(tabName: string) {
  if (typeof document === 'undefined') return

  const cookieName = `${COOKIE_PREFIX}${tabName}`
  document.cookie = `${cookieName}=; max-age=0; path=/; SameSite=Lax`
}
import { getCarrierDisplayName } from "@/components/transactions/cell-renderers"

// Normalize channel names for display (e.g., "Walmartv2" -> "Walmart", "Shopifyv3" -> "Shopify")
function normalizeChannelName(name: string): string {
  if (!name) return name
  // Remove version suffix (v1, v2, v3, etc.)
  return name.replace(/v\d+$/i, '')
}

// Date range preset types and constants
type DateRangePreset = 'today' | '1d' | '2d' | '3d' | '4d' | '7d' | '30d' | '60d' | 'mtd' | 'ytd' | 'all' | 'custom'

// Presets for Unfulfilled tab (short-term focus)
const UNFULFILLED_DATE_PRESETS: { value: DateRangePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: '1d', label: '1D' },
  { value: '2d', label: '2D' },
  { value: '3d', label: '3D' },
  { value: '4d', label: '4D' },
  { value: 'all', label: 'All' },
]

// Presets for Shipments and other tabs (longer-term focus)
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
    case '1d':
      const oneDayAgo = new Date(today)
      oneDayAgo.setDate(today.getDate() - 1)
      return { from: oneDayAgo, to: today }
    case '2d':
      const twoDaysAgo = new Date(today)
      twoDaysAgo.setDate(today.getDate() - 2)
      return { from: twoDaysAgo, to: today }
    case '3d':
      const threeDaysAgo = new Date(today)
      threeDaysAgo.setDate(today.getDate() - 3)
      return { from: threeDaysAgo, to: today }
    case '4d':
      const fourDaysAgo = new Date(today)
      fourDaysAgo.setDate(today.getDate() - 4)
      return { from: fourDaysAgo, to: today }
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

// Filter option constants - using FilterOption format for multi-select
const UNFULFILLED_STATUS_OPTIONS: FilterOption[] = [
  { value: 'Awaiting Pick', label: 'Awaiting Pick' },
  { value: 'Pick In-Progress', label: 'Pick In-Progress' },
  { value: 'Picked', label: 'Picked' },
  { value: 'Packed', label: 'Packed' },
  { value: 'Out of Stock', label: 'Out of Stock' },
  { value: 'On Hold', label: 'On Hold' },
  { value: 'Exception', label: 'Exception' },
]
const UNFULFILLED_AGE_OPTIONS: FilterOption[] = [
  { value: '0-1', label: '< 1 day' },
  { value: '1-2', label: '1-2 days' },
  { value: '2-3', label: '2-3 days' },
  { value: '3-5', label: '3-5 days' },
  { value: '5-7', label: '5-7 days' },
  { value: '7-10', label: '7-10 days' },
  { value: '10-15', label: '10-15 days' },
  { value: '15+', label: '15+ days' },
]
const TYPE_OPTIONS: FilterOption[] = [
  { value: 'DTC', label: 'DTC' },
  { value: 'B2B', label: 'B2B' },
  { value: 'FBA', label: 'FBA' },
  { value: 'Dropship', label: 'Dropship' },
]

const SHIPMENTS_STATUS_OPTIONS: FilterOption[] = [
  { value: 'Labelled', label: 'Labelled' },
  { value: 'Shipped', label: 'Shipped' },
  { value: 'Awaiting Carrier', label: 'Awaiting Carrier' },
  { value: 'In Transit', label: 'In Transit' },
  { value: 'Out for Delivery', label: 'Out for Delivery' },
  { value: 'Delivered', label: 'Delivered' },
  { value: 'Exception', label: 'Exception' },
]

const ADDITIONAL_SERVICES_TYPE_OPTIONS = ['Pick & Pack', 'Assembly', 'Kitting', 'Labeling', 'Inspection', 'Other']
const ADDITIONAL_SERVICES_STATUS_OPTIONS = ['Pending', 'Completed', 'Invoiced']

const RETURNS_STATUS_OPTIONS = ['Pending', 'Processing', 'Completed', 'Rejected']
const RETURNS_REASON_OPTIONS = ['Damaged', 'Wrong Item', 'Quality Issue', 'Customer Return', 'Other']

const RECEIVING_FEE_TYPE_OPTIONS = ['Standard', 'Oversize', 'Special Handling', 'Pallet']

const STORAGE_LOCATION_OPTIONS = ['Rack', 'Bin', 'Pallet', 'Floor']

const CREDITS_STATUS_OPTIONS = ['Pending', 'Approved', 'Applied', 'Denied']
const CREDITS_REASON_OPTIONS = ['Damaged Goods', 'Shipping Error', 'Billing Adjustment', 'Service Credit', 'Other']

export function DataTable({
  clientId,
  defaultPageSize = 30,
  showExport = false,
  // Pre-fetched unfulfilled data for instant tab switching
  unfulfilledData,
  unfulfilledTotalCount = 0,
  unfulfilledLoading = false,
  unfulfilledChannels = [],
  // Pre-fetched shipments data for instant tab switching
  shipmentsData: prefetchedShipmentsData,
  shipmentsTotalCount: prefetchedShipmentsTotalCount = 0,
  shipmentsLoading: prefetchedShipmentsLoading = false,
  shipmentsChannels: prefetchedShipmentsChannels = [],
  shipmentsCarriers: prefetchedShipmentsCarriers = [],
}: {
  clientId: string
  defaultPageSize?: number
  showExport?: boolean
  // Pre-fetched unfulfilled data for instant tab switching
  unfulfilledData?: any[]
  unfulfilledTotalCount?: number
  unfulfilledLoading?: boolean
  unfulfilledChannels?: string[]
  // Pre-fetched shipments data for instant tab switching
  shipmentsData?: any[]
  shipmentsTotalCount?: number
  shipmentsLoading?: boolean
  shipmentsChannels?: string[]
  shipmentsCarriers?: string[]
}) {
  // ============================================================================
  // SHIPMENTS TAB - Table State and Configuration
  // ============================================================================
  const [rowSelection, setRowSelection] = React.useState({})

  // Separate column visibility state for each main tab (persisted via cookies)
  // Initialize empty to avoid SSR hydration mismatch - cookies are loaded via useEffect
  const [shipmentsColumnVisibility, setShipmentsColumnVisibility] =
    React.useState<VisibilityState>({})
  const [unfulfilledColumnVisibility, setUnfulfilledColumnVisibility] =
    React.useState<VisibilityState>({})

  // Legacy columnVisibility for other tabs (not persisted)
  const [columnVisibility, setColumnVisibility] =
    React.useState<VisibilityState>({})
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: defaultPageSize,
  })
  const [exportSheetOpen, setExportSheetOpen] = React.useState(false)
  const [exportFormat, setExportFormat] = React.useState<string>("csv")
  const [filtersSheetOpen, setFiltersSheetOpen] = React.useState(false)
  const [filtersExpanded, setFiltersExpanded] = React.useState(false)
  const [searchExpanded, setSearchExpanded] = React.useState(false)

  // Tab state with URL persistence
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const validTabs = ["shipments", "unfulfilled", "additional-services", "returns", "receiving", "storage", "credits"]
  const tabFromUrl = searchParams.get("tab")
  const initialTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "shipments"
  const [currentTab, setCurrentTab] = React.useState(initialTab)

  // Sync tab to URL when it changes, with scroll position restoration
  const handleTabChange = React.useCallback((newTab: string) => {
    setCurrentTab(newTab)

    // Update URL
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", newTab)
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })

    // Get saved position from click handler, or save now if not available
    const scrollContainer = scrollContainerRef.current
    const savedPosition = scrollPositionRef.current || (scrollContainer ? scrollContainer.scrollTop : window.scrollY)
    scrollPositionRef.current = savedPosition

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
        immediateRestore()
      }

      frameCount++
      if (frameCount < maxFrames) {
        requestAnimationFrame(checkAndRestore)
      } else {
        scrollPositionRef.current = 0
      }
    }

    // Start RAF monitoring
    requestAnimationFrame(checkAndRestore)
  }, [searchParams, router, pathname])

  // Unfulfilled tab filter state (lifted from UnfulfilledTable for header integration)
  // Now using arrays for multi-select support
  const [unfulfilledStatusFilter, setUnfulfilledStatusFilter] = React.useState<string[]>([])
  const [unfulfilledAgeFilter, setUnfulfilledAgeFilter] = React.useState<string[]>([])
  const [unfulfilledTypeFilter, setUnfulfilledTypeFilter] = React.useState<string[]>([])
  const [unfulfilledChannelFilter, setUnfulfilledChannelFilter] = React.useState<string[]>([])
  const [unfulfilledDateRange, setUnfulfilledDateRange] = React.useState<DateRange | undefined>(undefined)
  const [availableChannels, setAvailableChannels] = React.useState<string[]>(unfulfilledChannels)
  const [isUnfulfilledLoading, setIsUnfulfilledLoading] = React.useState(unfulfilledLoading)

  // Sync channels when parent updates them (from pre-fetch)
  React.useEffect(() => {
    if (unfulfilledChannels.length > 0) {
      setAvailableChannels(unfulfilledChannels)
    }
  }, [unfulfilledChannels])

  // Sync loading state from parent
  React.useEffect(() => {
    setIsUnfulfilledLoading(unfulfilledLoading)
  }, [unfulfilledLoading])

  // Load column visibility from cookies on mount (client-side only, after hydration)
  const [hasMounted, setHasMounted] = React.useState(false)
  React.useEffect(() => {
    setHasMounted(true)
    const savedShipments = getColumnVisibilityFromCookie('shipments')
    const savedUnfulfilled = getColumnVisibilityFromCookie('unfulfilled')
    if (savedShipments) setShipmentsColumnVisibility(savedShipments)
    if (savedUnfulfilled) setUnfulfilledColumnVisibility(savedUnfulfilled)
  }, [])

  // Persist column visibility to cookies when changed (only after mount to avoid overwriting with empty state)
  React.useEffect(() => {
    if (!hasMounted) return
    // Only save if there are actual changes (not the initial empty state)
    if (Object.keys(shipmentsColumnVisibility).length > 0) {
      saveColumnVisibilityToCookie('shipments', shipmentsColumnVisibility)
    }
  }, [shipmentsColumnVisibility, hasMounted])

  React.useEffect(() => {
    if (!hasMounted) return
    if (Object.keys(unfulfilledColumnVisibility).length > 0) {
      saveColumnVisibilityToCookie('unfulfilled', unfulfilledColumnVisibility)
    }
  }, [unfulfilledColumnVisibility, hasMounted])

  // Reset column visibility to defaults (clears cookie and state)
  const resetShipmentsColumns = React.useCallback(() => {
    clearColumnVisibilityCookie('shipments')
    setShipmentsColumnVisibility({})
  }, [])

  const resetUnfulfilledColumns = React.useCallback(() => {
    clearColumnVisibilityCookie('unfulfilled')
    setUnfulfilledColumnVisibility({})
  }, [])

  // Shipments tab filter state - now using arrays for multi-select
  const [shipmentsStatusFilter, setShipmentsStatusFilter] = React.useState<string[]>([])
  const [shipmentsAgeFilter, setShipmentsAgeFilter] = React.useState<string[]>([])
  const [shipmentsTypeFilter, setShipmentsTypeFilter] = React.useState<string[]>([])
  const [shipmentsChannelFilter, setShipmentsChannelFilter] = React.useState<string[]>([])
  const [shipmentsCarrierFilter, setShipmentsCarrierFilter] = React.useState<string[]>([])
  // Initialize shipments date range to 60 days for better performance
  const [shipmentsDateRange, setShipmentsDateRange] = React.useState<DateRange | undefined>(() => {
    const range = getDateRangeFromPreset('60d')
    return range ? { from: range.from, to: range.to } : undefined
  })
  const [shipmentsDatePreset, setShipmentsDatePreset] = React.useState<DateRangePreset | undefined>('60d')
  const [shipmentsChannels, setShipmentsChannels] = React.useState<string[]>(prefetchedShipmentsChannels)
  const [shipmentsCarriers, setShipmentsCarriers] = React.useState<string[]>(prefetchedShipmentsCarriers)
  const [isShipmentsLoading, setIsShipmentsLoading] = React.useState(prefetchedShipmentsLoading)

  // Debounced shipments filters - UI updates immediately, API calls debounced
  const debouncedShipmentsFilters = useDebouncedShipmentsFilters({
    statusFilter: shipmentsStatusFilter,
    ageFilter: shipmentsAgeFilter,
    typeFilter: shipmentsTypeFilter,
    channelFilter: shipmentsChannelFilter,
    carrierFilter: shipmentsCarrierFilter,
    dateRange: shipmentsDateRange,
  })

  // Debounced unfulfilled filters
  const debouncedUnfulfilledFilters = useDebouncedUnfulfilledFilters({
    statusFilter: unfulfilledStatusFilter,
    ageFilter: unfulfilledAgeFilter,
    typeFilter: unfulfilledTypeFilter,
    channelFilter: unfulfilledChannelFilter,
    dateRange: unfulfilledDateRange,
  })

  // Search state - shared across tabs, debounced for performance
  const [searchInput, setSearchInput] = React.useState("")
  const [searchQuery, setSearchQuery] = React.useState("")

  // Debounced search - triggers API call 300ms after typing stops
  const debouncedSearch = useDebouncedCallback((value: string) => {
    setSearchQuery(value)
  }, 300)

  // Additional Services tab filter state
  const [additionalServicesTypeFilter, setAdditionalServicesTypeFilter] = React.useState<string>("all")
  const [additionalServicesStatusFilter, setAdditionalServicesStatusFilter] = React.useState<string>("all")
  const [additionalServicesDateRange, setAdditionalServicesDateRange] = React.useState<DateRange | undefined>(undefined)
  const [additionalServicesDatePreset, setAdditionalServicesDatePreset] = React.useState<DateRangePreset | undefined>('all')

  // Returns tab filter state
  const [returnsStatusFilter, setReturnsStatusFilter] = React.useState<string>("all")
  const [returnsReasonFilter, setReturnsReasonFilter] = React.useState<string>("all")
  const [returnsDateRange, setReturnsDateRange] = React.useState<DateRange | undefined>(undefined)
  const [returnsDatePreset, setReturnsDatePreset] = React.useState<DateRangePreset | undefined>('all')

  // Receiving tab filter state
  const [receivingFeeTypeFilter, setReceivingFeeTypeFilter] = React.useState<string>("all")
  const [receivingDateRange, setReceivingDateRange] = React.useState<DateRange | undefined>(undefined)
  const [receivingDatePreset, setReceivingDatePreset] = React.useState<DateRangePreset | undefined>('all')

  // Storage tab filter state
  const [storageLocationFilter, setStorageLocationFilter] = React.useState<string>("all")

  // Credits tab filter state
  const [creditsStatusFilter, setCreditsStatusFilter] = React.useState<string>("all")
  const [creditsReasonFilter, setCreditsReasonFilter] = React.useState<string>("all")
  const [creditsDateRange, setCreditsDateRange] = React.useState<DateRange | undefined>(undefined)
  const [creditsDatePreset, setCreditsDatePreset] = React.useState<DateRangePreset | undefined>('all')

  // Date preset state for unfulfilled filter
  const [unfulfilledDatePreset, setUnfulfilledDatePreset] = React.useState<DateRangePreset | undefined>('all')
  const [isCustomRangeOpen, setIsCustomRangeOpen] = React.useState(false)
  // Track if we're in the middle of selecting a range (waiting for end date)
  const [isAwaitingEndDate, setIsAwaitingEndDate] = React.useState(false)

  // Handle preset selection
  const handleDatePresetChange = (preset: DateRangePreset) => {
    setUnfulfilledDatePreset(preset)
    if (preset === 'custom') {
      // Custom will use the existing date range picker
      setIsCustomRangeOpen(true)
    } else {
      // Set date range from preset
      const range = getDateRangeFromPreset(preset)
      if (range) {
        setUnfulfilledDateRange({ from: range.from, to: range.to })
      }
      setIsCustomRangeOpen(false)
    }
  }

  // Handle custom range selection
  const handleCustomRangeSelect = (range: { from: Date | undefined; to: Date | undefined }) => {
    // If we're not awaiting end date, this is the first click - always start fresh
    if (!isAwaitingEndDate) {
      // First click - set just the from date, wait for end date
      const clickedDate = range.from || range.to
      if (clickedDate) {
        setUnfulfilledDateRange({ from: clickedDate, to: undefined })
        setIsAwaitingEndDate(true)
      }
      return
    }

    // We're awaiting end date - this is the second click
    if (range.from && range.to && range.from.getTime() !== range.to.getTime()) {
      // Complete range selected with different dates - close popover
      setUnfulfilledDateRange(range)
      setUnfulfilledDatePreset('custom')
      setIsCustomRangeOpen(false)
      setIsAwaitingEndDate(false)
    } else if (range.from && range.to) {
      // Same date clicked again (clicking on the already-selected from date)
      // Just update the range but don't close
      setUnfulfilledDateRange(range)
    } else {
      // Partial range update
      setUnfulfilledDateRange(range)
    }
  }

  // Format custom range display
  const customRangeLabel = React.useMemo(() => {
    if (unfulfilledDateRange?.from && unfulfilledDateRange?.to) {
      return `${format(unfulfilledDateRange.from, 'MMM d')} - ${format(unfulfilledDateRange.to, 'MMM d')}`
    }
    return 'Custom'
  }, [unfulfilledDateRange])

  // Check if unfulfilled filters are active and count them (now using arrays)
  // Note: Date range is NOT counted as a filter since it has its own indicator
  const hasUnfulfilledFilters = unfulfilledStatusFilter.length > 0 || unfulfilledAgeFilter.length > 0 ||
    unfulfilledTypeFilter.length > 0 || unfulfilledChannelFilter.length > 0

  // Count active filters for badge - count total selected values
  const activeFilterCount =
    unfulfilledStatusFilter.length +
    unfulfilledAgeFilter.length +
    unfulfilledTypeFilter.length +
    unfulfilledChannelFilter.length

  // Clear unfulfilled filters
  const clearUnfulfilledFilters = () => {
    setUnfulfilledStatusFilter([])
    setUnfulfilledAgeFilter([])
    setUnfulfilledTypeFilter([])
    setUnfulfilledChannelFilter([])
    setUnfulfilledDateRange(undefined)
    setUnfulfilledDatePreset(undefined)
    setIsCustomRangeOpen(false)
    setIsAwaitingEndDate(false)
  }

  // ============================================================================
  // COMPUTED VALUES FOR OTHER TABS
  // ============================================================================

  // Shipments tab computed values (now using arrays)
  // Note: Date range is NOT counted as a filter since it has its own indicator
  const hasShipmentsFilters = shipmentsStatusFilter.length > 0 || shipmentsAgeFilter.length > 0 ||
    shipmentsTypeFilter.length > 0 || shipmentsChannelFilter.length > 0 || shipmentsCarrierFilter.length > 0
  const shipmentsFilterCount =
    shipmentsStatusFilter.length +
    shipmentsAgeFilter.length +
    shipmentsTypeFilter.length +
    shipmentsChannelFilter.length +
    shipmentsCarrierFilter.length

  const clearShipmentsFilters = () => {
    setShipmentsStatusFilter([])
    setShipmentsAgeFilter([])
    setShipmentsTypeFilter([])
    setShipmentsChannelFilter([])
    setShipmentsCarrierFilter([])
    setShipmentsDateRange(undefined)
    setShipmentsDatePreset(undefined)
  }

  // Additional Services tab computed values
  const hasAdditionalServicesFilters = additionalServicesTypeFilter !== "all" || additionalServicesStatusFilter !== "all" || additionalServicesDateRange?.from
  const additionalServicesFilterCount = [
    additionalServicesTypeFilter !== "all",
    additionalServicesStatusFilter !== "all",
    additionalServicesDateRange?.from,
  ].filter(Boolean).length

  const clearAdditionalServicesFilters = () => {
    setAdditionalServicesTypeFilter("all")
    setAdditionalServicesStatusFilter("all")
    setAdditionalServicesDateRange(undefined)
    setAdditionalServicesDatePreset(undefined)
  }

  // Returns tab computed values
  const hasReturnsFilters = returnsStatusFilter !== "all" || returnsReasonFilter !== "all" || returnsDateRange?.from
  const returnsFilterCount = [
    returnsStatusFilter !== "all",
    returnsReasonFilter !== "all",
    returnsDateRange?.from,
  ].filter(Boolean).length

  const clearReturnsFilters = () => {
    setReturnsStatusFilter("all")
    setReturnsReasonFilter("all")
    setReturnsDateRange(undefined)
    setReturnsDatePreset(undefined)
  }

  // Receiving tab computed values
  const hasReceivingFilters = receivingFeeTypeFilter !== "all" || receivingDateRange?.from
  const receivingFilterCount = [
    receivingFeeTypeFilter !== "all",
    receivingDateRange?.from,
  ].filter(Boolean).length

  const clearReceivingFilters = () => {
    setReceivingFeeTypeFilter("all")
    setReceivingDateRange(undefined)
    setReceivingDatePreset(undefined)
  }

  // Storage tab computed values
  const hasStorageFilters = storageLocationFilter !== "all"
  const storageFilterCount = storageLocationFilter !== "all" ? 1 : 0

  const clearStorageFilters = () => {
    setStorageLocationFilter("all")
  }

  // Credits tab computed values
  const hasCreditsFilters = creditsStatusFilter !== "all" || creditsReasonFilter !== "all" || creditsDateRange?.from
  const creditsFilterCount = [
    creditsStatusFilter !== "all",
    creditsReasonFilter !== "all",
    creditsDateRange?.from,
  ].filter(Boolean).length

  const clearCreditsFilters = () => {
    setCreditsStatusFilter("all")
    setCreditsReasonFilter("all")
    setCreditsDateRange(undefined)
    setCreditsDatePreset(undefined)
  }

  // ============================================================================
  // GET CURRENT TAB FILTER STATE (for header)
  // ============================================================================
  const getCurrentTabFilters = () => {
    switch (currentTab) {
      case "unfulfilled":
        return { hasFilters: hasUnfulfilledFilters, filterCount: activeFilterCount, clear: clearUnfulfilledFilters }
      case "shipments":
        return { hasFilters: hasShipmentsFilters, filterCount: shipmentsFilterCount, clear: clearShipmentsFilters }
      case "additional-services":
        return { hasFilters: hasAdditionalServicesFilters, filterCount: additionalServicesFilterCount, clear: clearAdditionalServicesFilters }
      case "returns":
        return { hasFilters: hasReturnsFilters, filterCount: returnsFilterCount, clear: clearReturnsFilters }
      case "receiving":
        return { hasFilters: hasReceivingFilters, filterCount: receivingFilterCount, clear: clearReceivingFilters }
      case "storage":
        return { hasFilters: hasStorageFilters, filterCount: storageFilterCount, clear: clearStorageFilters }
      case "credits":
        return { hasFilters: hasCreditsFilters, filterCount: creditsFilterCount, clear: clearCreditsFilters }
      default:
        return { hasFilters: false, filterCount: 0, clear: () => {} }
    }
  }

  const currentTabFilters = getCurrentTabFilters()

  // Get current tab's date range state
  const getCurrentTabDateRange = () => {
    switch (currentTab) {
      case "unfulfilled": return { dateRange: unfulfilledDateRange, preset: unfulfilledDatePreset, setPreset: setUnfulfilledDatePreset, setDateRange: setUnfulfilledDateRange }
      case "shipments": return { dateRange: shipmentsDateRange, preset: shipmentsDatePreset, setPreset: setShipmentsDatePreset, setDateRange: setShipmentsDateRange }
      case "additional-services": return { dateRange: additionalServicesDateRange, preset: additionalServicesDatePreset, setPreset: setAdditionalServicesDatePreset, setDateRange: setAdditionalServicesDateRange }
      case "returns": return { dateRange: returnsDateRange, preset: returnsDatePreset, setPreset: setReturnsDatePreset, setDateRange: setReturnsDateRange }
      case "receiving": return { dateRange: receivingDateRange, preset: receivingDatePreset, setPreset: setReceivingDatePreset, setDateRange: setReceivingDateRange }
      case "credits": return { dateRange: creditsDateRange, preset: creditsDatePreset, setPreset: setCreditsDatePreset, setDateRange: setCreditsDateRange }
      default: return { dateRange: undefined, preset: undefined, setPreset: () => {}, setDateRange: () => {} }
    }
  }

  const currentTabDateState = getCurrentTabDateRange()

  // Generic date preset change handler
  const handleGenericDatePresetChange = (preset: DateRangePreset) => {
    const { setPreset, setDateRange } = currentTabDateState
    setPreset(preset)
    if (preset === 'custom') {
      setIsCustomRangeOpen(true)
    } else if (preset === 'all') {
      // Clear the date range when "All" is selected
      setDateRange(undefined)
      setIsCustomRangeOpen(false)
    } else {
      const range = getDateRangeFromPreset(preset)
      if (range) {
        setDateRange({ from: range.from, to: range.to })
      }
      setIsCustomRangeOpen(false)
    }
  }

  // Generic custom range select handler
  const handleGenericCustomRangeSelect = (range: { from: Date | undefined; to: Date | undefined }) => {
    const { setPreset, setDateRange } = currentTabDateState
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
      setPreset('custom')
      setIsCustomRangeOpen(false)
      setIsAwaitingEndDate(false)
    } else if (range.from && range.to) {
      setDateRange(range)
    } else {
      setDateRange(range)
    }
  }

  // Format custom range display for current tab
  const currentCustomRangeLabel = React.useMemo(() => {
    const { dateRange } = currentTabDateState
    if (dateRange?.from && dateRange?.to) {
      return `${format(dateRange.from, 'MMM d')} - ${format(dateRange.to, 'MMM d')}`
    }
    return 'Custom'
  }, [currentTabDateState])

  // Get current table config for columns dropdown
  const currentTableConfig = React.useMemo(() => {
    switch (currentTab) {
      case "unfulfilled": return UNFULFILLED_TABLE_CONFIG
      case "shipments": return SHIPMENTS_TABLE_CONFIG
      case "additional-services": return ADDITIONAL_SERVICES_TABLE_CONFIG
      case "returns": return RETURNS_TABLE_CONFIG
      case "receiving": return RECEIVING_TABLE_CONFIG
      case "storage": return STORAGE_TABLE_CONFIG
      case "credits": return CREDITS_TABLE_CONFIG
      default: return null
    }
  }, [currentTab])

  // Get current column visibility state and setter based on tab
  const currentColumnVisibility = React.useMemo(() => {
    switch (currentTab) {
      case "unfulfilled": return unfulfilledColumnVisibility
      case "shipments": return shipmentsColumnVisibility
      default: return columnVisibility
    }
  }, [currentTab, unfulfilledColumnVisibility, shipmentsColumnVisibility, columnVisibility])

  const setCurrentColumnVisibility = React.useCallback((update: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => {
    switch (currentTab) {
      case "unfulfilled":
        if (typeof update === 'function') {
          setUnfulfilledColumnVisibility(update)
        } else {
          setUnfulfilledColumnVisibility(update)
        }
        break
      case "shipments":
        if (typeof update === 'function') {
          setShipmentsColumnVisibility(update)
        } else {
          setShipmentsColumnVisibility(update)
        }
        break
      default:
        if (typeof update === 'function') {
          setColumnVisibility(update)
        } else {
          setColumnVisibility(update)
        }
    }
  }, [currentTab])

  const resetCurrentColumns = React.useCallback(() => {
    switch (currentTab) {
      case "unfulfilled": resetUnfulfilledColumns(); break
      case "shipments": resetShipmentsColumns(); break
      default: setColumnVisibility({})
    }
  }, [currentTab, resetUnfulfilledColumns, resetShipmentsColumns])

  // Check if current column visibility has any customizations
  const hasColumnCustomizations = React.useMemo(() => {
    return Object.keys(currentColumnVisibility).length > 0
  }, [currentColumnVisibility])

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

  return (
    <>
    <Tabs
      value={currentTab}
      className="flex w-full flex-col h-[calc(100vh-64px)] px-4 lg:px-6"
      onValueChange={handleTabChange}
    >
        {/* Sticky header with tabs and controls */}
        <div className="sticky top-0 z-20 -mx-4 lg:-mx-6 bg-muted/30 dark:bg-black/20">
          {/* Row 1: Tabs - edge-to-edge with subtle background */}
          <div className="">
            {/* Mobile/Tablet: Table selector dropdown */}
            <div className="lg:hidden px-4 py-3">
              <Select value={currentTab} onValueChange={handleTabChange}>
                <SelectTrigger className="w-[180px]">
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
            </div>

            {/* Desktop: Full-width tabs - edge-to-edge, squared */}
            <TabsList className="hidden lg:grid w-full grid-cols-7 h-auto p-0 bg-transparent px-4 lg:px-6">
              <TabsTrigger value="unfulfilled" className="text-xs sm:text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-3">Unfulfilled</TabsTrigger>
              <TabsTrigger value="shipments" className="text-xs sm:text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-3">Shipments</TabsTrigger>
              <TabsTrigger value="additional-services" className="text-xs sm:text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-3">Additional Services</TabsTrigger>
              <TabsTrigger value="returns" className="text-xs sm:text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-3">Returns</TabsTrigger>
              <TabsTrigger value="receiving" className="text-xs sm:text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-3">Receiving</TabsTrigger>
              <TabsTrigger value="storage" className="text-xs sm:text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-3">Storage</TabsTrigger>
              <TabsTrigger value="credits" className="text-xs sm:text-sm rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none py-3">Credits</TabsTrigger>
            </TabsList>
          </div>

          {/* Row 2: Search + Date Range (left) | Filters button + Export + Columns (right) */}
          <div className="px-4 lg:px-6 py-6 flex items-center justify-between gap-4">
            {/* LEFT SIDE: Search + Date Range (date range hidden on small screens) */}
            <div className="flex items-center gap-3">
              <div className="relative w-48 2xl:w-64">
                <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  placeholder="Search..."
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

              {/* Date Range Presets - visible on xl screens, hidden on smaller (not for storage tab) */}
              {currentTab !== "storage" && (
                <div className="hidden xl:inline-flex rounded-md border border-border overflow-hidden">
                  {(currentTab === "unfulfilled" ? UNFULFILLED_DATE_PRESETS : DATE_RANGE_PRESETS).map((option) => (
                    <button
                      key={option.value}
                      onClick={() => handleGenericDatePresetChange(option.value)}
                      className={cn(
                        "px-2.5 py-1 text-sm font-medium transition-all border-r border-border last:border-r-0",
                        currentTabDateState.preset === option.value
                          ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                          : "bg-background text-muted-foreground hover:bg-emerald-50/50 hover:text-emerald-800 dark:hover:bg-emerald-950/20 dark:hover:text-emerald-200"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                  <Popover
                    open={isCustomRangeOpen}
                    onOpenChange={(open) => {
                      if (open) {
                        setIsCustomRangeOpen(true)
                        // Reset selection state when opening - always start fresh
                        setIsAwaitingEndDate(false)
                      }
                    }}
                    modal={false}
                  >
                    <PopoverTrigger asChild>
                      <button
                        className={cn(
                          "px-2.5 py-1 text-sm font-medium transition-all",
                          currentTabDateState.preset === 'custom'
                            ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                            : "bg-background text-muted-foreground hover:bg-emerald-50/50 hover:text-emerald-800 dark:hover:bg-emerald-950/20 dark:hover:text-emerald-200"
                        )}
                      >
                        {currentTabDateState.preset === 'custom' ? currentCustomRangeLabel : 'Custom'}
                      </button>
                    </PopoverTrigger>
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
                        {(currentTabDateState.dateRange?.from || currentTabDateState.dateRange?.to) && (
                          <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                            <div className="flex-1 text-xs">
                              <span className="text-muted-foreground">From: </span>
                              <span className="font-medium">
                                {currentTabDateState.dateRange?.from ? format(currentTabDateState.dateRange.from, 'MMM d, yyyy') : '—'}
                              </span>
                            </div>
                            <div className="flex-1 text-xs">
                              <span className="text-muted-foreground">To: </span>
                              <span className="font-medium">
                                {currentTabDateState.dateRange?.to ? format(currentTabDateState.dateRange.to, 'MMM d, yyyy') : '—'}
                              </span>
                            </div>
                            <button
                              onClick={() => {
                                currentTabDateState.setDateRange(undefined)
                                currentTabDateState.setPreset(undefined)
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
                            from: currentTabDateState.dateRange?.from,
                            to: currentTabDateState.dateRange?.to,
                          }}
                          onSelect={(range) => handleGenericCustomRangeSelect({ from: range?.from, to: range?.to })}
                          numberOfMonths={2}
                        />
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              {/* Jetpack Loading Indicator - shows when data is loading */}
              {((currentTab === "unfulfilled" && isUnfulfilledLoading) || (currentTab === "shipments" && isShipmentsLoading)) && (
                <div className="flex items-center gap-1.5">
                  <JetpackLoader size="md" />
                  <span className="text-xs text-muted-foreground">Loading</span>
                </div>
              )}
            </div>

            {/* RIGHT SIDE: Filters toggle + Export + Columns */}
            <div className="flex items-center gap-2">
              {/* Filters button with badge - for all tabs */}
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
                {currentTabFilters.hasFilters && (
                  <span className="inline-flex items-center justify-center h-5 min-w-[20px] px-1 text-xs font-medium rounded-full bg-muted text-muted-foreground">
                    {currentTabFilters.filterCount}
                  </span>
                )}
                {filtersExpanded ? (
                  <ChevronUpIcon className="h-3.5 w-3.5 ml-0.5" />
                ) : (
                  <ChevronDownIcon className="h-3.5 w-3.5 ml-0.5" />
                )}
              </Button>

              {/* Export */}
              {showExport && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setExportSheetOpen(true)}
                  className="h-[30px] flex-shrink-0 text-muted-foreground"
                >
                  <DownloadIcon className="h-4 w-4" />
                  <span className="ml-2 hidden lg:inline">Export</span>
                </Button>
              )}

              {/* Columns - show for shipments and unfulfilled tabs */}
              {(currentTab === "shipments" || currentTab === "unfulfilled") && currentTableConfig && (() => {
                // Maximum columns allowed to prevent horizontal scrolling
                const MAX_VISIBLE_COLUMNS = 12

                // Count currently enabled columns
                const enabledColumnCount = currentTableConfig.columns.filter(
                  col => currentColumnVisibility[col.id] ?? col.defaultVisible !== false
                ).length

                const isAtLimit = enabledColumnCount >= MAX_VISIBLE_COLUMNS

                return (
                  <div className="flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-[30px] flex-shrink-0 items-center text-muted-foreground">
                          <ColumnsIcon className="h-4 w-4" />
                          <span className="ml-[3px] text-xs hidden lg:inline leading-none">
                            ({enabledColumnCount}/{MAX_VISIBLE_COLUMNS})
                          </span>
                          <ChevronDownIcon className="h-4 w-4 lg:ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        {/* Column limit message with Reset link */}
                        <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-1 flex items-center justify-between">
                          <span>
                            {enabledColumnCount} of {MAX_VISIBLE_COLUMNS} columns
                            {isAtLimit && <span className="text-amber-600 dark:text-amber-400 ml-1">(max)</span>}
                          </span>
                          {hasColumnCustomizations && (
                            <button
                              onClick={resetCurrentColumns}
                              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                        {currentTableConfig.columns.map((column) => {
                          const isChecked = currentColumnVisibility[column.id] ?? column.defaultVisible !== false
                          // Disable unchecked columns if at limit
                          const isDisabled = !isChecked && isAtLimit

                          return (
                            <DropdownMenuCheckboxItem
                              key={column.id}
                              className={cn("capitalize", isDisabled && "opacity-50 cursor-not-allowed")}
                              checked={isChecked}
                              disabled={isDisabled}
                              onCheckedChange={(value) =>
                                setCurrentColumnVisibility((prev) => ({
                                  ...prev,
                                  [column.id]: !!value,
                                }))
                              }
                            >
                              {column.header}
                            </DropdownMenuCheckboxItem>
                          )
                        })}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )
              })()}
            </div>
          </div>

          {/* Row 3: Expandable Filter Bar (for all tabs) */}
          {filtersExpanded && (
            <div className="px-4 lg:px-6 pt-0 pb-6 flex items-center justify-between xl:justify-end gap-4 animate-in slide-in-from-top-2 duration-200">
              {/* LEFT SIDE: Date Range Presets - only visible on small screens (hidden on xl where it shows in Row 2) */}
              {currentTab !== "storage" && (
                <div className="flex xl:hidden items-center gap-3">
                  <div className="inline-flex rounded-md border border-border overflow-hidden">
                    {(currentTab === "unfulfilled" ? UNFULFILLED_DATE_PRESETS : DATE_RANGE_PRESETS).map((option) => (
                      <button
                        key={option.value}
                        onClick={() => handleGenericDatePresetChange(option.value)}
                        className={cn(
                          "px-2.5 py-1 text-sm font-medium transition-all border-r border-border last:border-r-0",
                          currentTabDateState.preset === option.value
                            ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                            : "bg-background text-muted-foreground hover:bg-emerald-50/50 hover:text-emerald-800 dark:hover:bg-emerald-950/20 dark:hover:text-emerald-200"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                    <Popover
                      open={isCustomRangeOpen}
                      onOpenChange={(open) => {
                        if (open) {
                          setIsCustomRangeOpen(true)
                          setIsAwaitingEndDate(false)
                        }
                      }}
                      modal={false}
                    >
                      <PopoverTrigger asChild>
                        <button
                          className={cn(
                            "px-2.5 py-1 text-sm font-medium transition-all",
                            currentTabDateState.preset === 'custom'
                              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                              : "bg-background text-muted-foreground hover:bg-emerald-50/50 hover:text-emerald-800 dark:hover:bg-emerald-950/20 dark:hover:text-emerald-200"
                          )}
                        >
                          {currentTabDateState.preset === 'custom' ? currentCustomRangeLabel : 'Custom'}
                        </button>
                      </PopoverTrigger>
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
                          {(currentTabDateState.dateRange?.from || currentTabDateState.dateRange?.to) && (
                            <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                              <div className="flex-1 text-xs">
                                <span className="text-muted-foreground">From: </span>
                                <span className="font-medium">
                                  {currentTabDateState.dateRange?.from ? format(currentTabDateState.dateRange.from, 'MMM d, yyyy') : '—'}
                                </span>
                              </div>
                              <div className="flex-1 text-xs">
                                <span className="text-muted-foreground">To: </span>
                                <span className="font-medium">
                                  {currentTabDateState.dateRange?.to ? format(currentTabDateState.dateRange.to, 'MMM d, yyyy') : '—'}
                                </span>
                              </div>
                              <button
                                onClick={() => {
                                  currentTabDateState.setDateRange(undefined)
                                  currentTabDateState.setPreset(undefined)
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
                              from: currentTabDateState.dateRange?.from,
                              to: currentTabDateState.dateRange?.to,
                            }}
                            onSelect={(range) => handleGenericCustomRangeSelect({ from: range?.from, to: range?.to })}
                            numberOfMonths={2}
                          />
                        </div>
                      </PopoverContent>
                    </Popover>
                  </div>
                </div>
              )}

              {/* Clear + Filter Dropdowns - right-aligned (ml-auto pushes to right on xl when date range is hidden) */}
              <div className="flex items-center gap-2">
                {/* Clear Filters - show first, only when filters are active */}
                {currentTabFilters.hasFilters && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={currentTabFilters.clear}
                    className="h-[30px] px-2 gap-1 text-muted-foreground hover:text-foreground"
                  >
                    <XIcon className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Clear</span>
                  </Button>
                )}

                {/* UNFULFILLED TAB FILTERS - Multi-select dropdowns */}
                {currentTab === "unfulfilled" && (
                  <>
                    <MultiSelectFilter
                      options={UNFULFILLED_STATUS_OPTIONS}
                      selected={unfulfilledStatusFilter}
                      onSelectionChange={setUnfulfilledStatusFilter}
                      placeholder="Status"
                      className="w-[130px]"
                    />
                    <MultiSelectFilter
                      options={UNFULFILLED_AGE_OPTIONS}
                      selected={unfulfilledAgeFilter}
                      onSelectionChange={setUnfulfilledAgeFilter}
                      placeholder="Age"
                      className="w-[110px]"
                    />
                    <MultiSelectFilter
                      options={TYPE_OPTIONS}
                      selected={unfulfilledTypeFilter}
                      onSelectionChange={setUnfulfilledTypeFilter}
                      placeholder="Type"
                      className="w-[100px]"
                    />
                    <MultiSelectFilter
                      options={availableChannels.map(c => ({ value: c, label: normalizeChannelName(c) }))}
                      selected={unfulfilledChannelFilter}
                      onSelectionChange={setUnfulfilledChannelFilter}
                      placeholder="Channel"
                      className="w-[130px]"
                    />
                  </>
                )}

                {/* SHIPMENTS TAB FILTERS - Multi-select dropdowns matching Unfulfilled tab */}
                {currentTab === "shipments" && (
                  <>
                    <MultiSelectFilter
                      options={SHIPMENTS_STATUS_OPTIONS}
                      selected={shipmentsStatusFilter}
                      onSelectionChange={setShipmentsStatusFilter}
                      placeholder="Status"
                      className="w-[130px]"
                    />
                    <MultiSelectFilter
                      options={UNFULFILLED_AGE_OPTIONS}
                      selected={shipmentsAgeFilter}
                      onSelectionChange={setShipmentsAgeFilter}
                      placeholder="Age"
                      className="w-[110px]"
                    />
                    <MultiSelectFilter
                      options={TYPE_OPTIONS}
                      selected={shipmentsTypeFilter}
                      onSelectionChange={setShipmentsTypeFilter}
                      placeholder="Type"
                      className="w-[100px]"
                    />
                    <MultiSelectFilter
                      options={shipmentsChannels.map(c => ({ value: c, label: normalizeChannelName(c) }))}
                      selected={shipmentsChannelFilter}
                      onSelectionChange={setShipmentsChannelFilter}
                      placeholder="Channel"
                      className="w-[130px]"
                    />
                    <MultiSelectFilter
                      options={shipmentsCarriers.map(c => ({ value: c, label: getCarrierDisplayName(c) }))}
                      selected={shipmentsCarrierFilter}
                      onSelectionChange={setShipmentsCarrierFilter}
                      placeholder="Carrier"
                      className="w-[130px]"
                    />
                  </>
                )}

                {/* ADDITIONAL SERVICES TAB FILTERS */}
                {currentTab === "additional-services" && (
                  <>
                    <Select value={additionalServicesTypeFilter} onValueChange={setAdditionalServicesTypeFilter}>
                      <SelectTrigger className="h-[30px] w-[140px] text-sm">
                        <SelectValue placeholder="Service Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        {ADDITIONAL_SERVICES_TYPE_OPTIONS.map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={additionalServicesStatusFilter} onValueChange={setAdditionalServicesStatusFilter}>
                      <SelectTrigger className="h-[30px] w-[130px] text-sm">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        {ADDITIONAL_SERVICES_STATUS_OPTIONS.map((status) => (
                          <SelectItem key={status} value={status}>{status}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}

                {/* RETURNS TAB FILTERS */}
                {currentTab === "returns" && (
                  <>
                    <Select value={returnsStatusFilter} onValueChange={setReturnsStatusFilter}>
                      <SelectTrigger className="h-[30px] w-[130px] text-sm">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        {RETURNS_STATUS_OPTIONS.map((status) => (
                          <SelectItem key={status} value={status}>{status}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={returnsReasonFilter} onValueChange={setReturnsReasonFilter}>
                      <SelectTrigger className="h-[30px] w-[150px] text-sm">
                        <SelectValue placeholder="Reason" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All reasons</SelectItem>
                        {RETURNS_REASON_OPTIONS.map((reason) => (
                          <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}

                {/* RECEIVING TAB FILTERS */}
                {currentTab === "receiving" && (
                  <Select value={receivingFeeTypeFilter} onValueChange={setReceivingFeeTypeFilter}>
                    <SelectTrigger className="h-[30px] w-[160px] text-sm">
                      <SelectValue placeholder="Fee Type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All fee types</SelectItem>
                      {RECEIVING_FEE_TYPE_OPTIONS.map((type) => (
                        <SelectItem key={type} value={type}>{type}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* STORAGE TAB FILTERS */}
                {currentTab === "storage" && (
                  <Select value={storageLocationFilter} onValueChange={setStorageLocationFilter}>
                    <SelectTrigger className="h-[30px] w-[140px] text-sm">
                      <SelectValue placeholder="Location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All locations</SelectItem>
                      {STORAGE_LOCATION_OPTIONS.map((loc) => (
                        <SelectItem key={loc} value={loc}>{loc}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* CREDITS TAB FILTERS */}
                {currentTab === "credits" && (
                  <>
                    <Select value={creditsStatusFilter} onValueChange={setCreditsStatusFilter}>
                      <SelectTrigger className="h-[30px] w-[120px] text-sm">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        {CREDITS_STATUS_OPTIONS.map((status) => (
                          <SelectItem key={status} value={status}>{status}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={creditsReasonFilter} onValueChange={setCreditsReasonFilter}>
                      <SelectTrigger className="h-[30px] w-[140px] text-sm">
                        <SelectValue placeholder="Reason" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All reasons</SelectItem>
                        {CREDITS_REASON_OPTIONS.map((reason) => (
                          <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      {/* ============================================================================ */}
      {/* UNFULFILLED TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="unfulfilled"
        className="relative flex flex-col flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
      >
        {clientId && (
          <UnfulfilledTable
            clientId={clientId}
            statusFilter={debouncedUnfulfilledFilters.statusFilter}
            ageFilter={debouncedUnfulfilledFilters.ageFilter}
            typeFilter={debouncedUnfulfilledFilters.typeFilter}
            channelFilter={debouncedUnfulfilledFilters.channelFilter}
            dateRange={debouncedUnfulfilledFilters.dateRange}
            searchQuery={searchQuery}
            onChannelsChange={setAvailableChannels}
            onLoadingChange={setIsUnfulfilledLoading}
            userColumnVisibility={unfulfilledColumnVisibility}
            // Pre-fetched data for instant initial render
            initialData={unfulfilledData}
            initialTotalCount={unfulfilledTotalCount}
          />
        )}
      </TabsContent>
      {/* ============================================================================ */}
      {/* SHIPMENTS TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="shipments"
        className="relative flex flex-col flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
      >
        {clientId && (
          <ShipmentsTable
            clientId={clientId}
            userColumnVisibility={shipmentsColumnVisibility}
            statusFilter={debouncedShipmentsFilters.statusFilter}
            ageFilter={debouncedShipmentsFilters.ageFilter}
            typeFilter={debouncedShipmentsFilters.typeFilter}
            channelFilter={debouncedShipmentsFilters.channelFilter}
            carrierFilter={debouncedShipmentsFilters.carrierFilter}
            dateRange={debouncedShipmentsFilters.dateRange}
            searchQuery={searchQuery}
            onChannelsChange={setShipmentsChannels}
            onCarriersChange={setShipmentsCarriers}
            onLoadingChange={setIsShipmentsLoading}
            // Pre-fetched data for instant initial render
            initialData={prefetchedShipmentsData}
            initialTotalCount={prefetchedShipmentsTotalCount}
          />
        )}
      </TabsContent>
      {/* ============================================================================ */}
      {/* ADDITIONAL SERVICES TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="additional-services"
        className="relative flex flex-col flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
      >
        <AdditionalServicesTable
          clientId={clientId}
          dateRange={additionalServicesDateRange}
          userColumnVisibility={columnVisibility}
        />
      </TabsContent>
      {/* ============================================================================ */}
      {/* RETURNS TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="returns"
        className="relative flex flex-col flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
      >
        <ReturnsTable
          clientId={clientId}
          dateRange={returnsDateRange}
          userColumnVisibility={columnVisibility}
        />
      </TabsContent>
      {/* ============================================================================ */}
      {/* RECEIVING TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="receiving"
        className="relative flex flex-col flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
      >
        <ReceivingTable
          clientId={clientId}
          dateRange={receivingDateRange}
          userColumnVisibility={columnVisibility}
        />
      </TabsContent>
      {/* ============================================================================ */}
      {/* STORAGE TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="storage"
        className="relative flex flex-col flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
      >
        <StorageTable
          clientId={clientId}
          userColumnVisibility={columnVisibility}
        />
      </TabsContent>
      {/* ============================================================================ */}
      {/* CREDITS TAB */}
      {/* ============================================================================ */}
      <TabsContent
        value="credits"
        className="relative flex flex-col flex-1 min-h-0 mt-0 data-[state=inactive]:hidden"
      >
        <CreditsTable
          clientId={clientId}
          dateRange={creditsDateRange}
          userColumnVisibility={columnVisibility}
        />
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


