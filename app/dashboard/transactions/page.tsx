"use client"

import * as React from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"

import { SiteHeader } from "@/components/site-header"
import { DataTable } from "@/components/data-table"
import { useClient } from "@/components/client-context"
import { Skeleton } from "@/components/ui/skeleton"

// Default client ID (Henson Shaving) for non-admin users
const DEFAULT_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'
const DEFAULT_PAGE_SIZE = 50

export default function TransactionsPage() {
  const router = useRouter()
  const { selectedClientId, isAdmin, isLoading: isClientLoading } = useClient()

  // Data state
  const [shipmentsData, setShipmentsData] = React.useState<any[]>([])
  const [isLoading, setIsLoading] = React.useState(true)
  const [isPageLoading, setIsPageLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [totalCount, setTotalCount] = React.useState(0)

  // Pagination state
  const [pageIndex, setPageIndex] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(DEFAULT_PAGE_SIZE)

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

  // Determine which client to fetch data for
  // For admins: null = "All Brands", specific ID = single brand
  // For non-admins: always use DEFAULT_CLIENT_ID
  const effectiveClientId = isAdmin
    ? (selectedClientId || 'all')  // null means "All Brands" for admins
    : DEFAULT_CLIENT_ID

  // Fetch shipments data - called on initial load and page changes
  const fetchData = React.useCallback(async (page: number, size: number) => {
    const isInitialLoad = page === 0 && shipmentsData.length === 0

    if (isInitialLoad) {
      setIsLoading(true)
    } else {
      setIsPageLoading(true)
    }
    setError(null)

    try {
      const offset = page * size
      const response = await fetch(
        `/api/data/shipments?clientId=${effectiveClientId}&limit=${size}&offset=${offset}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch: ${response.status}`)
      }

      const result = await response.json()
      setShipmentsData(result.data || [])
      setTotalCount(result.totalCount || 0)
    } catch (err) {
      console.error('Error fetching shipments:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setShipmentsData([])
    } finally {
      setIsLoading(false)
      setIsPageLoading(false)
    }
  }, [effectiveClientId, shipmentsData.length])

  // Initial load
  React.useEffect(() => {
    if (!isClientLoading) {
      fetchData(pageIndex, pageSize)
    }
  }, [effectiveClientId, isClientLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // Handler for page changes from DataTable
  const handleServerPageChange = React.useCallback((newPageIndex: number, newPageSize: number) => {
    // Only fetch if something actually changed
    if (newPageIndex !== pageIndex || newPageSize !== pageSize) {
      setPageIndex(newPageIndex)
      setPageSize(newPageSize)
      fetchData(newPageIndex, newPageSize)
    }
  }, [pageIndex, pageSize, fetchData])

  // Intercept clicks back to Dashboard
  React.useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      const link = target.closest('a[href="/dashboard"]')

      if (link) {
        e.preventDefault()
        setIsNavigatingBack(true)
        sessionStorage.setItem('navigatingFromTransactions', 'true')

        setTimeout(() => {
          router.push("/dashboard")
        }, 400)
      }
    }

    document.addEventListener("click", handleClick, true)

    return () => {
      document.removeEventListener("click", handleClick, true)
    }
  }, [router])

  // Loading skeleton
  if (isLoading || isClientLoading) {
    return (
      <>
        <SiteHeader sectionName="Transactions" />
        <div className="flex flex-1 flex-col overflow-x-hidden">
          <div className="@container/main flex flex-1 flex-col gap-2 w-full">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 w-full px-4 lg:px-6">
              <div className="space-y-4">
                <Skeleton className="h-10 w-full" />
                <Skeleton className="h-[400px] w-full" />
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  // Error state
  if (error) {
    return (
      <>
        <SiteHeader sectionName="Transactions" />
        <div className="flex flex-1 flex-col overflow-x-hidden">
          <div className="@container/main flex flex-1 flex-col gap-2 w-full">
            <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 w-full px-4 lg:px-6">
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                <p className="font-medium">Error loading data</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          </div>
        </div>
      </>
    )
  }

  return (
    <>
      <SiteHeader sectionName="Transactions" />
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
          <div className="flex flex-col gap-4 py-4 md:gap-6 md:py-6 w-full">
            {/* Show record count */}
            <div className="px-4 lg:px-6 text-sm text-muted-foreground">
              Showing {shipmentsData.length.toLocaleString()} of {totalCount.toLocaleString()} records
              {isPageLoading && " (loading...)"}
            </div>
            <DataTable
              shipmentsData={shipmentsData}
              additionalServicesData={[]}
              returnsData={[]}
              receivingData={[]}
              storageData={[]}
              creditsData={[]}
              defaultPageSize={DEFAULT_PAGE_SIZE}
              showExport={true}
              // Enable server-side pagination
              serverPagination={true}
              totalCount={totalCount}
              onServerPageChange={handleServerPageChange}
              isPageLoading={isPageLoading}
              // Client ID for unfulfilled orders tab
              clientId={effectiveClientId}
            />
          </div>
        </div>
      </motion.div>
    </>
  )
}
