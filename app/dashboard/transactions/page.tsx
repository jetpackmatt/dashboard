"use client"

import * as React from "react"
import { useSearchParams, useRouter, usePathname } from "next/navigation"

import { SiteHeader } from "@/components/site-header"
import { DataTable } from "@/components/data-table"
import { useClient } from "@/components/client-context"
import { getStoredPageSize } from "@/hooks/use-table-preferences"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const DEFAULT_PAGE_SIZE = 50

// Transaction categories for the header dropdown (Unfulfilled first, but Shipments is default)
const TRANSACTION_CATEGORIES = [
  { value: "unfulfilled", label: "Unfulfilled" },
  { value: "shipments", label: "Shipments" },
  { value: "additional-services", label: "Additional Services" },
  { value: "returns", label: "Returns" },
  { value: "receiving", label: "Receiving" },
  { value: "storage", label: "Storage" },
  { value: "credits", label: "Credits" },
] as const

type TabValue = typeof TRANSACTION_CATEGORIES[number]["value"]
const VALID_TABS: TabValue[] = TRANSACTION_CATEGORIES.map(c => c.value)

function isValidTab(tab: string | null): tab is TabValue {
  return tab !== null && VALID_TABS.includes(tab as TabValue)
}

// Calculate 60-day date range for shipments pre-fetch
function get60DayRange(): { startDate: string; endDate: string } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const sixtyDaysAgo = new Date(today)
  sixtyDaysAgo.setDate(today.getDate() - 59)

  return {
    startDate: sixtyDaysAgo.toISOString().split('T')[0],
    endDate: today.toISOString().split('T')[0],
  }
}

