"use client"

import * as React from "react"
import { SiteHeader } from "@/components/site-header"
import { useClient } from "@/components/client-context"
import { LookoutTable } from "@/components/lookout/lookout-table"
import { QuickFilters, QuickFilterValue } from "@/components/lookout/quick-filters"
import { InlineDateRangePicker } from "@/components/ui/inline-date-range-picker"
import { DateRange } from "react-day-picker"
import { subDays } from "date-fns"

// Monitored shipment interface
export interface MonitoredShipment {
  id: string
  shipmentId: string
  trackingNumber: string
  carrier: string
  clientId: string
  clientName: string
  shipDate: string
  lastScanDate: string | null
  daysSilent: number
  daysInTransit: number
  claimEligibilityStatus: 'at_risk' | 'eligible' | 'claim_filed' | 'approved' | 'denied' | 'missed_window' | null
  careTicketStatus: string | null // Actual care ticket status for filed claims
  // AI assessment fields
  aiStatusBadge: 'MOVING' | 'DELAYED' | 'WATCHLIST' | 'STALLED' | 'STUCK' | 'RETURNING' | 'LOST' | null
  aiRiskLevel: 'low' | 'medium' | 'high' | 'critical' | null
  aiReshipmentUrgency: number | null
  aiCustomerAnxiety: number | null
  aiPredictedOutcome: 'delivered' | 'lost' | 'returned' | null
  aiAssessment: {
    statusBadge: string
    riskLevel: string
    customerSentiment: string
    merchantAction: string
    reshipmentUrgency: number
    keyInsight: string
    nextMilestone: string
    confidence: number
  } | null
  aiAssessedAt: string | null
  // Transit metrics
  firstCarrierScanAt: string | null
  stuckAtFacility: string | null
  stuckDurationDays: number | null
}

// Stats interface for filter counts
interface LookoutStats {
  atRisk: number
  eligible: number
  claimFiled: number
  total: number
  archived: number
  reshipNow: number
  considerReship: number
  customerAnxious: number
  stuck: number
  returning: number
  lost: number
}

// Calculate default 60-day date range
function getDefaultDateRange(): DateRange {
  const today = new Date()
  return {
    from: subDays(today, 59),
    to: today,
  }
}

export default function LookoutPage() {
  const { selectedClientId, effectiveIsAdmin, effectiveIsCareUser, isLoading: isClientLoading } = useClient()

  // Filter state
  const [quickFilter, setQuickFilter] = React.useState<QuickFilterValue>('at_risk')
  const [dateRange, setDateRange] = React.useState<DateRange | undefined>(getDefaultDateRange())

  // Data state
  const [shipments, setShipments] = React.useState<MonitoredShipment[]>([])
  const [stats, setStats] = React.useState<LookoutStats>({
    atRisk: 0,
    eligible: 0,
    claimFiled: 0,
    total: 0,
    archived: 0,
    reshipNow: 0,
    considerReship: 0,
    customerAnxious: 0,
    stuck: 0,
    returning: 0,
    lost: 0,
  })
  const [isLoading, setIsLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  // Determine effective client ID (admins and care users can view all brands)
  const canViewAllBrands = effectiveIsAdmin || effectiveIsCareUser
  const effectiveClientId = canViewAllBrands
    ? (selectedClientId || 'all')
    : null

  // Fetch monitored shipments
  const fetchShipments = React.useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const params = new URLSearchParams()
      if (effectiveClientId) {
        params.set('clientId', effectiveClientId)
      }
      if (quickFilter) {
        params.set('filter', quickFilter)
      }
      if (dateRange?.from) {
        params.set('startDate', dateRange.from.toISOString().split('T')[0])
      }
      if (dateRange?.to) {
        params.set('endDate', dateRange.to.toISOString().split('T')[0])
      }

      const response = await fetch(`/api/data/monitoring/shipments?${params.toString()}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch monitored shipments: ${response.status}`)
      }

      const result = await response.json()
      setShipments(result.data || [])
      // Note: Stats are fetched separately by fetchStats() to get counts for ALL filters
    } catch (err) {
      console.error('Error fetching monitored shipments:', err)
      setError(err instanceof Error ? err.message : 'Failed to load data')
      setShipments([])
    } finally {
      setIsLoading(false)
    }
  }, [effectiveClientId, quickFilter, dateRange])

  // Fetch stats (for filter counts)
  const fetchStats = React.useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (effectiveClientId) {
        params.set('clientId', effectiveClientId)
      }
      if (dateRange?.from) {
        params.set('startDate', dateRange.from.toISOString().split('T')[0])
      }
      if (dateRange?.to) {
        params.set('endDate', dateRange.to.toISOString().split('T')[0])
      }

      const response = await fetch(`/api/data/monitoring/stats?${params.toString()}`)

      if (!response.ok) {
        throw new Error(`Failed to fetch stats: ${response.status}`)
      }

      const result = await response.json()
      setStats(result)
    } catch (err) {
      console.error('Error fetching stats:', err)
    }
  }, [effectiveClientId, dateRange])

  // Initial load
  React.useEffect(() => {
    if (!isClientLoading) {
      fetchShipments()
      fetchStats()
    }
  }, [isClientLoading, fetchShipments, fetchStats])

  // Handle quick filter change
  const handleQuickFilterChange = (filter: QuickFilterValue) => {
    setQuickFilter(filter)
  }

  // Handle date range change
  const handleDateRangeChange = (range: DateRange | undefined) => {
    setDateRange(range)
  }

  return (
    <>
      <SiteHeader sectionName="Delivery IQ" />
      <div className="flex flex-1 flex-col overflow-hidden bg-background rounded-t-xl">
        <div className="flex flex-col h-[calc(100vh-64px)] px-4 lg:px-6">
          {/* Sticky header with filters - matches Transactions styling */}
          <div className="flex-shrink-0 -mx-4 lg:-mx-6 mb-3 bg-muted/60 dark:bg-zinc-900/60 rounded-t-xl font-roboto text-xs">
            <div className="flex items-center justify-between gap-4 px-4 lg:px-6 py-3">
              <QuickFilters
                value={quickFilter}
                onChange={handleQuickFilterChange}
                stats={stats}
              />
              <InlineDateRangePicker
                dateRange={dateRange}
                onDateRangeChange={handleDateRangeChange}
              />
            </div>
          </div>

          {/* Table - fills remaining space with internal scroll */}
          <div className="flex flex-col flex-1 min-h-0 -mx-4 lg:-mx-6">
            <LookoutTable
              data={shipments}
              isLoading={isLoading}
              error={error}
              showClientColumn={canViewAllBrands}
              activeFilter={quickFilter}
              onRefresh={fetchShipments}
            />
          </div>
        </div>
      </div>
    </>
  )
}
