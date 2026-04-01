"use client"

import * as React from "react"
import { useSearchParams, usePathname } from "next/navigation"
import { VisibilityState } from "@tanstack/react-table"
import {
  ChevronDownIcon,
  ChevronUpIcon,
  ColumnsIcon,
  DownloadIcon,
  EyeIcon,
  FileSpreadsheetIcon,
  FileTextIcon,
  SlidersHorizontalIcon,
  StickyNoteIcon,
  LoaderIcon,
  SearchIcon,
  XIcon,
} from "lucide-react"
import { DateRange } from "react-day-picker"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
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
import { DestinationFilter } from "@/components/ui/destination-filter"
import { buildDestinationOptions } from "@/lib/destination-data"
import { useDebouncedShipmentsFilters, useDebouncedUnfulfilledFilters } from "@/hooks/use-debounced-filters"
import { useTablePreferences } from "@/hooks/use-table-preferences"
import { useSavedViews } from "@/hooks/use-saved-views"
import { useWatchlist } from "@/hooks/use-watchlist"
import { useClient } from "@/components/client-context"
import { SavedViewsBar } from "@/components/saved-views-bar"
import { JetpackLoader } from "@/components/jetpack-loader"
import { useUserSettings } from "@/hooks/use-user-settings"
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
} from "@/components/ui/tabs"
import { UnfulfilledTable } from "@/components/transactions/unfulfilled-table"
import { ShipmentsTable } from "@/components/transactions/shipments-table"
import { AdditionalServicesTable } from "@/components/transactions/additional-services-table"
import { ReturnsTable } from "@/components/transactions/returns-table"
import { ReceivingTable } from "@/components/transactions/receiving-table"
import { StorageTable } from "@/components/transactions/storage-table"
import { CreditsTable } from "@/components/transactions/credits-table"
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
import { getUniqueDisplayCarriers, getRawCarriersForDisplayName, getFeeTypeDisplayName } from "@/components/transactions/cell-renderers"
import { ExportFormat, ExportScope } from "@/lib/export"

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
  { value: 'custom', label: 'Custom' },
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
  { value: 'custom', label: 'Custom' },
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

// Regular shipment status options (tracking/delivery statuses)
const SHIPMENTS_STATUS_OPTIONS: FilterOption[] = [
  { value: 'Labelled', label: 'Labelled' },
  { value: 'Awaiting Carrier', label: 'Awaiting Carrier' },
  { value: 'In Transit', label: 'In Transit' },
  { value: 'Out for Delivery', label: 'Out for Delivery' },
  { value: 'Delivered', label: 'Delivered' },
  { value: 'Exception', label: 'Exception' },
  { value: 'Claim', label: 'Claim' },
]

