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
import { InlineDateRangePicker } from "@/components/ui/inline-date-range-picker"
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
import { useTablePreferences } from "@/hooks/use-table-preferences"
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

// Table preferences are now managed via useTablePreferences hook (localStorage)
import { getCarrierDisplayName, getFeeTypeDisplayName } from "@/components/transactions/cell-renderers"
import { ExportFormat, ExportScope } from "@/lib/export"

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
      // Return range from system start date (Jan 1, 2020) to today
      const systemStartDate = new Date(2020, 0, 1) // Jan 1, 2020
      return { from: systemStartDate, to: today }
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
  { value: 'Awaiting Carrier', label: 'Awaiting Carrier' },
  { value: 'In Transit', label: 'In Transit' },
  { value: 'Out for Delivery', label: 'Out for Delivery' },
  { value: 'Delivered', label: 'Delivered' },
  { value: 'Exception', label: 'Exception' },
  { value: 'At Risk', label: 'At Risk' },
  { value: 'File a Claim', label: 'File a Claim' },
]

// Fee types are now loaded dynamically from the API
// Status options are inline: pending, invoiced

// Dynamic filter options are loaded from APIs below

export function DataTable({
  clientId,
  defaultPageSize = 30,
  showExport = false,
  // Controlled tab state (optional - for header integration)
  currentTab: controlledTab,
  onTabChange: controlledOnTabChange,
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
  // Pre-fetched Additional Services data for instant tab switching
  additionalServicesData: prefetchedAdditionalServicesData,
  additionalServicesTotalCount: prefetchedAdditionalServicesTotalCount = 0,
  additionalServicesLoading: prefetchedAdditionalServicesLoading = false,
  additionalServicesFeeTypes: prefetchedAdditionalServicesFeeTypes = [],
  // Pre-fetched Returns data for instant tab switching
  returnsData: prefetchedReturnsData,
  returnsTotalCount: prefetchedReturnsTotalCount = 0,
  returnsLoading: prefetchedReturnsLoading = false,
}: {
  clientId: string | null  // null = let API determine from user's assigned clients
  defaultPageSize?: number
  showExport?: boolean
  // Controlled tab state (optional - for header integration)
  currentTab?: string
  onTabChange?: (tab: string) => void
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
  // Pre-fetched Additional Services data for instant tab switching
  additionalServicesData?: any[]
  additionalServicesTotalCount?: number
  additionalServicesLoading?: boolean
  additionalServicesFeeTypes?: string[]
  // Pre-fetched Returns data for instant tab switching
  returnsData?: any[]
  returnsTotalCount?: number
  returnsLoading?: boolean
}) {
  // Helper to build URL with optional clientId (omits null values)
  const buildApiUrl = (base: string, params: Record<string, string | number | null | undefined>) => {
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        searchParams.set(key, String(value))
      }
    }
    const queryString = searchParams.toString()
    return queryString ? `${base}?${queryString}` : base
  }

  // ============================================================================
  // SHIPMENTS TAB - Table State and Configuration
  // ============================================================================
  const [rowSelection, setRowSelection] = React.useState({})

  // Table preferences with localStorage persistence for all tabs
  const shipmentsPrefs = useTablePreferences('shipments', 50)
  const unfulfilledPrefs = useTablePreferences('unfulfilled', 50)
  const additionalServicesPrefs = useTablePreferences('additional-services', 50)
  const returnsPrefs = useTablePreferences('returns', 50)
  const receivingPrefs = useTablePreferences('receiving', 50)
  const storagePrefs = useTablePreferences('storage', 50)
  const creditsPrefs = useTablePreferences('credits', 50)
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: defaultPageSize,
  })
  const [exportSheetOpen, setExportSheetOpen] = React.useState(false)
  const [exportFormat, setExportFormat] = React.useState<'csv' | 'xlsx'>('csv')
  const [exportScope, setExportScope] = React.useState<'current' | 'all'>('current')
  const [isExporting, setIsExporting] = React.useState(false)
  // Export trigger ref - set by active table component
  const exportTriggerRef = React.useRef<((options: { format: ExportFormat; scope: ExportScope }) => void) | null>(null)
  const [filtersSheetOpen, setFiltersSheetOpen] = React.useState(false)
  const [filtersExpanded, setFiltersExpanded] = React.useState(false)
  const [searchExpanded, setSearchExpanded] = React.useState(false)

  // Tab state with URL persistence (supports controlled mode via props)
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()
  const validTabs = ["shipments", "unfulfilled", "additional-services", "returns", "receiving", "storage", "credits"]
  const tabFromUrl = searchParams.get("tab")
  const initialTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "shipments"
  const [internalTab, setInternalTab] = React.useState(initialTab)

  // Use controlled tab if provided, otherwise use internal state
  const currentTab = controlledTab ?? internalTab
  const isControlled = controlledTab !== undefined

  // Sync tab state when URL tab param changes (e.g., from external navigation)
  React.useEffect(() => {
    const urlTab = searchParams.get('tab')
    if (urlTab && validTabs.includes(urlTab) && urlTab !== internalTab && !isControlled) {
      setInternalTab(urlTab)
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync tab to URL when it changes, with scroll position restoration
  const handleTabChange = React.useCallback((newTab: string) => {
    // If controlled, call the external handler
    if (isControlled && controlledOnTabChange) {
      controlledOnTabChange(newTab)
    } else {
      setInternalTab(newTab)
    }

    // Clear search when switching tabs (search is tab-specific)
    setSearchInput('')
    setSearchQuery('')
    setSearchExpanded(false)

    // Update URL - remove search param when switching tabs
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", newTab)
    params.delete("search")
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
  }, [searchParams, router, pathname, isControlled, controlledOnTabChange])

  // Unfulfilled tab filter state (lifted from UnfulfilledTable for header integration)
  // Now using arrays for multi-select support
  const [unfulfilledStatusFilter, setUnfulfilledStatusFilter] = React.useState<string[]>([])
  const [unfulfilledAgeFilter, setUnfulfilledAgeFilter] = React.useState<string[]>([])
  const [unfulfilledTypeFilter, setUnfulfilledTypeFilter] = React.useState<string[]>([])
  const [unfulfilledChannelFilter, setUnfulfilledChannelFilter] = React.useState<string[]>([])
  const [unfulfilledDateRange, setUnfulfilledDateRange] = React.useState<DateRange | undefined>(() => {
    const range = getDateRangeFromPreset('all')
    return range ? { from: range.from, to: range.to } : undefined
  })
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

  // Column visibility and page size are now persisted via useTablePreferences hooks above

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
  // Initialize from URL search param if present
  const initialSearch = searchParams.get('search') || ''
  const [searchInput, setSearchInput] = React.useState(initialSearch)
  const [searchQuery, setSearchQuery] = React.useState(initialSearch)

  // Expand search bar if URL has search param on mount
  React.useEffect(() => {
    if (initialSearch) {
      setSearchExpanded(true)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Sync search state when URL search param changes (e.g., from external navigation)
  React.useEffect(() => {
    const urlSearch = searchParams.get('search') || ''
    if (urlSearch && urlSearch !== searchQuery) {
      setSearchInput(urlSearch)
      setSearchQuery(urlSearch)
      setSearchExpanded(true)
    }
  }, [searchParams]) // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search - triggers API call 300ms after typing stops
  const debouncedSearch = useDebouncedCallback((value: string) => {
    setSearchQuery(value)
  }, 300)

  // Additional Services tab filter state
  const [additionalServicesTypeFilter, setAdditionalServicesTypeFilter] = React.useState<string>("all")
  const [additionalServicesStatusFilter, setAdditionalServicesStatusFilter] = React.useState<string>("all")
  const [additionalServicesDateRange, setAdditionalServicesDateRange] = React.useState<DateRange | undefined>(() => {
    const range = getDateRangeFromPreset('all')
    return range ? { from: range.from, to: range.to } : undefined
  })
  const [additionalServicesDatePreset, setAdditionalServicesDatePreset] = React.useState<DateRangePreset | undefined>('all')
  const [additionalServicesFeeTypes, setAdditionalServicesFeeTypes] = React.useState<string[]>([])

  // Memoize the status filter array to prevent infinite re-render loops
  // Creating [statusFilter] inline would create a new array on every render
  const additionalServicesStatusFilterArray = React.useMemo(() =>
    additionalServicesStatusFilter !== 'all' ? [additionalServicesStatusFilter] : undefined,
    [additionalServicesStatusFilter]
  )

  // Use prefetched fee types when available, otherwise load dynamically
  React.useEffect(() => {
    if (prefetchedAdditionalServicesFeeTypes && prefetchedAdditionalServicesFeeTypes.length > 0) {
      setAdditionalServicesFeeTypes(prefetchedAdditionalServicesFeeTypes)
      return
    }
    // Fallback: load fee types dynamically if not prefetched
    async function loadFeeTypes() {
      try {
        const response = await fetch(buildApiUrl('/api/data/billing/additional-services/fee-types', { clientId }))
        if (response.ok) {
          const data = await response.json()
          setAdditionalServicesFeeTypes(data.feeTypes || [])
        }
      } catch (err) {
        console.error('Failed to load fee types:', err)
      }
    }
    loadFeeTypes()
  }, [clientId, prefetchedAdditionalServicesFeeTypes])

  // Load dynamic credit reasons for Credits tab
  React.useEffect(() => {
    async function loadCreditReasons() {
      try {
        const response = await fetch(buildApiUrl('/api/data/billing/credits/credit-reasons', { clientId }))
        if (response.ok) {
          const data = await response.json()
          setCreditReasons(data.creditReasons || [])
        }
      } catch (err) {
        console.error('Failed to load credit reasons:', err)
      }
    }
    loadCreditReasons()
  }, [clientId])

  // Load dynamic filter options for Returns tab
  React.useEffect(() => {
    async function loadReturnsFilterOptions() {
      try {
        const response = await fetch(buildApiUrl('/api/data/billing/returns/filter-options', { clientId }))
        if (response.ok) {
          const data = await response.json()
          setReturnStatuses(data.statuses || [])
          setReturnTypes(data.types || [])
        }
      } catch (err) {
        console.error('Failed to load returns filter options:', err)
      }
    }
    loadReturnsFilterOptions()
  }, [clientId])

  // Load dynamic filter options for Receiving tab
  React.useEffect(() => {
    async function loadReceivingFilterOptions() {
      try {
        const response = await fetch(buildApiUrl('/api/data/billing/receiving/filter-options', { clientId }))
        if (response.ok) {
          const data = await response.json()
          setReceivingStatuses(data.statuses || [])
        }
      } catch (err) {
        console.error('Failed to load receiving filter options:', err)
      }
    }
    loadReceivingFilterOptions()
  }, [clientId])

  // Load dynamic filter options for Storage tab
  React.useEffect(() => {
    async function loadStorageFilterOptions() {
      try {
        const response = await fetch(buildApiUrl('/api/data/billing/storage/filter-options', { clientId }))
        if (response.ok) {
          const data = await response.json()
          setStorageFcs(data.fcs || [])
          setStorageLocationTypes(data.locationTypes || [])
        }
      } catch (err) {
        console.error('Failed to load storage filter options:', err)
      }
    }
    loadStorageFilterOptions()
  }, [clientId])

  // Returns tab filter state
  const [returnStatusFilter, setReturnStatusFilter] = React.useState<string>("all")
  const [returnTypeFilter, setReturnTypeFilter] = React.useState<string>("all")
  const [returnsDateRange, setReturnsDateRange] = React.useState<DateRange | undefined>(() => {
    const range = getDateRangeFromPreset('all')
    return range ? { from: range.from, to: range.to } : undefined
  })
  const [returnsDatePreset, setReturnsDatePreset] = React.useState<DateRangePreset | undefined>('all')
  const [returnStatuses, setReturnStatuses] = React.useState<string[]>([])
  const [returnTypes, setReturnTypes] = React.useState<string[]>([])

  // Receiving tab filter state
  const [receivingStatusFilter, setReceivingStatusFilter] = React.useState<string>("all")
  const [receivingDateRange, setReceivingDateRange] = React.useState<DateRange | undefined>(() => {
    const range = getDateRangeFromPreset('all')
    return range ? { from: range.from, to: range.to } : undefined
  })
  const [receivingDatePreset, setReceivingDatePreset] = React.useState<DateRangePreset | undefined>('all')
  const [receivingStatuses, setReceivingStatuses] = React.useState<string[]>([])

  // Storage tab filter state
  const [storageFcFilter, setStorageFcFilter] = React.useState<string>("all")
  const [storageLocationTypeFilter, setStorageLocationTypeFilter] = React.useState<string>("all")
  const [storageFcs, setStorageFcs] = React.useState<string[]>([])
  const [storageLocationTypes, setStorageLocationTypes] = React.useState<string[]>([])

  // Credits tab filter state
  const [creditsReasonFilter, setCreditsReasonFilter] = React.useState<string>("all")
  const [creditsDateRange, setCreditsDateRange] = React.useState<DateRange | undefined>(() => {
    const range = getDateRangeFromPreset('all')
    return range ? { from: range.from, to: range.to } : undefined
  })
  const [creditsDatePreset, setCreditsDatePreset] = React.useState<DateRangePreset | undefined>('all')
  const [creditReasons, setCreditReasons] = React.useState<string[]>([])

  // Date preset state for unfulfilled filter
  const [unfulfilledDatePreset, setUnfulfilledDatePreset] = React.useState<DateRangePreset | undefined>('all')

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

  // Clear unfulfilled filters (does NOT clear date range - date has separate control)
  const clearUnfulfilledFilters = () => {
    setUnfulfilledStatusFilter([])
    setUnfulfilledAgeFilter([])
    setUnfulfilledTypeFilter([])
    setUnfulfilledChannelFilter([])
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

  // Clear shipments filters (does NOT clear date range - date has separate control)
  const clearShipmentsFilters = () => {
    setShipmentsStatusFilter([])
    setShipmentsAgeFilter([])
    setShipmentsTypeFilter([])
    setShipmentsChannelFilter([])
    setShipmentsCarrierFilter([])
  }

  // Additional Services tab computed values
  // Note: Date range is NOT counted as a filter since it has its own indicator
  const hasAdditionalServicesFilters = additionalServicesTypeFilter !== "all" || additionalServicesStatusFilter !== "all"
  const additionalServicesFilterCount = [
    additionalServicesTypeFilter !== "all",
    additionalServicesStatusFilter !== "all",
  ].filter(Boolean).length

  // Clear additional services filters (does NOT clear date range - date has separate control)
  const clearAdditionalServicesFilters = () => {
    setAdditionalServicesTypeFilter("all")
    setAdditionalServicesStatusFilter("all")
  }

  // Returns tab computed values
  // Note: Date range is NOT counted as a filter since it has its own indicator
  const hasReturnsFilters = returnStatusFilter !== "all" || returnTypeFilter !== "all"
  const returnsFilterCount = [
    returnStatusFilter !== "all",
    returnTypeFilter !== "all",
  ].filter(Boolean).length

  // Clear returns filters (does NOT clear date range - date has separate control)
  const clearReturnsFilters = () => {
    setReturnStatusFilter("all")
    setReturnTypeFilter("all")
  }

  // Receiving tab computed values
  // Note: Date range is NOT counted as a filter since it has its own indicator
  const hasReceivingFilters = receivingStatusFilter !== "all"
  const receivingFilterCount = receivingStatusFilter !== "all" ? 1 : 0

  // Clear receiving filters (does NOT clear date range - date has separate control)
  const clearReceivingFilters = () => {
    setReceivingStatusFilter("all")
  }

  // Storage tab computed values
  const hasStorageFilters = storageFcFilter !== "all" || storageLocationTypeFilter !== "all"
  const storageFilterCount = [
    storageFcFilter !== "all",
    storageLocationTypeFilter !== "all",
  ].filter(Boolean).length

  const clearStorageFilters = () => {
    setStorageFcFilter("all")
    setStorageLocationTypeFilter("all")
  }

  // Credits tab computed values
  // Note: Date range is NOT counted as a filter since it has its own indicator
  const hasCreditsFilters = creditsReasonFilter !== "all"
  const creditsFilterCount = creditsReasonFilter !== "all" ? 1 : 0

  // Clear credits filters (does NOT clear date range - date has separate control)
  const clearCreditsFilters = () => {
    setCreditsReasonFilter("all")
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
    if (preset !== 'custom') {
      const range = getDateRangeFromPreset(preset)
      if (range) {
        setDateRange({ from: range.from, to: range.to })
      }
    }
  }

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

  // Get current table preferences based on tab
  const currentPrefs = React.useMemo(() => {
    switch (currentTab) {
      case "unfulfilled": return unfulfilledPrefs
      case "shipments": return shipmentsPrefs
      case "additional-services": return additionalServicesPrefs
      case "returns": return returnsPrefs
      case "receiving": return receivingPrefs
      case "storage": return storagePrefs
      case "credits": return creditsPrefs
      default: return shipmentsPrefs
    }
  }, [currentTab, unfulfilledPrefs, shipmentsPrefs, additionalServicesPrefs, returnsPrefs, receivingPrefs, storagePrefs, creditsPrefs])

  // Get current column visibility state and setter based on tab
  const currentColumnVisibility = currentPrefs.columnVisibility

  const setCurrentColumnVisibility = React.useCallback((update: VisibilityState | ((prev: VisibilityState) => VisibilityState)) => {
    if (typeof update === 'function') {
      currentPrefs.setColumnVisibility(update(currentPrefs.columnVisibility))
    } else {
      currentPrefs.setColumnVisibility(update)
    }
  }, [currentPrefs])

  const resetCurrentColumns = React.useCallback(() => {
    currentPrefs.resetPreferences()
  }, [currentPrefs])

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
        {/* Sticky header with controls */}
        <div className="sticky top-0 z-20 -mx-4 lg:-mx-6 bg-muted/60 dark:bg-zinc-900/60 rounded-t-xl">
          {/* Controls row: Search + Date Range (left) | Filters + Export + Columns (right) */}
          <div className="px-4 lg:px-6 py-4 flex items-center justify-between gap-4">
            {/* LEFT SIDE: Search + Date Range */}
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

              {/* Date Range - Preset dropdown + Inline date range picker */}
              {currentTab !== "storage" && (
                <div className="flex items-center gap-1.5">
                  {/* Preset dropdown (no Custom option) */}
                  <Select
                    value={currentTabDateState.preset === 'custom' ? '' : (currentTabDateState.preset || '60d')}
                    onValueChange={(value) => {
                      if (value) {
                        handleGenericDatePresetChange(value as DateRangePreset)
                      }
                    }}
                  >
                    <SelectTrigger className="h-[30px] w-auto gap-1.5 text-sm bg-background">
                      <SelectValue placeholder="Custom">
                        {currentTabDateState.preset === 'custom'
                          ? 'Custom'
                          : (currentTab === "unfulfilled" ? UNFULFILLED_DATE_PRESETS : DATE_RANGE_PRESETS).find(p => p.value === currentTabDateState.preset)?.label || '60D'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start">
                      {(currentTab === "unfulfilled" ? UNFULFILLED_DATE_PRESETS : DATE_RANGE_PRESETS).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Inline date range picker - shows actual dates, allows custom selection */}
                  <InlineDateRangePicker
                    dateRange={currentTabDateState.dateRange}
                    onDateRangeChange={(range) => {
                      currentTabDateState.setDateRange(range)
                      // When user manually selects dates, switch to custom mode
                      if (range?.from && range?.to) {
                        currentTabDateState.setPreset('custom')
                      }
                    }}
                  />
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
              <Button
                variant="outline"
                size="sm"
                onClick={() => setExportSheetOpen(true)}
                className="h-[30px] flex-shrink-0 text-muted-foreground"
              >
                <DownloadIcon className="h-4 w-4" />
                <span className="ml-2 hidden lg:inline">Export</span>
              </Button>

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
            <div className="px-4 lg:px-6 pt-0 pb-4 flex items-center justify-end gap-4 animate-in slide-in-from-top-2 duration-200">
              {/* Filter Dropdowns */}
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
                      <SelectTrigger className="h-[30px] w-[180px] text-sm">
                        <SelectValue placeholder="Fee Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        {additionalServicesFeeTypes.map((type) => (
                          <SelectItem key={type} value={type}>{getFeeTypeDisplayName(type)}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={additionalServicesStatusFilter} onValueChange={setAdditionalServicesStatusFilter}>
                      <SelectTrigger className="h-[30px] w-[130px] text-sm">
                        <SelectValue placeholder="Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        <SelectItem value="pending">Pending</SelectItem>
                        <SelectItem value="invoiced">Invoiced</SelectItem>
                      </SelectContent>
                    </Select>
                  </>
                )}

                {/* RETURNS TAB FILTERS */}
                {currentTab === "returns" && (
                  <>
                    <Select value={returnStatusFilter} onValueChange={setReturnStatusFilter}>
                      <SelectTrigger className="h-[30px] w-[150px] text-sm">
                        <SelectValue placeholder="Return Status" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All statuses</SelectItem>
                        {returnStatuses.map((status) => (
                          <SelectItem key={status} value={status}>{status}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={returnTypeFilter} onValueChange={setReturnTypeFilter}>
                      <SelectTrigger className="h-[30px] w-[150px] text-sm">
                        <SelectValue placeholder="Return Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        {returnTypes.map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}

                {/* RECEIVING TAB FILTERS */}
                {currentTab === "receiving" && (
                  <Select value={receivingStatusFilter} onValueChange={setReceivingStatusFilter}>
                    <SelectTrigger className="h-[30px] w-[160px] text-sm">
                      <SelectValue placeholder="Status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      {receivingStatuses.map((status) => (
                        <SelectItem key={status} value={status}>{status}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {/* STORAGE TAB FILTERS */}
                {currentTab === "storage" && (
                  <>
                    <Select value={storageFcFilter} onValueChange={setStorageFcFilter}>
                      <SelectTrigger className="h-[30px] w-[160px] text-sm">
                        <SelectValue placeholder="FC" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All FCs</SelectItem>
                        {storageFcs.map((fc) => (
                          <SelectItem key={fc} value={fc}>{fc}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={storageLocationTypeFilter} onValueChange={setStorageLocationTypeFilter}>
                      <SelectTrigger className="h-[30px] w-[160px] text-sm">
                        <SelectValue placeholder="Location Type" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">All types</SelectItem>
                        {storageLocationTypes.map((type) => (
                          <SelectItem key={type} value={type}>{type}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                )}

                {/* CREDITS TAB FILTERS */}
                {currentTab === "credits" && (
                  <Select value={creditsReasonFilter} onValueChange={setCreditsReasonFilter}>
                    <SelectTrigger className="h-[30px] w-[180px] text-sm">
                      <SelectValue placeholder="Reason" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All reasons</SelectItem>
                      {creditReasons.map((reason) => (
                        <SelectItem key={reason} value={reason}>{reason}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
            userColumnVisibility={unfulfilledPrefs.columnVisibility}
            // Page size persistence
            initialPageSize={unfulfilledPrefs.pageSize}
            onPageSizeChange={unfulfilledPrefs.setPageSize}
            // Pre-fetched data for instant initial render
            initialData={unfulfilledData}
            initialTotalCount={unfulfilledTotalCount}
            // Export handler registration
            onExportTriggerReady={(trigger) => {
              if (currentTab === 'unfulfilled') exportTriggerRef.current = trigger
            }}
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
            userColumnVisibility={shipmentsPrefs.columnVisibility}
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
            // Page size persistence
            initialPageSize={shipmentsPrefs.pageSize}
            onPageSizeChange={shipmentsPrefs.setPageSize}
            // Pre-fetched data for instant initial render
            initialData={prefetchedShipmentsData}
            initialTotalCount={prefetchedShipmentsTotalCount}
            // Export handler registration
            onExportTriggerReady={(trigger) => {
              if (currentTab === 'shipments') exportTriggerRef.current = trigger
            }}
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
          statusFilter={additionalServicesStatusFilterArray}
          feeTypeFilter={additionalServicesTypeFilter}
          searchQuery={searchQuery}
          userColumnVisibility={additionalServicesPrefs.columnVisibility}
          initialPageSize={additionalServicesPrefs.pageSize}
          onPageSizeChange={additionalServicesPrefs.setPageSize}
          // Pre-fetched data for instant initial render
          initialData={prefetchedAdditionalServicesData}
          initialTotalCount={prefetchedAdditionalServicesTotalCount}
          initialLoading={prefetchedAdditionalServicesLoading}
          onExportTriggerReady={(trigger) => {
            if (currentTab === 'additional-services') exportTriggerRef.current = trigger
          }}
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
          returnStatusFilter={returnStatusFilter}
          returnTypeFilter={returnTypeFilter}
          searchQuery={searchQuery}
          userColumnVisibility={returnsPrefs.columnVisibility}
          initialPageSize={returnsPrefs.pageSize}
          onPageSizeChange={returnsPrefs.setPageSize}
          onExportTriggerReady={(trigger) => {
            if (currentTab === 'returns') exportTriggerRef.current = trigger
          }}
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
          statusFilter={receivingStatusFilter}
          searchQuery={searchQuery}
          userColumnVisibility={receivingPrefs.columnVisibility}
          initialPageSize={receivingPrefs.pageSize}
          onPageSizeChange={receivingPrefs.setPageSize}
          onExportTriggerReady={(trigger) => {
            if (currentTab === 'receiving') exportTriggerRef.current = trigger
          }}
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
          fcFilter={storageFcFilter}
          locationTypeFilter={storageLocationTypeFilter}
          searchQuery={searchQuery}
          userColumnVisibility={storagePrefs.columnVisibility}
          initialPageSize={storagePrefs.pageSize}
          onPageSizeChange={storagePrefs.setPageSize}
          onExportTriggerReady={(trigger) => {
            if (currentTab === 'storage') exportTriggerRef.current = trigger
          }}
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
          creditReasonFilter={creditsReasonFilter}
          searchQuery={searchQuery}
          userColumnVisibility={creditsPrefs.columnVisibility}
          initialPageSize={creditsPrefs.pageSize}
          onPageSizeChange={creditsPrefs.setPageSize}
          onExportTriggerReady={(trigger) => {
            if (currentTab === 'credits') exportTriggerRef.current = trigger
          }}
        />
      </TabsContent>
    </Tabs>

    {/* Export Sheet */}
    <Sheet open={exportSheetOpen} onOpenChange={setExportSheetOpen}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Export Data</SheetTitle>
          <SheetDescription>
            Export {currentTab === 'unfulfilled' ? 'orders' : currentTab} data to a file
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-6 py-6">
          <div className="flex flex-col gap-3">
            <Label className="text-sm font-medium">File Format</Label>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => setExportFormat('csv')}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 transition-all",
                  exportFormat === 'csv'
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/50"
                )}
              >
                <span className="text-2xl">📄</span>
                <span className="font-medium">CSV</span>
                <span className="text-xs text-muted-foreground">Comma-separated</span>
              </button>
              <button
                onClick={() => setExportFormat('xlsx')}
                className={cn(
                  "flex flex-col items-center justify-center gap-2 p-4 rounded-lg border-2 transition-all",
                  exportFormat === 'xlsx'
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/50"
                )}
              >
                <span className="text-2xl">📊</span>
                <span className="font-medium">Excel</span>
                <span className="text-xs text-muted-foreground">XLSX format</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <Label className="text-sm font-medium">Export Scope</Label>
            <div className="flex flex-col gap-2">
              <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="exportScope"
                  value="current"
                  checked={exportScope === 'current'}
                  onChange={() => setExportScope('current')}
                  className="h-4 w-4"
                />
                <div className="flex flex-col">
                  <span className="font-medium">Current Page</span>
                  <span className="text-xs text-muted-foreground">
                    Export only the visible rows on this page
                  </span>
                </div>
              </label>
              <label className="flex items-center gap-3 p-3 rounded-lg border cursor-pointer hover:bg-muted/50 transition-colors">
                <input
                  type="radio"
                  name="exportScope"
                  value="all"
                  checked={exportScope === 'all'}
                  onChange={() => setExportScope('all')}
                  className="h-4 w-4"
                />
                <div className="flex flex-col">
                  <span className="font-medium">All Pages</span>
                  <span className="text-xs text-muted-foreground">
                    Export all records matching current filters
                  </span>
                </div>
              </label>
            </div>
          </div>
        </div>
        <SheetFooter className="gap-2">
          <SheetClose asChild>
            <Button variant="outline" disabled={isExporting}>Cancel</Button>
          </SheetClose>
          <Button
            onClick={() => {
              setIsExporting(true)
              // Trigger export via the current table's ref
              if (exportTriggerRef.current) {
                exportTriggerRef.current({ format: exportFormat, scope: exportScope })
              }
              toast.success(`Exporting ${currentTab} data as ${exportFormat.toUpperCase()}...`)
              setIsExporting(false)
              setExportSheetOpen(false)
            }}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <LoaderIcon className="mr-2 h-4 w-4 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <DownloadIcon className="mr-2 h-4 w-4" />
                Export
              </>
            )}
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