export default function TransactionsPage() {
  const { selectedClientId, effectiveIsAdmin, effectiveIsCareUser, isLoading: isClientLoading } = useClient()
  const searchParams = useSearchParams()
  const router = useRouter()
  const pathname = usePathname()

  // Tab state - initialized from URL or default to "shipments"
  const tabFromUrl = searchParams.get("tab")
  const initialTab = isValidTab(tabFromUrl) ? tabFromUrl : "shipments"
  const [currentTab, setCurrentTab] = React.useState<TabValue>(initialTab)

  // Handle tab change - update state and URL
  const handleTabChange = React.useCallback((newTab: string) => {
    if (isValidTab(newTab)) {
      setCurrentTab(newTab)
    }
    const params = new URLSearchParams(searchParams.toString())
    params.set("tab", newTab)
    // Clear search when switching tabs (search is tab-specific)
    params.delete("search")
    router.replace(`${pathname}?${params.toString()}`, { scroll: false })
  }, [searchParams, router, pathname])

  // Unfulfilled data state (pre-fetched for instant tab switching)
  const [unfulfilledData, setUnfulfilledData] = React.useState<any[]>([])
  const [unfulfilledLoading, setUnfulfilledLoading] = React.useState(true)
  const [unfulfilledTotalCount, setUnfulfilledTotalCount] = React.useState(0)
  const [unfulfilledChannels, setUnfulfilledChannels] = React.useState<string[]>([])

  // Shipments data state (pre-fetched for instant tab switching)
  const [shipmentsData, setShipmentsData] = React.useState<any[]>([])
  const [shipmentsLoading, setShipmentsLoading] = React.useState(true)
  const [shipmentsTotalCount, setShipmentsTotalCount] = React.useState(0)
  const [shipmentsChannels, setShipmentsChannels] = React.useState<string[]>([])
  const [shipmentsCarriers, setShipmentsCarriers] = React.useState<string[]>([])

  // Additional Services data state (pre-fetched for instant tab switching)
  const [additionalServicesData, setAdditionalServicesData] = React.useState<any[]>([])
  const [additionalServicesLoading, setAdditionalServicesLoading] = React.useState(true)
  const [additionalServicesTotalCount, setAdditionalServicesTotalCount] = React.useState(0)
  const [additionalServicesFeeTypes, setAdditionalServicesFeeTypes] = React.useState<string[]>([])

  // Returns data state (pre-fetched for instant tab switching)
  const [returnsData, setReturnsData] = React.useState<any[]>([])
  const [returnsLoading, setReturnsLoading] = React.useState(true)
  const [returnsTotalCount, setReturnsTotalCount] = React.useState(0)

  // Determine which client to fetch data for
  // For admins/care users: 'all' = all brands, specific ID = single brand
  // For regular users: null = let API determine from user's assigned clients
  const effectiveClientId = (effectiveIsAdmin || effectiveIsCareUser)
    ? (selectedClientId || 'all')  // null means "All Brands" for admins/care users
    : null  // Let API verify user's access and use their assigned client

  // Helper to build URL with optional clientId
  const buildUrl = (base: string, params: Record<string, string | number | null>) => {
    const searchParams = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined) {
        searchParams.set(key, String(value))
      }
    }
    return `${base}?${searchParams.toString()}`
  }

  // Fetch unfulfilled data - called on initial load
  const fetchUnfulfilledData = React.useCallback(async (size: number) => {
    setUnfulfilledLoading(true)

    try {
      const response = await fetch(
        buildUrl('/api/data/orders/unfulfilled', { clientId: effectiveClientId, limit: size, offset: 0 })
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch unfulfilled: ${response.status}`)
      }

      const result = await response.json()
      const data = result.data || []
      setUnfulfilledData(data)
      setUnfulfilledTotalCount(result.totalCount || 0)

      // Extract unique channels for filter dropdown
      const channels = [...new Set(data.map((d: any) => d.channelName).filter(Boolean))] as string[]
      setUnfulfilledChannels(channels)
    } catch (err) {
      console.error('Error fetching unfulfilled:', err)
      setUnfulfilledData([])
    } finally {
      setUnfulfilledLoading(false)
    }
  }, [effectiveClientId])

  // Fetch shipments data with 60-day filter - called on initial load
  const fetchShipmentsData = React.useCallback(async (size: number) => {
    setShipmentsLoading(true)

    try {
      const { startDate, endDate } = get60DayRange()
      const response = await fetch(
        buildUrl('/api/data/shipments', { clientId: effectiveClientId, limit: size, offset: 0, startDate, endDate })
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch shipments: ${response.status}`)
      }

      const result = await response.json()
      const data = result.data || []
      setShipmentsData(data)
      setShipmentsTotalCount(result.totalCount || 0)

      // Extract unique channels and carriers for filter dropdowns
      const channels = [...new Set(data.map((d: any) => d.channelName).filter(Boolean))] as string[]
      const carriers = [...new Set(data.map((d: any) => d.carrierName).filter(Boolean))] as string[]
      setShipmentsChannels(channels)
      setShipmentsCarriers(carriers)
    } catch (err) {
      console.error('Error fetching shipments:', err)
      setShipmentsData([])
    } finally {
      setShipmentsLoading(false)
    }
  }, [effectiveClientId])

  // Fetch Additional Services data with 60-day filter - called on initial load
  const fetchAdditionalServicesData = React.useCallback(async (size: number) => {
    setAdditionalServicesLoading(true)

    try {
      const { startDate, endDate } = get60DayRange()
      const response = await fetch(
        buildUrl('/api/data/billing/additional-services', { clientId: effectiveClientId, limit: size, offset: 0, startDate, endDate })
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch additional services: ${response.status}`)
      }

      const result = await response.json()
      const data = result.data || []
      setAdditionalServicesData(data)
      setAdditionalServicesTotalCount(result.totalCount || 0)

      // Extract unique fee types for filter dropdown
      const feeTypes = [...new Set(data.map((d: any) => d.feeType).filter(Boolean))] as string[]
      setAdditionalServicesFeeTypes(feeTypes)
    } catch (err) {
      console.error('Error fetching additional services:', err)
      setAdditionalServicesData([])
    } finally {
      setAdditionalServicesLoading(false)
    }
  }, [effectiveClientId])

  // Fetch Returns data with 60-day filter - called on initial load
  const fetchReturnsData = React.useCallback(async (size: number) => {
    setReturnsLoading(true)

    try {
      const { startDate, endDate } = get60DayRange()
      const response = await fetch(
        buildUrl('/api/data/billing/returns', { clientId: effectiveClientId, limit: size, offset: 0, startDate, endDate })
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch returns: ${response.status}`)
      }

      const result = await response.json()
      const data = result.data || []
      setReturnsData(data)
      setReturnsTotalCount(result.totalCount || 0)
    } catch (err) {
      console.error('Error fetching returns:', err)
      setReturnsData([])
    } finally {
      setReturnsLoading(false)
    }
  }, [effectiveClientId])

  // Initial load - fetch current tab FIRST, then background-load others
  // This ensures the user sees data immediately for their active tab
  // Use user's preferred page sizes from localStorage for optimal initial fetch
  React.useEffect(() => {
    if (!isClientLoading) {
      const loadData = async () => {
        // Get user's preferred page sizes from localStorage (or use defaults)
        const unfulfilledPageSize = getStoredPageSize('unfulfilled', DEFAULT_PAGE_SIZE)
        const shipmentsPageSize = getStoredPageSize('shipments', DEFAULT_PAGE_SIZE)
        const additionalServicesPageSize = getStoredPageSize('additional-services', DEFAULT_PAGE_SIZE)
        const returnsPageSize = getStoredPageSize('returns', DEFAULT_PAGE_SIZE)

        // Priority 1: Load current tab first (await it) using user's preferred page size
        if (currentTab === 'unfulfilled') {
          await fetchUnfulfilledData(unfulfilledPageSize)
        } else if (currentTab === 'shipments') {
          await fetchShipmentsData(shipmentsPageSize)
        } else if (currentTab === 'additional-services') {
          await fetchAdditionalServicesData(additionalServicesPageSize)
        } else if (currentTab === 'returns') {
          await fetchReturnsData(returnsPageSize)
        }

        // Priority 2: Background-load other tabs for instant switching
        // Don't await - let them load in parallel in the background
        if (currentTab !== 'unfulfilled') fetchUnfulfilledData(unfulfilledPageSize)
        if (currentTab !== 'shipments') fetchShipmentsData(shipmentsPageSize)
        if (currentTab !== 'additional-services') fetchAdditionalServicesData(additionalServicesPageSize)
        if (currentTab !== 'returns') fetchReturnsData(returnsPageSize)
      }

      loadData()
    }
  }, [effectiveClientId, isClientLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Get the current category label for the dropdown
  const currentCategoryLabel = TRANSACTION_CATEGORIES.find(c => c.value === currentTab)?.label || "Shipments"

  return (
    <>
      <SiteHeader sectionName="Transactions">
        <Select value={currentTab} onValueChange={handleTabChange}>
          <SelectTrigger className="h-7 w-auto gap-1.5 border-0 bg-transparent px-2 text-base font-medium text-foreground hover:bg-accent focus:ring-0 [&>svg]:h-4 [&>svg]:w-4 [&>svg]:opacity-50">
            <SelectValue>{currentCategoryLabel}</SelectValue>
          </SelectTrigger>
          <SelectContent align="start">
            {TRANSACTION_CATEGORIES.map((category) => (
              <SelectItem key={category.value} value={category.value}>
                {category.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SiteHeader>
      <div className="flex flex-1 flex-col overflow-x-hidden bg-background rounded-t-xl">
        <div className="@container/main flex flex-col w-full">
          <div className="flex flex-col w-full">
            <DataTable
              clientId={effectiveClientId}
              defaultPageSize={DEFAULT_PAGE_SIZE}
              showExport={true}
              // Controlled tab state from header dropdown
              currentTab={currentTab}
              onTabChange={handleTabChange}
              // Pre-fetched unfulfilled data for instant tab switching
              unfulfilledData={unfulfilledData}
              unfulfilledTotalCount={unfulfilledTotalCount}
              unfulfilledLoading={unfulfilledLoading}
              unfulfilledChannels={unfulfilledChannels}
              // Pre-fetched shipments data for instant tab switching
              shipmentsData={shipmentsData}
              shipmentsTotalCount={shipmentsTotalCount}
              shipmentsLoading={shipmentsLoading}
              shipmentsChannels={shipmentsChannels}
              shipmentsCarriers={shipmentsCarriers}
              // Pre-fetched Additional Services data for instant tab switching
              additionalServicesData={additionalServicesData}
              additionalServicesTotalCount={additionalServicesTotalCount}
              additionalServicesLoading={additionalServicesLoading}
              additionalServicesFeeTypes={additionalServicesFeeTypes}
              // Pre-fetched Returns data for instant tab switching
              returnsData={returnsData}
              returnsTotalCount={returnsTotalCount}
              returnsLoading={returnsLoading}
            />
          </div>
        </div>
      </div>
    </>
  )
}