// Claims filter removed - now handled by Delivery IQ page

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
  // Loading indicator (shown next to date range picker)
  isTabLoading = false,
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
  // Loading indicator (shown next to date range picker)
  isTabLoading?: boolean
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

  // Global default page size from user preferences
  const { settings: userSettings } = useUserSettings()
  const globalPageSize = userSettings.defaultPageSize

  // Table preferences with localStorage persistence for all tabs
  // Per-table overrides take precedence over the global default
  const shipmentsPrefs = useTablePreferences('shipments', globalPageSize)
  const unfulfilledPrefs = useTablePreferences('unfulfilled', globalPageSize)
  const additionalServicesPrefs = useTablePreferences('additional-services', globalPageSize)
  const returnsPrefs = useTablePreferences('returns', globalPageSize)
  const receivingPrefs = useTablePreferences('receiving', globalPageSize)
  const storagePrefs = useTablePreferences('storage', globalPageSize)
  const creditsPrefs = useTablePreferences('credits', globalPageSize)
  const [pagination, setPagination] = React.useState({
    pageIndex: 0,
    pageSize: defaultPageSize,
  })
  const [exportSheetOpen, setExportSheetOpen] = React.useState(false)
  const [exportFormat, setExportFormat] = React.useState<'csv' | 'xlsx'>('csv')
  const [exportScope, setExportScope] = React.useState<'current' | 'all'>('all')
  const [isExporting, setIsExporting] = React.useState(false)
  // Export trigger ref - set by active table component
  const exportTriggerRef = React.useRef<((options: { format: ExportFormat; scope: ExportScope }) => void | Promise<void>) | null>(null)
  const [filtersSheetOpen, setFiltersSheetOpen] = React.useState(false)
  const [searchExpanded, setSearchExpanded] = React.useState(false)

  // Tab state with URL persistence (supports controlled mode via props)
  const searchParams = useSearchParams()
  const pathname = usePathname()

  // Auto-expand filters if URL has filter params (must be after searchParams)
  const [filtersExpanded, setFiltersExpanded] = React.useState(() => {
    const filterParams = ['status', 'age', 'type', 'channel', 'carrier', 'dest', 'feeType', 'billingStatus', 'returnStatus', 'returnType', 'rcStatus', 'fc', 'locationType', 'creditReason']
    return filterParams.some(p => searchParams.has(p))
  })
  const validTabs = ["shipments", "unfulfilled", "additional-services", "returns", "receiving", "storage", "credits"]
  const tabFromUrl = searchParams.get("tab")
  const initialTab = tabFromUrl && validTabs.includes(tabFromUrl) ? tabFromUrl : "shipments"
  const [internalTab, setInternalTab] = React.useState(initialTab)

  // Watchlist & notes filter buttons (available to all roles)
  const { watchedIds, count: watchlistCount } = useWatchlist(clientId || undefined)
  const [watchlistActive, setWatchlistActive] = React.useState(false)
  const [noteFilterActive, setNoteFilterActive] = React.useState(false)
  const [notedShipmentCount, setNotedShipmentCount] = React.useState(0)
  const { effectiveIsAdmin, effectiveIsCareUser } = useClient()

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

    // URL is updated by the unified filter sync useEffect (triggered by currentTab change)

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
  }, [searchParams, pathname, isControlled, controlledOnTabChange]) // eslint-disable-line react-hooks/exhaustive-deps

  // Helper to read comma-separated URL param as array
  const getParamArray = (key: string): string[] => {
    const val = searchParams.get(key)
    return val ? val.split(',').filter(Boolean) : []
  }

  // Helper to read date range from URL params
  const getParamDateRange = (preset: DateRangePreset | undefined, defaultPreset: DateRangePreset): { range: DateRange | undefined; preset: DateRangePreset | undefined } => {
    if (!preset || preset === defaultPreset) {
      const range = getDateRangeFromPreset(defaultPreset)
      return { range: range ? { from: range.from, to: range.to } : undefined, preset: defaultPreset }
    }
    if (preset === 'custom') {
      const from = searchParams.get('dateFrom')
      const to = searchParams.get('dateTo')
      if (from && to) {
        const [fy, fm, fd] = from.split('-').map(Number)
        const [ty, tm, td] = to.split('-').map(Number)
        return { range: { from: new Date(fy, fm - 1, fd), to: new Date(ty, tm - 1, td) }, preset: 'custom' }
      }
      const range = getDateRangeFromPreset(defaultPreset)
      return { range: range ? { from: range.from, to: range.to } : undefined, preset: defaultPreset }
    }
    const range = getDateRangeFromPreset(preset)
    return { range: range ? { from: range.from, to: range.to } : undefined, preset }
  }

  // Read URL params only for the tab we landed on (other tabs use defaults)
  const landedOnUnfulfilled = initialTab === 'unfulfilled'
  const landedOnShipments = initialTab === 'shipments'

  // Unfulfilled tab filter state (lifted from UnfulfilledTable for header integration)
  // Now using arrays for multi-select support
  const [unfulfilledStatusFilter, setUnfulfilledStatusFilter] = React.useState<string[]>(() => landedOnUnfulfilled ? getParamArray('status') : [])
  const [unfulfilledAgeFilter, setUnfulfilledAgeFilter] = React.useState<string[]>(() => landedOnUnfulfilled ? getParamArray('age') : [])
  const [unfulfilledTypeFilter, setUnfulfilledTypeFilter] = React.useState<string[]>(() => landedOnUnfulfilled ? getParamArray('type') : [])
  const [unfulfilledChannelFilter, setUnfulfilledChannelFilter] = React.useState<string[]>(() => landedOnUnfulfilled ? getParamArray('channel') : [])
  const [unfulfilledDestinationFilter, setUnfulfilledDestinationFilter] = React.useState<string[]>(() => landedOnUnfulfilled ? getParamArray('dest') : [])
  const [unfulfilledDateRange, setUnfulfilledDateRange] = React.useState<DateRange | undefined>(() => {
    const urlPreset = landedOnUnfulfilled ? (searchParams.get('datePreset') as DateRangePreset | null) : null
    const { range } = getParamDateRange(urlPreset || undefined, 'all')
    return range
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
  const [shipmentsStatusFilter, setShipmentsStatusFilter] = React.useState<string[]>(() => landedOnShipments ? getParamArray('status') : [])
  // Claims filter removed - now handled by Delivery IQ page
  const [shipmentsAgeFilter, setShipmentsAgeFilter] = React.useState<string[]>(() => landedOnShipments ? getParamArray('age') : [])
  const [shipmentsTypeFilter, setShipmentsTypeFilter] = React.useState<string[]>(() => landedOnShipments ? getParamArray('type') : [])
  const [shipmentsChannelFilter, setShipmentsChannelFilter] = React.useState<string[]>(() => landedOnShipments ? getParamArray('channel') : [])
  const [shipmentsCarrierFilter, setShipmentsCarrierFilter] = React.useState<string[]>(() => landedOnShipments ? getParamArray('carrier') : [])
  const [shipmentsDestinationFilter, setShipmentsDestinationFilter] = React.useState<string[]>(() => landedOnShipments ? getParamArray('dest') : [])
  const [shipmentsFcFilter, setShipmentsFcFilter] = React.useState<string[]>(() => landedOnShipments ? getParamArray('fc') : [])
  const [shipmentsTagsFilter, setShipmentsTagsFilter] = React.useState<string[]>(() => landedOnShipments ? getParamArray('tags') : [])
  const [shipmentsTags, setShipmentsTags] = React.useState<string[]>([])
  const [shipmentsShopifyTagsFilter, setShipmentsShopifyTagsFilter] = React.useState<string[]>(() => landedOnShipments ? getParamArray('shopifyTags') : [])
  const [shipmentsShopifyTags, setShipmentsShopifyTags] = React.useState<string[]>([])
  // Initialize shipments date range — use URL preset if available, else 60 days default
  const shipmentsUrlPreset = landedOnShipments ? (searchParams.get('datePreset') as DateRangePreset | null) : null
  const [shipmentsDateRange, setShipmentsDateRange] = React.useState<DateRange | undefined>(() => {
    if (shipmentsUrlPreset) {
      const { range } = getParamDateRange(shipmentsUrlPreset, 'all')
      return range
    }
    const range = getDateRangeFromPreset('60d')
    return range ? { from: range.from, to: range.to } : undefined
  })
  const [shipmentsDatePreset, setShipmentsDatePreset] = React.useState<DateRangePreset | undefined>(shipmentsUrlPreset || '60d')
  const [shipmentsChannels, setShipmentsChannels] = React.useState<string[]>(prefetchedShipmentsChannels)
  const [shipmentsCarriers, setShipmentsCarriers] = React.useState<string[]>(prefetchedShipmentsCarriers)
  const [shipmentsFcs, setShipmentsFcs] = React.useState<string[]>([])
  const [isShipmentsLoading, setIsShipmentsLoading] = React.useState(prefetchedShipmentsLoading)

  // Destination data (countries + states extracted from API responses)
  const [unfulfilledDestinations, setUnfulfilledDestinations] = React.useState<string[]>([])
  const [unfulfilledDestStates, setUnfulfilledDestStates] = React.useState<Record<string, string[]>>({})
  const [shipmentsDestinations, setShipmentsDestinations] = React.useState<string[]>([])
  const [shipmentsDestStates, setShipmentsDestStates] = React.useState<Record<string, string[]>>({})

  // Consolidated carrier display names for filter dropdown
  // Multiple raw carriers (e.g., "DHL", "DHLExpress") map to single display name ("DHL Express")
  const consolidatedCarrierOptions = React.useMemo(() => {
    return getUniqueDisplayCarriers(shipmentsCarriers)
  }, [shipmentsCarriers])

  // Status filter for API call (claims filter removed - now in Delivery IQ)
  const combinedShipmentsStatusFilter = shipmentsStatusFilter

  // Expand carrier display names back to raw carriers for API call
  // When user selects "DHL Express", we need to filter by both "DHL" and "DHLExpress"
  const expandedCarrierFilter = React.useMemo(() => {
    return shipmentsCarrierFilter.flatMap(displayName => getRawCarriersForDisplayName(displayName))
  }, [shipmentsCarrierFilter])

  // Debounced shipments filters - UI updates immediately, API calls debounced
  const debouncedShipmentsFilters = useDebouncedShipmentsFilters({
    statusFilter: combinedShipmentsStatusFilter,
    ageFilter: shipmentsAgeFilter,
    typeFilter: shipmentsTypeFilter,
    channelFilter: shipmentsChannelFilter,
    carrierFilter: expandedCarrierFilter,
    destinationFilter: shipmentsDestinationFilter,
    fcFilter: shipmentsFcFilter,
    tagsFilter: shipmentsTagsFilter,
    shopifyTagsFilter: shipmentsShopifyTagsFilter,
    dateRange: shipmentsDateRange,
  }, undefined, currentTab === 'shipments')

  // Debounced unfulfilled filters
  const debouncedUnfulfilledFilters = useDebouncedUnfulfilledFilters({
    statusFilter: unfulfilledStatusFilter,
    ageFilter: unfulfilledAgeFilter,
    typeFilter: unfulfilledTypeFilter,
    channelFilter: unfulfilledChannelFilter,
    destinationFilter: unfulfilledDestinationFilter,
    dateRange: unfulfilledDateRange,
  }, undefined, currentTab === 'unfulfilled')

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
  const landedOnAdditionalServices = initialTab === 'additional-services'
  const [additionalServicesTypeFilter, setAdditionalServicesTypeFilter] = React.useState<string>(() => (landedOnAdditionalServices && searchParams.get('feeType')) || "all")
  const [additionalServicesStatusFilter, setAdditionalServicesStatusFilter] = React.useState<string>(() => (landedOnAdditionalServices && searchParams.get('billingStatus')) || "all")
  const [additionalServicesDateRange, setAdditionalServicesDateRange] = React.useState<DateRange | undefined>(() => {
    const urlPreset = landedOnAdditionalServices ? (searchParams.get('datePreset') as DateRangePreset | null) : null
    const { range } = getParamDateRange(urlPreset || undefined, 'all')
    return range
  })
  const [additionalServicesDatePreset, setAdditionalServicesDatePreset] = React.useState<DateRangePreset | undefined>(() => {
    const urlPreset = landedOnAdditionalServices ? (searchParams.get('datePreset') as DateRangePreset | null) : null
    return urlPreset || 'all'
  })
  const [additionalServicesFeeTypes, setAdditionalServicesFeeTypes] = React.useState<string[]>([])

  // Memoize the status filter array to prevent infinite re-render loops
  // Creating [statusFilter] inline would create a new array on every render
  const additionalServicesStatusFilterArray = React.useMemo(() =>
    additionalServicesStatusFilter !== 'all' ? [additionalServicesStatusFilter] : undefined,
    [additionalServicesStatusFilter]
  )

  // Use prefetched fee types when available, otherwise load dynamically when tab is active
  React.useEffect(() => {
    if (prefetchedAdditionalServicesFeeTypes && prefetchedAdditionalServicesFeeTypes.length > 0) {
      setAdditionalServicesFeeTypes(prefetchedAdditionalServicesFeeTypes)
      return
    }
    if (currentTab !== 'additional-services') return
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
  }, [clientId, prefetchedAdditionalServicesFeeTypes, currentTab])

  // Load dynamic credit reasons for Credits tab (only when tab is active)
  React.useEffect(() => {
    if (currentTab !== 'credits') return
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
  }, [clientId, currentTab])

  // Load dynamic filter options for Returns tab (only when tab is active)
  React.useEffect(() => {
    if (currentTab !== 'returns') return
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
  }, [clientId, currentTab])

  // Load available tags for Shipments tab filter (only when tab is active)
  React.useEffect(() => {
    if (currentTab !== 'shipments' || !clientId) return
    async function loadTags() {
      try {
        const response = await fetch(buildApiUrl('/api/data/tags', { clientId }))
        if (response.ok) {
          const result = await response.json()
          setShipmentsTags((result.data || []).map((t: { name: string }) => t.name))
        }
      } catch (err) {
        console.error('Failed to load tags:', err)
      }
    }
    loadTags()
  }, [clientId, currentTab]) // eslint-disable-line react-hooks/exhaustive-deps

  // Load dynamic filter options for Receiving tab (only when tab is active)
  React.useEffect(() => {
    if (currentTab !== 'receiving') return
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
  }, [clientId, currentTab])

  // Load dynamic filter options for Storage tab (only when tab is active)
  React.useEffect(() => {
    if (currentTab !== 'storage') return
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
  }, [clientId, currentTab])

  // Returns tab filter state
  const landedOnReturns = initialTab === 'returns'
  const [returnStatusFilter, setReturnStatusFilter] = React.useState<string>(() => (landedOnReturns && searchParams.get('returnStatus')) || "all")
  const [returnTypeFilter, setReturnTypeFilter] = React.useState<string>(() => (landedOnReturns && searchParams.get('returnType')) || "all")
  const [returnsDateRange, setReturnsDateRange] = React.useState<DateRange | undefined>(() => {
    const urlPreset = landedOnReturns ? (searchParams.get('datePreset') as DateRangePreset | null) : null
    const { range } = getParamDateRange(urlPreset || undefined, 'all')
    return range
  })
  const [returnsDatePreset, setReturnsDatePreset] = React.useState<DateRangePreset | undefined>(() => {
    const urlPreset = landedOnReturns ? (searchParams.get('datePreset') as DateRangePreset | null) : null
    return urlPreset || 'all'
  })
  const [returnStatuses, setReturnStatuses] = React.useState<string[]>([])
  const [returnTypes, setReturnTypes] = React.useState<string[]>([])

  // Receiving tab filter state
  const landedOnReceiving = initialTab === 'receiving'
  const [receivingStatusFilter, setReceivingStatusFilter] = React.useState<string>(() => (landedOnReceiving && searchParams.get('rcStatus')) || "all")
  const [receivingDateRange, setReceivingDateRange] = React.useState<DateRange | undefined>(() => {
    const urlPreset = landedOnReceiving ? (searchParams.get('datePreset') as DateRangePreset | null) : null
    const { range } = getParamDateRange(urlPreset || undefined, 'all')
    return range
  })
  const [receivingDatePreset, setReceivingDatePreset] = React.useState<DateRangePreset | undefined>(() => {
    const urlPreset = landedOnReceiving ? (searchParams.get('datePreset') as DateRangePreset | null) : null
    return urlPreset || 'all'
  })
  const [receivingStatuses, setReceivingStatuses] = React.useState<string[]>([])

  // Storage tab filter state
  const landedOnStorage = initialTab === 'storage'
  const [storageFcFilter, setStorageFcFilter] = React.useState<string>(() => (landedOnStorage && searchParams.get('fc')) || "all")
  const [storageLocationTypeFilter, setStorageLocationTypeFilter] = React.useState<string>(() => (landedOnStorage && searchParams.get('locationType')) || "all")
  const [storageFcs, setStorageFcs] = React.useState<string[]>([])
  const [storageLocationTypes, setStorageLocationTypes] = React.useState<string[]>([])

  // Credits tab filter state
  const landedOnCredits = initialTab === 'credits'
  const [creditsReasonFilter, setCreditsReasonFilter] = React.useState<string>(() => (landedOnCredits && searchParams.get('creditReason')) || "all")
  const [creditsDateRange, setCreditsDateRange] = React.useState<DateRange | undefined>(() => {
    const urlPreset = landedOnCredits ? (searchParams.get('datePreset') as DateRangePreset | null) : null
    const { range } = getParamDateRange(urlPreset || undefined, 'all')
    return range
  })
  const [creditsDatePreset, setCreditsDatePreset] = React.useState<DateRangePreset | undefined>(() => {
    const urlPreset = landedOnCredits ? (searchParams.get('datePreset') as DateRangePreset | null) : null
    return urlPreset || 'all'
  })
  const [creditReasons, setCreditReasons] = React.useState<string[]>([])

  // Date preset state for unfulfilled filter
  const [unfulfilledDatePreset, setUnfulfilledDatePreset] = React.useState<DateRangePreset | undefined>(() => {
    const urlPreset = landedOnUnfulfilled ? (searchParams.get('datePreset') as DateRangePreset | null) : null
    return urlPreset || 'all'
  })

  // ============================================================================
  // URL SYNC: Write filter state to URL params (survives page refresh)
  // Uses replaceState to avoid triggering Next.js router re-renders
  // ============================================================================
  const formatDateParam = (d: Date): string => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  React.useEffect(() => {
    const params = new URLSearchParams()
    params.set('tab', currentTab)

    if (searchQuery) params.set('search', searchQuery)

    // Write current tab's filters to URL
    if (currentTab === 'unfulfilled') {
      if (unfulfilledStatusFilter.length) params.set('status', unfulfilledStatusFilter.join(','))
      if (unfulfilledAgeFilter.length) params.set('age', unfulfilledAgeFilter.join(','))
      if (unfulfilledTypeFilter.length) params.set('type', unfulfilledTypeFilter.join(','))
      if (unfulfilledChannelFilter.length) params.set('channel', unfulfilledChannelFilter.join(','))
      if (unfulfilledDestinationFilter.length) params.set('dest', unfulfilledDestinationFilter.join(','))
      if (unfulfilledDatePreset && unfulfilledDatePreset !== 'all') {
        params.set('datePreset', unfulfilledDatePreset)
        if (unfulfilledDatePreset === 'custom' && unfulfilledDateRange?.from && unfulfilledDateRange?.to) {
          params.set('dateFrom', formatDateParam(unfulfilledDateRange.from))
          params.set('dateTo', formatDateParam(unfulfilledDateRange.to))
        }
      }
    } else if (currentTab === 'shipments') {
      if (shipmentsStatusFilter.length) params.set('status', shipmentsStatusFilter.join(','))
      if (shipmentsAgeFilter.length) params.set('age', shipmentsAgeFilter.join(','))
      if (shipmentsTypeFilter.length) params.set('type', shipmentsTypeFilter.join(','))
      if (shipmentsChannelFilter.length) params.set('channel', shipmentsChannelFilter.join(','))
      if (shipmentsCarrierFilter.length) params.set('carrier', shipmentsCarrierFilter.join(','))
      if (shipmentsDestinationFilter.length) params.set('dest', shipmentsDestinationFilter.join(','))
      if (shipmentsFcFilter.length) params.set('fc', shipmentsFcFilter.join(','))
      if (shipmentsTagsFilter.length) params.set('tags', shipmentsTagsFilter.join(','))
      if (shipmentsShopifyTagsFilter.length) params.set('shopifyTags', shipmentsShopifyTagsFilter.join(','))
      if (shipmentsDatePreset && shipmentsDatePreset !== 'all') {
        params.set('datePreset', shipmentsDatePreset)
        if (shipmentsDatePreset === 'custom' && shipmentsDateRange?.from && shipmentsDateRange?.to) {
          params.set('dateFrom', formatDateParam(shipmentsDateRange.from))
          params.set('dateTo', formatDateParam(shipmentsDateRange.to))
        }
      }
    } else if (currentTab === 'additional-services') {
      if (additionalServicesTypeFilter !== 'all') params.set('feeType', additionalServicesTypeFilter)
      if (additionalServicesStatusFilter !== 'all') params.set('billingStatus', additionalServicesStatusFilter)
      if (additionalServicesDatePreset && additionalServicesDatePreset !== 'all') {
        params.set('datePreset', additionalServicesDatePreset)
        if (additionalServicesDatePreset === 'custom' && additionalServicesDateRange?.from && additionalServicesDateRange?.to) {
          params.set('dateFrom', formatDateParam(additionalServicesDateRange.from))
          params.set('dateTo', formatDateParam(additionalServicesDateRange.to))
        }
      }
    } else if (currentTab === 'returns') {
      if (returnStatusFilter !== 'all') params.set('returnStatus', returnStatusFilter)
      if (returnTypeFilter !== 'all') params.set('returnType', returnTypeFilter)
      if (returnsDatePreset && returnsDatePreset !== 'all') {
        params.set('datePreset', returnsDatePreset)
        if (returnsDatePreset === 'custom' && returnsDateRange?.from && returnsDateRange?.to) {
          params.set('dateFrom', formatDateParam(returnsDateRange.from))
          params.set('dateTo', formatDateParam(returnsDateRange.to))
        }
      }
    } else if (currentTab === 'receiving') {
      if (receivingStatusFilter !== 'all') params.set('rcStatus', receivingStatusFilter)
      if (receivingDatePreset && receivingDatePreset !== 'all') {
        params.set('datePreset', receivingDatePreset)
        if (receivingDatePreset === 'custom' && receivingDateRange?.from && receivingDateRange?.to) {
          params.set('dateFrom', formatDateParam(receivingDateRange.from))
          params.set('dateTo', formatDateParam(receivingDateRange.to))
        }
      }
    } else if (currentTab === 'storage') {
      if (storageFcFilter !== 'all') params.set('fc', storageFcFilter)
      if (storageLocationTypeFilter !== 'all') params.set('locationType', storageLocationTypeFilter)
    } else if (currentTab === 'credits') {
      if (creditsReasonFilter !== 'all') params.set('creditReason', creditsReasonFilter)
      if (creditsDatePreset && creditsDatePreset !== 'all') {
        params.set('datePreset', creditsDatePreset)
        if (creditsDatePreset === 'custom' && creditsDateRange?.from && creditsDateRange?.to) {
          params.set('dateFrom', formatDateParam(creditsDateRange.from))
          params.set('dateTo', formatDateParam(creditsDateRange.to))
        }
      }
    }

    // Use replaceState to avoid triggering Next.js router re-renders
    window.history.replaceState(null, '', `${pathname}?${params.toString()}`)
  }, [
    pathname, currentTab, searchQuery,
    // Unfulfilled
    unfulfilledStatusFilter, unfulfilledAgeFilter, unfulfilledTypeFilter,
    unfulfilledChannelFilter, unfulfilledDestinationFilter, unfulfilledDatePreset, unfulfilledDateRange,
    // Shipments
    shipmentsStatusFilter, shipmentsAgeFilter, shipmentsTypeFilter,
    shipmentsChannelFilter, shipmentsCarrierFilter, shipmentsDestinationFilter, shipmentsFcFilter, shipmentsTagsFilter, shipmentsShopifyTagsFilter, shipmentsDatePreset, shipmentsDateRange,
    // Additional Services
    additionalServicesTypeFilter, additionalServicesStatusFilter, additionalServicesDatePreset, additionalServicesDateRange,
    // Returns
    returnStatusFilter, returnTypeFilter, returnsDatePreset, returnsDateRange,
    // Receiving
    receivingStatusFilter, receivingDatePreset, receivingDateRange,
    // Storage
    storageFcFilter, storageLocationTypeFilter,
    // Credits
    creditsReasonFilter, creditsDatePreset, creditsDateRange,
  ])

  // Check if unfulfilled filters are active and count them (now using arrays)
  // Note: Date range is NOT counted as a filter since it has its own indicator
  const hasUnfulfilledFilters = unfulfilledStatusFilter.length > 0 || unfulfilledAgeFilter.length > 0 ||
    unfulfilledTypeFilter.length > 0 || unfulfilledChannelFilter.length > 0 || unfulfilledDestinationFilter.length > 0

  // Count active filters for badge - count total selected values
  const activeFilterCount =
    unfulfilledStatusFilter.length +
    unfulfilledAgeFilter.length +
    unfulfilledTypeFilter.length +
    unfulfilledChannelFilter.length +
    unfulfilledDestinationFilter.length

  // Clear unfulfilled filters (does NOT clear date range - date has separate control)
  const clearUnfulfilledFilters = () => {
    setUnfulfilledStatusFilter([])
    setUnfulfilledAgeFilter([])
    setUnfulfilledTypeFilter([])
    setUnfulfilledChannelFilter([])
    setUnfulfilledDestinationFilter([])
  }

  // ============================================================================
  // COMPUTED VALUES FOR OTHER TABS
  // ============================================================================

  // Shipments tab computed values (now using arrays)
  // Note: Date range is NOT counted as a filter since it has its own indicator
  // Note: Claims filter removed - now handled by Delivery IQ page
  const hasShipmentsFilters = shipmentsStatusFilter.length > 0 ||
    shipmentsAgeFilter.length > 0 || shipmentsTypeFilter.length > 0 ||
    shipmentsChannelFilter.length > 0 || shipmentsCarrierFilter.length > 0 ||
    shipmentsDestinationFilter.length > 0 || shipmentsFcFilter.length > 0 ||
    shipmentsTagsFilter.length > 0 || shipmentsShopifyTagsFilter.length > 0
  const shipmentsFilterCount =
    shipmentsStatusFilter.length +
    shipmentsAgeFilter.length +
    shipmentsTypeFilter.length +
    shipmentsChannelFilter.length +
    shipmentsCarrierFilter.length +
    shipmentsDestinationFilter.length +
    shipmentsFcFilter.length +
    shipmentsTagsFilter.length +
    shipmentsShopifyTagsFilter.length

  // Clear shipments filters (does NOT clear date range - date has separate control)
  const clearShipmentsFilters = () => {
    setShipmentsStatusFilter([])
    setShipmentsAgeFilter([])
    setShipmentsTypeFilter([])
    setShipmentsChannelFilter([])
    setShipmentsCarrierFilter([])
    setShipmentsDestinationFilter([])
    setShipmentsFcFilter([])
    setShipmentsTagsFilter([])
    setShipmentsShopifyTagsFilter([])
  }

  // ============================================================================
  // SAVED VIEWS
  // ============================================================================

  const unfulfilledSavedViews = useSavedViews('unfulfilled')
  const shipmentsSavedViews = useSavedViews('shipments')

  // Store filters before a preset is applied, so we can restore on deselect
  const unfulfilledPreviousFilters = React.useRef<Record<string, unknown> | null>(null)
  const shipmentsPreviousFilters = React.useRef<Record<string, unknown> | null>(null)

  // Snapshot current unfulfilled filters for saving
  const getUnfulfilledFilterSnapshot = React.useCallback((): Record<string, unknown> => ({
    status: unfulfilledStatusFilter,
    age: unfulfilledAgeFilter,
    type: unfulfilledTypeFilter,
    channel: unfulfilledChannelFilter,
    destination: unfulfilledDestinationFilter,
    datePreset: unfulfilledDatePreset,
    dateRange: unfulfilledDateRange ? {
      from: unfulfilledDateRange.from?.toISOString(),
      to: unfulfilledDateRange.to?.toISOString(),
    } : undefined,
  }), [unfulfilledStatusFilter, unfulfilledAgeFilter, unfulfilledTypeFilter, unfulfilledChannelFilter, unfulfilledDestinationFilter, unfulfilledDatePreset, unfulfilledDateRange])

  // Snapshot current shipments filters for saving
  const getShipmentsFilterSnapshot = React.useCallback((): Record<string, unknown> => ({
    status: shipmentsStatusFilter,
    age: shipmentsAgeFilter,
    type: shipmentsTypeFilter,
    channel: shipmentsChannelFilter,
    carrier: shipmentsCarrierFilter,
    destination: shipmentsDestinationFilter,
    fc: shipmentsFcFilter,
    tags: shipmentsTagsFilter,
    shopifyTags: shipmentsShopifyTagsFilter,
    datePreset: shipmentsDatePreset,
    dateRange: shipmentsDateRange ? {
      from: shipmentsDateRange.from?.toISOString(),
      to: shipmentsDateRange.to?.toISOString(),
    } : undefined,
  }), [shipmentsStatusFilter, shipmentsAgeFilter, shipmentsTypeFilter, shipmentsChannelFilter, shipmentsCarrierFilter, shipmentsDestinationFilter, shipmentsFcFilter, shipmentsTagsFilter, shipmentsShopifyTagsFilter, shipmentsDatePreset, shipmentsDateRange])

  // Apply a saved view's filters to unfulfilled tab
  const applyUnfulfilledFilters = React.useCallback((filters: Record<string, unknown>) => {
    setUnfulfilledStatusFilter((filters.status as string[]) || [])
    setUnfulfilledAgeFilter((filters.age as string[]) || [])
    setUnfulfilledTypeFilter((filters.type as string[]) || [])
    setUnfulfilledChannelFilter((filters.channel as string[]) || [])
    setUnfulfilledDestinationFilter((filters.destination as string[]) || [])
    // Restore date range
    const preset = filters.datePreset as DateRangePreset | undefined
    if (preset && preset !== 'custom') {
      setUnfulfilledDatePreset(preset)
      const range = getDateRangeFromPreset(preset)
      if (range) setUnfulfilledDateRange({ from: range.from, to: range.to })
    } else if (preset === 'custom' && filters.dateRange) {
      const dr = filters.dateRange as { from?: string; to?: string }
      setUnfulfilledDatePreset('custom')
      setUnfulfilledDateRange({
        from: dr.from ? new Date(dr.from) : undefined,
        to: dr.to ? new Date(dr.to) : undefined,
      })
    }
  }, [])

  // Apply a saved view's filters to shipments tab
  const applyShipmentsFilters = React.useCallback((filters: Record<string, unknown>) => {
    setShipmentsStatusFilter((filters.status as string[]) || [])
    setShipmentsAgeFilter((filters.age as string[]) || [])
    setShipmentsTypeFilter((filters.type as string[]) || [])
    setShipmentsChannelFilter((filters.channel as string[]) || [])
    setShipmentsCarrierFilter((filters.carrier as string[]) || [])
    setShipmentsDestinationFilter((filters.destination as string[]) || [])
    setShipmentsFcFilter((filters.fc as string[]) || [])
    setShipmentsTagsFilter((filters.tags as string[]) || [])
    setShipmentsShopifyTagsFilter((filters.shopifyTags as string[]) || [])
    // Restore date range
    const preset = filters.datePreset as DateRangePreset | undefined
    if (preset && preset !== 'custom') {
      setShipmentsDatePreset(preset)
      const range = getDateRangeFromPreset(preset)
      if (range) setShipmentsDateRange({ from: range.from, to: range.to })
    } else if (preset === 'custom' && filters.dateRange) {
      const dr = filters.dateRange as { from?: string; to?: string }
      setShipmentsDatePreset('custom')
      setShipmentsDateRange({
        from: dr.from ? new Date(dr.from) : undefined,
        to: dr.to ? new Date(dr.to) : undefined,
      })
    }
  }, [])

  // Check if active view is modified whenever filters change
  React.useEffect(() => {
    if (currentTab === 'unfulfilled') {
      unfulfilledSavedViews.checkIfModified(getUnfulfilledFilterSnapshot())
    }
  }, [currentTab, unfulfilledStatusFilter, unfulfilledAgeFilter, unfulfilledTypeFilter, unfulfilledChannelFilter, unfulfilledDatePreset, unfulfilledDateRange]) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (currentTab === 'shipments') {
      shipmentsSavedViews.checkIfModified(getShipmentsFilterSnapshot())
    }
  }, [currentTab, shipmentsStatusFilter, shipmentsAgeFilter, shipmentsTypeFilter, shipmentsChannelFilter, shipmentsCarrierFilter, shipmentsFcFilter, shipmentsTagsFilter, shipmentsShopifyTagsFilter, shipmentsDatePreset, shipmentsDateRange]) // eslint-disable-line react-hooks/exhaustive-deps

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
    if (preset === 'custom') {
      // Clear range so the picker opens fresh for selection
      setDateRange(undefined)
    } else {
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
        <div className="sticky top-0 z-20 -mx-4 lg:-mx-6 bg-muted dark:bg-zinc-900 rounded-t-xl font-roboto text-xs">
          {/* Controls row: Search + Date Range (left) | Filters + Export + Columns (right) */}
          <div className="px-4 lg:px-6 py-[19.5px] flex items-center justify-between gap-4">
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
                  className="h-[30px] pl-9 text-xs bg-background border-border placeholder:text-muted-foreground/60"
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
              {currentTab !== "storage" && (
                <div className="flex items-center gap-1.5">
                  <Select
                    value={currentTabDateState.preset || '60d'}
                    onValueChange={(value) => {
                      if (value) {
                        handleGenericDatePresetChange(value as DateRangePreset)
                      }
                    }}
                  >
                    <SelectTrigger className="h-[30px] w-auto gap-1.5 text-xs text-foreground bg-background">
                      <SelectValue>
                        {(currentTab === "unfulfilled" ? UNFULFILLED_DATE_PRESETS : DATE_RANGE_PRESETS).find(p => p.value === currentTabDateState.preset)?.label || '60D'}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent align="start" className="font-roboto text-xs">
                      {(currentTab === "unfulfilled" ? UNFULFILLED_DATE_PRESETS : DATE_RANGE_PRESETS).map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  {/* Inline date range picker - only visible when Custom is selected */}
                  {currentTabDateState.preset === 'custom' && (
                    <InlineDateRangePicker
                      dateRange={currentTabDateState.dateRange}
                      onDateRangeChange={(range) => {
                        currentTabDateState.setDateRange(range)
                      }}
                      autoOpen
                    />
                  )}
                </div>
              )}

              {/* Loading indicator - shown to the right of date range */}
              {isTabLoading && (
                <div className="flex items-center gap-1.5">
                  <JetpackLoader size="md" />
                  <span className="text-xs text-muted-foreground">Loading</span>
                </div>
              )}

            </div>

            {/* RIGHT SIDE: Watchlist + Filters toggle + Export + Columns */}
            <div className="flex items-center gap-2">
              {/* Watchlist eye icon - shipments tab, when watchlist has items */}
              {currentTab === "shipments" && watchlistCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setWatchlistActive(!watchlistActive)}
                  className={cn(
                    "h-[30px] flex-shrink-0 gap-1.5 text-muted-foreground",
                    watchlistActive && "bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/50"
                  )}
                >
                  <EyeIcon className="h-3.5 w-3.5" />
                  <span className="text-xs">{watchlistCount}</span>
                </Button>
              )}
              {/* Notes filter - shipments tab, when notes exist */}
              {currentTab === "shipments" && notedShipmentCount > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setNoteFilterActive(!noteFilterActive)}
                  className={cn(
                    "h-[30px] flex-shrink-0 gap-1.5 text-muted-foreground",
                    noteFilterActive && "bg-amber-50 text-amber-600 border-amber-300 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-400 dark:border-amber-800 dark:hover:bg-amber-900/50"
                  )}
                >
                  <StickyNoteIcon className="h-3.5 w-3.5" />
                  <span className="text-xs">{notedShipmentCount}</span>
                </Button>
              )}
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
                <SlidersHorizontalIcon className="h-3.5 w-3.5" />
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
                // Count user-enabled data columns (exclude action columns with no header)
                const dataColumns = currentTableConfig.columns.filter(c => c.header)
                const enabledColumnCount = dataColumns.filter(
                  col => currentColumnVisibility[col.id] ?? col.defaultVisible !== false
                ).length

                return (
                  <div className="flex items-center gap-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-[30px] flex-shrink-0 items-center text-muted-foreground">
                          <ColumnsIcon className="h-4 w-4" />
                          <span className="ml-[3px] text-xs hidden lg:inline leading-none">
                            ({enabledColumnCount})
                          </span>
                          <ChevronDownIcon className="h-4 w-4 lg:ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56 font-roboto text-xs">
                        {/* Header with Reset link */}
                        <div className="px-2 py-1.5 text-xs text-muted-foreground border-b border-border mb-1 flex items-center justify-between">
                          <span>
                            {enabledColumnCount} columns enabled
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
                        {currentTableConfig.columns.filter(c => c.header).map((column) => {
                          const isChecked = currentColumnVisibility[column.id] ?? column.defaultVisible !== false

                          return (
                            <DropdownMenuCheckboxItem
                              key={column.id}
                              className="capitalize"
                              checked={isChecked}
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
            <div className="px-4 lg:px-6 pt-0 pb-4 flex items-center justify-between gap-4 animate-in slide-in-from-top-2 duration-200">
              {/* Left side: Saved Views (unfulfilled/shipments only) */}
              {currentTab === "unfulfilled" && (
                <SavedViewsBar
                  views={unfulfilledSavedViews.views}
                  activeViewId={unfulfilledSavedViews.activeViewId}
                  isModified={unfulfilledSavedViews.isModified}
                  onLoad={(id) => {
                    // Remember current filters before applying preset
                    if (!unfulfilledSavedViews.activeViewId) {
                      unfulfilledPreviousFilters.current = getUnfulfilledFilterSnapshot()
                    }
                    const view = unfulfilledSavedViews.loadView(id)
                    if (view) applyUnfulfilledFilters(view.filters)
                  }}
                  onSave={(name) => unfulfilledSavedViews.saveView(name, getUnfulfilledFilterSnapshot())}
                  onUpdate={(id) => unfulfilledSavedViews.updateView(id, getUnfulfilledFilterSnapshot())}
                  onDelete={(id) => unfulfilledSavedViews.deleteView(id)}
                  onDeselect={() => {
                    unfulfilledSavedViews.setActiveViewId(null)
                    if (unfulfilledPreviousFilters.current) {
                      applyUnfulfilledFilters(unfulfilledPreviousFilters.current)
                      unfulfilledPreviousFilters.current = null
                    } else {
                      clearUnfulfilledFilters()
                      setUnfulfilledDatePreset('all')
                      const range = getDateRangeFromPreset('all')
                      if (range) setUnfulfilledDateRange({ from: range.from, to: range.to })
                    }
                  }}
                />
              )}
              {currentTab === "shipments" && (
                <SavedViewsBar
                  views={shipmentsSavedViews.views}
                  activeViewId={shipmentsSavedViews.activeViewId}
                  isModified={shipmentsSavedViews.isModified}
                  onLoad={(id) => {
                    // Remember current filters before applying preset
                    if (!shipmentsSavedViews.activeViewId) {
                      shipmentsPreviousFilters.current = getShipmentsFilterSnapshot()
                    }
                    const view = shipmentsSavedViews.loadView(id)
                    if (view) applyShipmentsFilters(view.filters)
                  }}
                  onSave={(name) => shipmentsSavedViews.saveView(name, getShipmentsFilterSnapshot())}
                  onUpdate={(id) => shipmentsSavedViews.updateView(id, getShipmentsFilterSnapshot())}
                  onDelete={(id) => shipmentsSavedViews.deleteView(id)}
                  onDeselect={() => {
                    shipmentsSavedViews.setActiveViewId(null)
                    if (shipmentsPreviousFilters.current) {
                      applyShipmentsFilters(shipmentsPreviousFilters.current)
                      shipmentsPreviousFilters.current = null
                    } else {
                      clearShipmentsFilters()
                      setShipmentsDatePreset('60d')
                      const range = getDateRangeFromPreset('60d')
                      if (range) setShipmentsDateRange({ from: range.from, to: range.to })
                    }
                  }}
                />
              )}
              {/* Empty spacer for tabs without saved views */}
              {currentTab !== "unfulfilled" && currentTab !== "shipments" && <div />}
              {/* Right side: Filter Dropdowns */}
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
                    />
                    <MultiSelectFilter
                      options={UNFULFILLED_AGE_OPTIONS}
                      selected={unfulfilledAgeFilter}
                      onSelectionChange={setUnfulfilledAgeFilter}
                      placeholder="Age"
                    />
                    <MultiSelectFilter
                      options={TYPE_OPTIONS}
                      selected={unfulfilledTypeFilter}
                      onSelectionChange={setUnfulfilledTypeFilter}
                      placeholder="Type"
                    />
                    {/* Channel filter hidden — rarely used, takes up space */}
                    <DestinationFilter
                      options={buildDestinationOptions(unfulfilledDestinations, unfulfilledDestStates)}
                      selected={unfulfilledDestinationFilter}
                      onSelectionChange={setUnfulfilledDestinationFilter}
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
                    />
                    {/* Claims filter removed - now handled by Delivery IQ page */}
                    <MultiSelectFilter
                      options={UNFULFILLED_AGE_OPTIONS}
                      selected={shipmentsAgeFilter}
                      onSelectionChange={setShipmentsAgeFilter}
                      placeholder="Age"
                    />
                    <MultiSelectFilter
                      options={TYPE_OPTIONS}
                      selected={shipmentsTypeFilter}
                      onSelectionChange={setShipmentsTypeFilter}
                      placeholder="Type"
                    />
                    {/* Channel filter hidden — rarely used, takes up space */}
                    <MultiSelectFilter
                      options={consolidatedCarrierOptions.map(c => ({ value: c, label: c }))}
                      selected={shipmentsCarrierFilter}
                      onSelectionChange={setShipmentsCarrierFilter}
                      placeholder="Carrier"
                    />
                    <MultiSelectFilter
                      options={shipmentsFcs.map(fc => ({ value: fc, label: fc }))}
                      selected={shipmentsFcFilter}
                      onSelectionChange={setShipmentsFcFilter}
                      placeholder="Origin"
                    />
                    <DestinationFilter
                      options={buildDestinationOptions(shipmentsDestinations, shipmentsDestStates)}
                      selected={shipmentsDestinationFilter}
                      onSelectionChange={setShipmentsDestinationFilter}
                    />
                    <MultiSelectFilter
                      options={shipmentsTags.map(t => ({ value: t, label: t }))}
                      selected={shipmentsTagsFilter}
                      onSelectionChange={setShipmentsTagsFilter}
                      placeholder="Tags"
                    />
                    {shipmentsShopifyTags.length > 0 && (
                      <MultiSelectFilter
                        options={shipmentsShopifyTags.map(t => ({ value: t, label: t }))}
                        selected={shipmentsShopifyTagsFilter}
                        onSelectionChange={setShipmentsShopifyTagsFilter}
                        placeholder="Shopify Tags"
                      />
                    )}
                  </>
                )}

                {/* ADDITIONAL SERVICES TAB FILTERS */}
                {currentTab === "additional-services" && (
                  <>
                    <Select value={additionalServicesTypeFilter} onValueChange={setAdditionalServicesTypeFilter}>
                      <SelectTrigger className="h-[30px] w-[180px] text-xs text-foreground">
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
                      <SelectTrigger className="h-[30px] w-[130px] text-xs text-foreground">
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
                      <SelectTrigger className="h-[30px] w-[150px] text-xs text-foreground">
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
                      <SelectTrigger className="h-[30px] w-[150px] text-xs text-foreground">
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
                    <SelectTrigger className="h-[30px] w-[160px] text-xs text-foreground">
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
                      <SelectTrigger className="h-[30px] w-[160px] text-xs text-foreground">
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
                      <SelectTrigger className="h-[30px] w-[160px] text-xs text-foreground">
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
                    <SelectTrigger className="h-[30px] w-[180px] text-xs text-foreground">
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
            destinationFilter={debouncedUnfulfilledFilters.destinationFilter}
            dateRange={debouncedUnfulfilledFilters.dateRange}
            searchQuery={searchQuery}
            onChannelsChange={setAvailableChannels}
            onDestinationsChange={(countries, states) => {
              setUnfulfilledDestinations(countries)
              setUnfulfilledDestStates(states)
            }}
            onLoadingChange={setIsUnfulfilledLoading}
            userColumnVisibility={unfulfilledPrefs.columnVisibility}
            columnOrder={unfulfilledPrefs.columnOrder}
            onColumnOrderChange={unfulfilledPrefs.setColumnOrder}
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
            columnOrder={shipmentsPrefs.columnOrder}
            onColumnOrderChange={shipmentsPrefs.setColumnOrder}
            statusFilter={debouncedShipmentsFilters.statusFilter}
            ageFilter={debouncedShipmentsFilters.ageFilter}
            typeFilter={debouncedShipmentsFilters.typeFilter}
            channelFilter={debouncedShipmentsFilters.channelFilter}
            carrierFilter={debouncedShipmentsFilters.carrierFilter}
            destinationFilter={debouncedShipmentsFilters.destinationFilter}
            fcFilter={debouncedShipmentsFilters.fcFilter}
            tagsFilter={debouncedShipmentsFilters.tagsFilter}
            shopifyTagsFilter={debouncedShipmentsFilters.shopifyTagsFilter}
            dateRange={debouncedShipmentsFilters.dateRange}
            searchQuery={searchQuery}
            onChannelsChange={setShipmentsChannels}
            onCarriersChange={setShipmentsCarriers}
            onFcsChange={setShipmentsFcs}
            onDestinationsChange={(countries, states) => {
              setShipmentsDestinations(countries)
              setShipmentsDestStates(states)
            }}
            onShopifyTagsChange={setShipmentsShopifyTags}
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
            // Watchlist filter
            watchlistIds={watchlistActive ? watchedIds : undefined}
            hasNotes={noteFilterActive}
            onNotedCountChange={setNotedShipmentCount}
            onTagsChanged={() => {
              // Re-fetch available tags so new tags appear in the filter immediately
              fetch(buildApiUrl('/api/data/tags', { clientId }))
                .then(r => r.ok ? r.json() : null)
                .then(result => { if (result) setShipmentsTags((result.data || []).map((t: { name: string }) => t.name)) })
                .catch(() => {})
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
          columnOrder={additionalServicesPrefs.columnOrder}
          onColumnOrderChange={additionalServicesPrefs.setColumnOrder}
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
          columnOrder={returnsPrefs.columnOrder}
          onColumnOrderChange={returnsPrefs.setColumnOrder}
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
          columnOrder={receivingPrefs.columnOrder}
          onColumnOrderChange={receivingPrefs.setColumnOrder}
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
          columnOrder={storagePrefs.columnOrder}
          onColumnOrderChange={storagePrefs.setColumnOrder}
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
          columnOrder={creditsPrefs.columnOrder}
          onColumnOrderChange={creditsPrefs.setColumnOrder}
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
      <SheetContent className="font-roboto">
        <SheetHeader>
          <SheetTitle className="text-base font-medium">Export {currentTab === 'unfulfilled' ? 'Orders' : currentTab.charAt(0).toUpperCase() + currentTab.slice(1)}</SheetTitle>
          <SheetDescription className="sr-only">
            Export data to a file
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-5 py-5">
          {/* Format */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Format</span>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setExportFormat('csv')}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 rounded-md border text-[13px] transition-colors",
                  exportFormat === 'csv'
                    ? "border-zinc-400 dark:border-zinc-500 bg-muted/50"
                    : "border-border hover:bg-muted/30"
                )}
              >
                <FileTextIcon className="h-4 w-4 text-muted-foreground" />
                <div className="text-left">
                  <div className="font-medium">CSV</div>
                  <div className="text-[11px] text-muted-foreground">Comma-separated</div>
                </div>
              </button>
              <button
                onClick={() => setExportFormat('xlsx')}
                className={cn(
                  "flex items-center gap-2.5 px-3 py-2.5 rounded-md border text-[13px] transition-colors",
                  exportFormat === 'xlsx'
                    ? "border-zinc-400 dark:border-zinc-500 bg-muted/50"
                    : "border-border hover:bg-muted/30"
                )}
              >
                <FileSpreadsheetIcon className="h-4 w-4 text-muted-foreground" />
                <div className="text-left">
                  <div className="font-medium">Excel</div>
                  <div className="text-[11px] text-muted-foreground">XLSX spreadsheet</div>
                </div>
              </button>
            </div>
          </div>

          {/* Scope */}
          <div className="flex flex-col gap-2">
            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wide">Scope</span>
            <div className="flex flex-col gap-1.5">
              <button
                onClick={() => setExportScope('all')}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md border text-[13px] text-left transition-colors",
                  exportScope === 'all'
                    ? "border-zinc-400 dark:border-zinc-500 bg-muted/50"
                    : "border-border hover:bg-muted/30"
                )}
              >
                <div className={cn(
                  "h-3.5 w-3.5 rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0",
                  exportScope === 'all' ? "border-foreground" : "border-zinc-300 dark:border-zinc-600"
                )}>
                  {exportScope === 'all' && <div className="h-1.5 w-1.5 rounded-full bg-foreground" />}
                </div>
                <div>
                  <div className="font-medium">All records</div>
                  <div className="text-[11px] text-muted-foreground">Everything matching current filters</div>
                </div>
              </button>
              <button
                onClick={() => setExportScope('current')}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-md border text-[13px] text-left transition-colors",
                  exportScope === 'current'
                    ? "border-zinc-400 dark:border-zinc-500 bg-muted/50"
                    : "border-border hover:bg-muted/30"
                )}
              >
                <div className={cn(
                  "h-3.5 w-3.5 rounded-full border-[1.5px] flex items-center justify-center flex-shrink-0",
                  exportScope === 'current' ? "border-foreground" : "border-zinc-300 dark:border-zinc-600"
                )}>
                  {exportScope === 'current' && <div className="h-1.5 w-1.5 rounded-full bg-foreground" />}
                </div>
                <div>
                  <div className="font-medium">Current page</div>
                  <div className="text-[11px] text-muted-foreground">Only visible rows on this page</div>
                </div>
              </button>
            </div>
          </div>
        </div>
        <SheetFooter className="gap-2 pt-2">
          <SheetClose asChild>
            <Button variant="outline" size="sm" disabled={isExporting} className="text-[13px]">Cancel</Button>
          </SheetClose>
          <Button
            size="sm"
            className="text-[13px]"
            onClick={async () => {
              setIsExporting(true)
              setExportSheetOpen(false) // Close sheet so progress bar is visible
              try {
                if (exportTriggerRef.current) {
                  await exportTriggerRef.current({ format: exportFormat, scope: exportScope })
                }
                toast.success(`Exported ${currentTab} data as ${exportFormat.toUpperCase()}`)
              } catch (err) {
                toast.error('Export failed. Please try again.')
                console.error('Export error:', err)
              } finally {
                setIsExporting(false)
              }
            }}
            disabled={isExporting}
          >
            {isExporting ? (
              <>
                <LoaderIcon className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <DownloadIcon className="mr-1.5 h-3.5 w-3.5" />
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


