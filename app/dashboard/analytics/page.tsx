"use client"

export const dynamic = 'force-dynamic'

import * as React from "react"
import { useDeferredValue } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { format } from "date-fns"
import {
  CalendarIcon,
  DownloadIcon,
  ChevronDownIcon,
  Loader2,
} from "lucide-react"
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Line,
  ComposedChart,
  CartesianGrid,
  XAxis,
  YAxis,
  RadialBar,
  RadialBarChart,
  PolarGrid,
  PolarRadiusAxis,
  Label as RechartsLabel,
  LabelList,
} from "recharts"

import { SiteHeader } from "@/components/site-header"
import { USStateMap } from "@/components/analytics/us-state-map"
import { StateDetailsPanel } from "@/components/analytics/state-details-panel"
import { StateVolumeDetailsPanel } from "@/components/analytics/state-volume-details-panel"
import { NationalVolumeOverviewPanel } from "@/components/analytics/national-volume-overview-panel"
import { NationalPerformanceOverviewPanel } from "@/components/analytics/national-performance-overview-panel"
import { LayeredVolumeHeatMap } from "@/components/analytics/layered-volume-heat-map"
import { CostSpeedStateMap } from "@/components/analytics/cost-speed-state-map"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Calendar } from "@/components/ui/calendar"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  ChartLegend,
  ChartLegendContent,
} from "@/components/ui/chart"
import { cn } from "@/lib/utils"
import { sampleShipments, sampleAdditionalServices } from "@/lib/analytics/sample-data"
import {
  getDateRangeFromPreset,
  calculateKPIs,
  calculateSLAMetrics,
  aggregateCarrierPerformance,
  aggregateStatePerformance,
  aggregateFulfillmentTrend,
  aggregateFCFulfillmentMetrics,
  aggregateCostTrend,
  aggregateShipOptionPerformance,
  aggregateTransitTimeDistribution,
  aggregateOrderVolumeByHour,
  aggregateOrderVolumeByDayOfWeek,
  aggregateOrderVolumeByFC,
  aggregateOrderVolumeByStore,
  aggregateDailyOrderVolume,
  aggregateStateVolume,
  aggregateCityVolumeByState,
  aggregateCityVolume,
  aggregateStateCostSpeed,
  aggregateCostByZone,
  // Billing aggregators
  calculateBillingSummary,
  calculateBillingCategoryBreakdown,
  calculateBillingTrend,
  calculatePickPackDistribution,
  calculateCostPerOrderTrend,
  calculateShippingCostByZone,
  calculateAdditionalServicesBreakdown,
  calculateBillingEfficiencyMetrics,
  // Undelivered aggregators
  getUndeliveredShipments,
  getUndeliveredSummary,
  getUndeliveredByCarrier,
  getUndeliveredByStatus,
  getUndeliveredByAge,
} from "@/lib/analytics/aggregators"
import type { DateRangePreset, StateVolumeData, CityVolumeData, ZipCodeVolumeData } from "@/lib/analytics/types"
import { getGranularityForRange, getGranularityLabel } from "@/lib/analytics/types"


export default function AnalyticsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isMounted, setIsMounted] = React.useState(false)

  // Only mount on client to avoid hydration issues with data calculations
  React.useEffect(() => {
    setIsMounted(true)
  }, [])


  // Initialize active tab from URL or default to 'state-performance'
  const [activeTab, setActiveTab] = React.useState(() => {
    return searchParams.get('tab') || 'state-performance'
  })

  const [dateRange, setDateRange] = React.useState<DateRangePreset>('30d')
  // Committed custom range - only updated when user completes a valid selection
  const [customDateRange, setCustomDateRange] = React.useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  })
  // Picker range - temporary state for the calendar, always starts fresh when opening
  const [pickerDateRange, setPickerDateRange] = React.useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  })
  const [isCustomRangeOpen, setIsCustomRangeOpen] = React.useState(false)

  // Deferred date values for heavy calculations - calendar updates instantly, charts update in background
  const deferredDateRange = useDeferredValue(dateRange)
  const deferredCustomDateRange = useDeferredValue(customDateRange)
  const [selectedState, setSelectedState] = React.useState<string | null>(null)
  const [selectedVolumeState, setSelectedVolumeState] = React.useState<string | null>(null)

  // SLA-specific filters
  const [selectedFulfillmentCenters, setSelectedFulfillmentCenters] = React.useState<string[]>([])
  const [selectedOrderTypes, setSelectedOrderTypes] = React.useState<string[]>([])
  const [selectedOrderFulfilled, setSelectedOrderFulfilled] = React.useState<string[]>([])

  // Calculate real KPI data from sample shipments
  // Uses deferred values so calendar UI updates instantly while charts calculate in background
  const currentDateRange = React.useMemo(() => {
    if (deferredDateRange === 'custom' && deferredCustomDateRange.from && deferredCustomDateRange.to) {
      return {
        from: deferredCustomDateRange.from,
        to: deferredCustomDateRange.to,
        preset: 'custom' as DateRangePreset,
      }
    }
    return getDateRangeFromPreset(deferredDateRange)
  }, [deferredDateRange, deferredCustomDateRange])
  const previousDateRange = React.useMemo(() => {
    const daysMap: Record<string, number> = { '7d': 7, '30d': 30, '60d': 60, '90d': 90, '6mo': 182, '1yr': 365 }
    const days = daysMap[deferredDateRange] || 30
    const from = new Date(currentDateRange.from)
    from.setDate(from.getDate() - days)
    const to = new Date(currentDateRange.from)
    to.setDate(to.getDate() - 1)
    return { from, to, preset: deferredDateRange }
  }, [currentDateRange, deferredDateRange])

  const kpiData = React.useMemo(() =>
    calculateKPIs(
      sampleShipments,
      [],
      [],
      [],
      [],
      [],
      currentDateRange,
      previousDateRange
    ),
    [currentDateRange, previousDateRange]
  )

  // Calculate SLA metrics for current period
  const slaMetrics = React.useMemo(() => {
    const filteredShipments = sampleShipments.filter(s =>
      new Date(s.transactionDate) >= currentDateRange.from &&
      new Date(s.transactionDate) <= currentDateRange.to
    )
    return calculateSLAMetrics(filteredShipments)
  }, [currentDateRange])

  // Calculate carrier performance
  const carrierPerformance = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateCarrierPerformance(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  const statePerformance = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateStatePerformance(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  // Calculate fulfillment trend data
  const fulfillmentTrendData = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateFulfillmentTrend(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  // Calculate FC fulfillment metrics
  const fcFulfillmentMetrics = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateFCFulfillmentMetrics(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  // Cost + Speed Analysis data
  const costTrendData = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateCostTrend(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  // Calculate dynamic moving average window size based on date range
  const maWindowSize = React.useMemo(() => {
    const totalDays = Math.round(
      (currentDateRange.to.getTime() - currentDateRange.from.getTime()) / (1000 * 60 * 60 * 24)
    )
    // Formula: ~1/5 of total days, min 1, max 30
    return Math.max(1, Math.min(30, Math.round(totalDays / 5)))
  }, [currentDateRange])

  // Add dynamic moving average to cost trend data
  const costTrendDataWithMA = React.useMemo(() => {
    if (costTrendData.length === 0) return []

    return costTrendData.map((item, index) => {
      // Calculate moving average for avgCostWithSurcharge
      const start = Math.max(0, index - maWindowSize + 1)
      const window = costTrendData.slice(start, index + 1)
      const movingAvg = window.reduce((sum, d) => sum + d.avgCostWithSurcharge, 0) / window.length

      return {
        ...item,
        movingAverage: movingAvg,
      }
    })
  }, [costTrendData, maWindowSize])

  // Calculate overall average cost for the timeframe
  const overallAvgCost = React.useMemo(() => {
    if (costTrendData.length === 0) return null
    const totalCost = costTrendData.reduce((sum, d) => sum + d.avgCostWithSurcharge * d.orderCount, 0)
    const totalOrders = costTrendData.reduce((sum, d) => sum + d.orderCount, 0)
    return totalOrders > 0 ? totalCost / totalOrders : null
  }, [costTrendData])

  // Compute Y-axis domain and ticks for cost chart (10% bottom padding, 5% top padding, 4 ticks)
  const costYAxisConfig = React.useMemo(() => {
    if (costTrendData.length === 0) return { domain: [8, 9.5] as [number, number], ticks: [8, 8.5, 9, 9.5] }

    const allValues = costTrendData.flatMap(d => [d.avgCostBase, d.avgCostWithSurcharge])
    const minVal = Math.min(...allValues)
    const maxVal = Math.max(...allValues)
    const range = maxVal - minVal
    const bottomPadding = range * 0.10 // 10% padding below
    const topPadding = range * 0.05 // 5% padding above

    // Round to nice values for domain
    const domainMin = Math.floor((minVal - bottomPadding) * 20) / 20 // Round down to nearest 0.05
    const domainMax = Math.ceil((maxVal + topPadding) * 20) / 20 // Round up to nearest 0.05

    // Generate 4 evenly spaced ticks
    const tickRange = domainMax - domainMin
    const tickStep = tickRange / 3
    const ticks = [
      Math.round(domainMin * 100) / 100,
      Math.round((domainMin + tickStep) * 100) / 100,
      Math.round((domainMin + tickStep * 2) * 100) / 100,
      Math.round(domainMax * 100) / 100,
    ]

    return { domain: [domainMin, domainMax] as [number, number], ticks }
  }, [costTrendData])

  const shipOptionPerformanceData = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateShipOptionPerformance(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  const transitTimeDistributionData = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateTransitTimeDistribution(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  // Geography Cost + Speed data
  const stateCostSpeedData = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateStateCostSpeed(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  const zoneCostData = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateCostByZone(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  // Billing Analytics data
  const billingSummary = React.useMemo(() => {
    if (!isMounted) return { totalCost: 0, orderCount: 0, costPerOrder: 0, periodChange: { totalCost: 0, orderCount: 0, costPerOrder: 0 } }
    return calculateBillingSummary(sampleShipments, currentDateRange, previousDateRange)
  }, [isMounted, currentDateRange, previousDateRange])

  const billingCategoryBreakdown = React.useMemo(() => {
    if (!isMounted) return []
    return calculateBillingCategoryBreakdown(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  // Calculate billing granularity based on selected date range
  // For custom ranges, calculate based on actual number of days
  const billingGranularity = React.useMemo(() => {
    if (dateRange === 'custom' && customDateRange.from && customDateRange.to) {
      const days = Math.round((customDateRange.to.getTime() - customDateRange.from.getTime()) / (1000 * 60 * 60 * 24))
      if (days <= 30) return 'daily'
      if (days <= 90) return 'weekly'
      return 'monthly'
    }
    return getGranularityForRange(dateRange as any)
  }, [dateRange, customDateRange])

  const billingTrendData = React.useMemo(() => {
    if (!isMounted) return []
    return calculateBillingTrend(sampleShipments, currentDateRange, billingGranularity)
  }, [isMounted, currentDateRange, billingGranularity])

  const pickPackDistribution = React.useMemo(() => {
    if (!isMounted) return []
    return calculatePickPackDistribution(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  const costPerOrderTrend = React.useMemo(() => {
    if (!isMounted) return []
    return calculateCostPerOrderTrend(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  const shippingCostByZone = React.useMemo(() => {
    if (!isMounted) return []
    return calculateShippingCostByZone(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  const additionalServicesBreakdown = React.useMemo(() => {
    if (!isMounted) return []
    return calculateAdditionalServicesBreakdown(sampleAdditionalServices, currentDateRange)
  }, [isMounted, currentDateRange])

  const billingEfficiencyMetrics = React.useMemo(() => {
    if (!isMounted) return { costPerItem: 0, avgItemsPerOrder: 0, shippingAsPercentOfTotal: 0, surchargeRate: 0, insuranceRate: 0 }
    return calculateBillingEfficiencyMetrics(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  // Undelivered Shipments data (current state, not date-filtered)
  const undeliveredSummary = React.useMemo(() => {
    if (!isMounted) return { totalUndelivered: 0, avgDaysInTransit: 0, criticalCount: 0, warningCount: 0, onTrackCount: 0, oldestDays: 0 }
    return getUndeliveredSummary(sampleShipments)
  }, [isMounted])

  const undeliveredByCarrier = React.useMemo(() => {
    if (!isMounted) return []
    return getUndeliveredByCarrier(sampleShipments)
  }, [isMounted])

  const undeliveredByStatus = React.useMemo(() => {
    if (!isMounted) return []
    return getUndeliveredByStatus(sampleShipments)
  }, [isMounted])

  const undeliveredByAge = React.useMemo(() => {
    if (!isMounted) return []
    return getUndeliveredByAge(sampleShipments)
  }, [isMounted])

  const undeliveredShipments = React.useMemo(() => {
    if (!isMounted) return []
    return getUndeliveredShipments(sampleShipments)
  }, [isMounted])

  // Order Volume Analysis data
  const orderVolumeByHour = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateOrderVolumeByHour(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  const orderVolumeByDayOfWeek = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateOrderVolumeByDayOfWeek(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  const orderVolumeByFC = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateOrderVolumeByFC(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  const orderVolumeByStore = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateOrderVolumeByStore(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  const dailyOrderVolume = React.useMemo(() => {
    if (!isMounted) return []
    return aggregateDailyOrderVolume(sampleShipments, currentDateRange)
  }, [isMounted, currentDateRange])

  // Combine all volume data into a single state object to ensure atomic updates
  // Include the date range this data was calculated for to prevent rendering stale data
  const [volumeData, setVolumeData] = React.useState<{
    stateData: StateVolumeData[]
    zipCodeData: ZipCodeVolumeData[]
    cityData: CityVolumeData[]
    calculatedFor: { from: Date; to: Date } | null
  }>({
    stateData: [],
    zipCodeData: [],
    cityData: [],
    calculatedFor: null
  })

  // Calculate all volume data atomically in a single effect
  React.useEffect(() => {
    if (!isMounted) {
      setVolumeData({ stateData: [], zipCodeData: [], cityData: [], calculatedFor: null })
      return
    }

    try {
      // Calculate state and city data together
      // Using city-level aggregation for better scalability (works with 140k+ shipments)
      const stateResult = aggregateStateVolume(sampleShipments, currentDateRange)
      const cityResult = aggregateCityVolume(sampleShipments, currentDateRange)

      // Calculate top cities for selected state (for drill-down view)
      const stateCityResult = selectedVolumeState
        ? aggregateCityVolumeByState(sampleShipments, currentDateRange, selectedVolumeState)
        : []

      // Update all data with the date range it was calculated for
      // Note: Using cityResult as zipCodeData for backward compatibility with LayeredVolumeHeatMap
      setVolumeData({
        stateData: Array.isArray(stateResult) ? stateResult : [],
        zipCodeData: Array.isArray(cityResult) ? cityResult : [], // City data with coordinates
        cityData: Array.isArray(stateCityResult) ? stateCityResult : [],
        calculatedFor: currentDateRange
      })
    } catch (error) {
      console.error('Error aggregating volume data:', error)
      setVolumeData({ stateData: [], zipCodeData: [], cityData: [], calculatedFor: null })
    }
  }, [isMounted, currentDateRange, selectedVolumeState])

  // Generate daily on-time percentage trend data
  const onTimeTrendData = React.useMemo(() => {
    if (!isMounted) return []

    const filteredShipments = sampleShipments.filter(s =>
      new Date(s.transactionDate) >= currentDateRange.from &&
      new Date(s.transactionDate) <= currentDateRange.to
    )

    // Group shipments by day
    const dailyGroups = filteredShipments.reduce((acc, shipment) => {
      const date = shipment.transactionDate
      if (!acc[date]) {
        acc[date] = []
      }
      acc[date].push(shipment)
      return acc
    }, {} as Record<string, typeof filteredShipments>)

    // Calculate daily on-time percentages, filtering out days with too few shipments
    const dailyData = Object.entries(dailyGroups)
      .filter(([_, shipments]) => shipments.length >= 5) // Only include days with 5+ shipments
      .map(([date, shipments]) => {
        const slaResults = calculateSLAMetrics(shipments)
        return {
          date,
          onTimePercent: Math.max(90, slaResults.onTimePercent), // Clamp to minimum 90%
          shipmentCount: shipments.length,
        }
      })

    // Sort by date
    return dailyData.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
  }, [isMounted, currentDateRange, sampleShipments])

  // Y-axis domain - hardcoded to 90-100 for SLA chart
  const yAxisDomain = React.useMemo(() => {
    return [90, 100]
  }, [])

  // Date range options
  const dateRangeOptions = [
    { label: '7D', value: '7d' },
    { label: '30D', value: '30d' },
    { label: '60D', value: '60d' },
    { label: '90D', value: '90d' },
    { label: '6M', value: '6mo' },
    { label: '1Y', value: '1yr' },
  ]

  // Get human-readable label for selected date range
  const dateRangeDisplayLabel = React.useMemo(() => {
    if (dateRange === 'custom' && customDateRange.from && customDateRange.to) {
      return `${format(customDateRange.from, 'MMM d')} - ${format(customDateRange.to, 'MMM d, yyyy')}`
    }
    const labels: Record<string, string> = {
      '7d': 'Last 7 Days',
      '30d': 'Last 30 Days',
      '60d': 'Last 60 Days',
      '90d': 'Last 90 Days',
      '6mo': 'Last 6 Months',
      '1yr': 'Last 12 Months',
    }
    return labels[dateRange] || 'Last 30 Days'
  }, [dateRange, customDateRange])

  // Handle custom range selection - picker state is separate from committed state
  // Only commit to customDateRange and close when selection is complete
  const handleCustomRangeSelect = (range: { from: Date | undefined; to: Date | undefined }) => {
    // Update picker state for display
    setPickerDateRange(range)

    // If we have a complete range with both dates different, commit and close
    if (range.from && range.to && range.from.getTime() !== range.to.getTime()) {
      setCustomDateRange(range)
      setDateRange('custom' as DateRangePreset)
      setIsCustomRangeOpen(false)
    }
  }

  // Format custom range display
  const customRangeLabel = React.useMemo(() => {
    if (customDateRange.from && customDateRange.to) {
      return `${format(customDateRange.from, 'MMM d')} - ${format(customDateRange.to, 'MMM d, yyyy')}`
    }
    return 'Custom Range'
  }, [customDateRange])

  // Check if volume data is current (matches the active date range)
  // This prevents rendering with stale data during recalculation
  const isVolumeDataCurrent = React.useMemo(() => {
    return volumeData.calculatedFor &&
      volumeData.calculatedFor.from.getTime() === currentDateRange.from.getTime() &&
      volumeData.calculatedFor.to.getTime() === currentDateRange.to.getTime()
  }, [volumeData.calculatedFor, currentDateRange])

  // Handle tab change and update URL
  const handleTabChange = (value: string) => {
    setActiveTab(value)
    const params = new URLSearchParams(searchParams.toString())
    params.set('tab', value)
    router.push(`?${params.toString()}`, { scroll: false })
  }

  return (
    <>
      <SiteHeader sectionName="Analytics" />
      <div className="flex flex-1 flex-col overflow-x-clip">
        <div className="@container/main flex flex-1 flex-col w-full">
          <div className="flex flex-col gap-4 w-full px-4 lg:px-6">
            {/* Tabs for Different Reports */}
            <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
              {/* Sticky Header: Tabs + Date Filter */}
              <div className="sticky top-0 z-20 bg-surface pb-4 -mx-4 px-4 lg:-mx-6 lg:px-6 pt-4">
                <TabsList className="grid w-full grid-cols-2 lg:grid-cols-7 h-auto gap-1 bg-surface-elevated border border-border">
                  <TabsTrigger value="state-performance" className="text-xs sm:text-sm">
                    Performance by State
                  </TabsTrigger>
                  <TabsTrigger value="cost-speed" className="text-xs sm:text-sm">
                    Cost + Speed
                  </TabsTrigger>
                  <TabsTrigger value="order-volume" className="text-xs sm:text-sm">
                    Order Volume
                  </TabsTrigger>
                  <TabsTrigger value="carriers-zones" className="text-xs sm:text-sm">
                    Carriers + Zones
                  </TabsTrigger>
                  <TabsTrigger value="financials" className="text-xs sm:text-sm">
                    Financials
                  </TabsTrigger>
                  <TabsTrigger value="sla" className="text-xs sm:text-sm">
                    Fulfillment SLAs
                  </TabsTrigger>
                  <TabsTrigger value="undelivered" className="text-xs sm:text-sm">
                    Undelivered
                  </TabsTrigger>
                </TabsList>

                {/* Shared Date Filter */}
                <div className="flex items-center gap-2 mt-4 px-1">
                  {/* Date Range Filter - Desktop (inline buttons) */}
                  <div className="hidden lg:flex items-center gap-2">
                    <span className="text-sm font-medium text-muted-foreground">Date:</span>
                    <div className="inline-flex rounded-md border border-border overflow-hidden">
                      {dateRangeOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            setDateRange(option.value as any)
                            setCustomDateRange({ from: undefined, to: undefined })
                            setIsCustomRangeOpen(false)
                          }}
                          className={cn(
                            "px-2.5 py-1 text-sm font-medium transition-all border-r border-border last:border-r-0",
                            dateRange === option.value
                              ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                              : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                          )}
                        >
                          {option.label}
                        </button>
                      ))}
                      <Popover
                        open={isCustomRangeOpen}
                        onOpenChange={(open) => {
                          if (open) {
                            // Clear picker state when opening - always start fresh selection
                            setPickerDateRange({ from: undefined, to: undefined })
                            setIsCustomRangeOpen(true)
                          } else {
                            // Closing without completing - just close (customDateRange unchanged)
                            setIsCustomRangeOpen(false)
                          }
                        }}
                        modal={false}
                      >
                        <PopoverTrigger asChild>
                          <button
                            className={cn(
                              "px-2.5 py-1 text-sm font-medium transition-all",
                              dateRange === 'custom'
                                ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-100"
                                : "bg-background text-muted-foreground hover:bg-muted hover:text-foreground"
                            )}
                          >
                            {dateRange === 'custom' ? customRangeLabel : 'Custom'}
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
                            {(pickerDateRange.from || pickerDateRange.to) && (
                              <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md">
                                <div className="flex-1 text-xs">
                                  <span className="text-muted-foreground">From: </span>
                                  <span className="font-medium">
                                    {pickerDateRange.from ? format(pickerDateRange.from, 'MMM d, yyyy') : '—'}
                                  </span>
                                </div>
                                <div className="flex-1 text-xs">
                                  <span className="text-muted-foreground">To: </span>
                                  <span className="font-medium">
                                    {pickerDateRange.to ? format(pickerDateRange.to, 'MMM d, yyyy') : '—'}
                                  </span>
                                </div>
                                <button
                                  onClick={() => {
                                    setPickerDateRange({ from: undefined, to: undefined })
                                    setCustomDateRange({ from: undefined, to: undefined })
                                    setDateRange('30d')
                                    setIsCustomRangeOpen(false)
                                  }}
                                  className="px-2 py-1 text-xs bg-background hover:bg-muted rounded border text-muted-foreground hover:text-foreground transition-colors"
                                >
                                  Reset
                                </button>
                              </div>
                            )}
                            <div className="text-[11px] text-muted-foreground px-1">
                              {pickerDateRange.from && !pickerDateRange.to
                                ? "Click a date to select end date"
                                : "Click a date to select start date"}
                            </div>
                            <Calendar
                              mode="range"
                              selected={{
                                from: pickerDateRange.from,
                                to: pickerDateRange.to,
                              }}
                              onSelect={(range) => handleCustomRangeSelect({ from: range?.from, to: range?.to })}
                              numberOfMonths={2}
                            />
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                  </div>

                  {/* Date Range Filter - Mobile/Tablet (dropdown) */}
                  <div className="lg:hidden">
                    <Button variant="outline" size="sm" className="h-8"
                      onClick={() => {
                        // Simple mobile date picker - cycle through presets
                        const presets = ['7d', '30d', '60d', '90d', '6mo', '1yr'] as const
                        const currentIndex = presets.indexOf(dateRange as any)
                        const nextIndex = (currentIndex + 1) % presets.length
                        setDateRange(presets[nextIndex])
                        setCustomDateRange({ from: undefined, to: undefined })
                      }}
                    >
                      <CalendarIcon className="mr-1 h-4 w-4" />
                      <span className="text-sm">{dateRangeOptions.find(o => o.value === dateRange)?.label || 'Date'}</span>
                    </Button>
                  </div>

                  {/* Conditional Filters - Shown based on active tab */}
                  {/* Fulfillment Center Filter - SLA, Undelivered tabs */}
                  {(activeTab === 'sla' || activeTab === 'undelivered') && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8">
                          <span className="text-sm lg:hidden">FC</span>
                          <span className="text-sm hidden lg:inline">Fulfillment Center</span>
                          {selectedFulfillmentCenters.length > 0 && (
                            <span className="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                              {selectedFulfillmentCenters.length}
                            </span>
                          )}
                          <ChevronDownIcon className="ml-1 h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-56" align="start">
                        <div className="space-y-2">
                          {['FC-East', 'FC-West', 'FC-Central', 'FC-South'].map((fc) => (
                            <div key={fc} className="flex items-center space-x-2">
                              <Checkbox
                                id={`fc-header-${fc}`}
                                checked={selectedFulfillmentCenters.includes(fc)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedFulfillmentCenters([...selectedFulfillmentCenters, fc])
                                  } else {
                                    setSelectedFulfillmentCenters(selectedFulfillmentCenters.filter(f => f !== fc))
                                  }
                                }}
                              />
                              <Label
                                htmlFor={`fc-header-${fc}`}
                                className="text-sm font-normal cursor-pointer"
                              >
                                {fc}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}

                  {/* Order Type Filter - SLA tab */}
                  {activeTab === 'sla' && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8">
                          <span className="text-sm lg:hidden">Type</span>
                          <span className="text-sm hidden lg:inline">Order Type</span>
                          {selectedOrderTypes.length > 0 && (
                            <span className="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                              {selectedOrderTypes.length}
                            </span>
                          )}
                          <ChevronDownIcon className="ml-1 h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-40" align="start">
                        <div className="space-y-2">
                          {['D2C', 'B2C'].map((type) => (
                            <div key={type} className="flex items-center space-x-2">
                              <Checkbox
                                id={`type-header-${type}`}
                                checked={selectedOrderTypes.includes(type)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedOrderTypes([...selectedOrderTypes, type])
                                  } else {
                                    setSelectedOrderTypes(selectedOrderTypes.filter(t => t !== type))
                                  }
                                }}
                              />
                              <Label
                                htmlFor={`type-header-${type}`}
                                className="text-sm font-normal cursor-pointer"
                              >
                                {type}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}

                  {/* Order Fulfilled Filter - SLA, Undelivered tabs */}
                  {(activeTab === 'sla' || activeTab === 'undelivered') && (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8">
                          <span className="text-sm lg:hidden">Fulfilled?</span>
                          <span className="text-sm hidden lg:inline">Order Fulfilled?</span>
                          {selectedOrderFulfilled.length > 0 && (
                            <span className="ml-1 rounded-full bg-primary px-1.5 text-xs text-primary-foreground">
                              {selectedOrderFulfilled.length}
                            </span>
                          )}
                          <ChevronDownIcon className="ml-1 h-4 w-4" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-40" align="start">
                        <div className="space-y-2">
                          {['Yes', 'No'].map((status) => (
                            <div key={status} className="flex items-center space-x-2">
                              <Checkbox
                                id={`fulfilled-header-${status}`}
                                checked={selectedOrderFulfilled.includes(status)}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setSelectedOrderFulfilled([...selectedOrderFulfilled, status])
                                  } else {
                                    setSelectedOrderFulfilled(selectedOrderFulfilled.filter(s => s !== status))
                                  }
                                }}
                              />
                              <Label
                                htmlFor={`fulfilled-header-${status}`}
                                className="text-sm font-normal cursor-pointer"
                              >
                                {status}
                              </Label>
                            </div>
                          ))}
                        </div>
                      </PopoverContent>
                    </Popover>
                  )}
                </div>
              </div>

              {/* Tab 1: Financials */}
              <TabsContent value="financials" className="space-y-7 mt-4">
                {/* Feature Row: Cost Breakdown + Summary Panel */}
                <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
                  {/* Cost Breakdown - Stacked Area Chart */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">{getGranularityLabel(billingGranularity)} Cost Breakdown</CardTitle>
                      <CardDescription>All fee categories over time</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer
                        config={{
                          shipping: { label: "Shipping", color: "hsl(220, 85%, 55%)" },
                          warehousing: { label: "Warehousing", color: "hsl(145, 65%, 42%)" },
                          extraPicks: { label: "Extra Picks", color: "hsl(280, 70%, 55%)" },
                          multiHubIQ: { label: "MultiHub IQ", color: "hsl(185, 80%, 45%)" },
                          b2b: { label: "B2B", color: "hsl(45, 90%, 50%)" },
                          vasKitting: { label: "VAS/Kitting", color: "hsl(25, 90%, 55%)" },
                          receiving: { label: "Receiving", color: "hsl(340, 75%, 55%)" },
                          dutyTax: { label: "Duty/Tax", color: "hsl(200, 60%, 35%)" },
                          credit: { label: "Credit", color: "hsl(120, 60%, 45%)" },
                        }}
                        className="h-[340px] w-full"
                      >
                        <AreaChart data={billingTrendData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="fillShipping" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(220, 85%, 55%)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="hsl(220, 85%, 55%)" stopOpacity={0.2} />
                            </linearGradient>
                            <linearGradient id="fillWarehousing" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(145, 65%, 42%)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="hsl(145, 65%, 42%)" stopOpacity={0.2} />
                            </linearGradient>
                            <linearGradient id="fillExtraPicks" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(280, 70%, 55%)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="hsl(280, 70%, 55%)" stopOpacity={0.2} />
                            </linearGradient>
                            <linearGradient id="fillMultiHubIQ" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(185, 80%, 45%)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="hsl(185, 80%, 45%)" stopOpacity={0.2} />
                            </linearGradient>
                            <linearGradient id="fillB2B" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(45, 90%, 50%)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="hsl(45, 90%, 50%)" stopOpacity={0.2} />
                            </linearGradient>
                            <linearGradient id="fillVasKitting" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(25, 90%, 55%)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="hsl(25, 90%, 55%)" stopOpacity={0.2} />
                            </linearGradient>
                            <linearGradient id="fillReceiving" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(340, 75%, 55%)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="hsl(340, 75%, 55%)" stopOpacity={0.2} />
                            </linearGradient>
                            <linearGradient id="fillDutyTax" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(200, 60%, 35%)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="hsl(200, 60%, 35%)" stopOpacity={0.2} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} tickMargin={8} fontSize={11} />
                          <YAxis tickLine={false} axisLine={false} tickMargin={8} fontSize={11} tickFormatter={(value) => `$${(value / 1000).toFixed(0)}k`} />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null
                              const data = payload[0].payload
                              return (
                                <div className="bg-background border rounded-lg shadow-lg p-3 space-y-2">
                                  <div className="font-semibold">{data.monthLabel}</div>
                                  <div className="space-y-1 text-sm">
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Total</span>
                                      <span className="font-bold tabular-nums">${data.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="border-t pt-1 mt-1 space-y-1">
                                      <div className="flex items-center justify-between gap-4">
                                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(220, 85%, 55%)' }} />Shipping</span>
                                        <span className="tabular-nums">${data.shipping.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                      </div>
                                      <div className="flex items-center justify-between gap-4">
                                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(145, 65%, 42%)' }} />Warehousing</span>
                                        <span className="tabular-nums">${data.warehousing.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                      </div>
                                      <div className="flex items-center justify-between gap-4">
                                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(280, 70%, 55%)' }} />Extra Picks</span>
                                        <span className="tabular-nums">${data.extraPicks.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                      </div>
                                      {data.multiHubIQ > 0 && (
                                        <div className="flex items-center justify-between gap-4">
                                          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(185, 80%, 45%)' }} />MultiHub IQ</span>
                                          <span className="tabular-nums">${data.multiHubIQ.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                      )}
                                      {data.b2b > 0 && (
                                        <div className="flex items-center justify-between gap-4">
                                          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(45, 90%, 50%)' }} />B2B</span>
                                          <span className="tabular-nums">${data.b2b.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                      )}
                                      <div className="flex items-center justify-between gap-4">
                                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(25, 90%, 55%)' }} />VAS/Kitting</span>
                                        <span className="tabular-nums">${data.vasKitting.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                      </div>
                                      <div className="flex items-center justify-between gap-4">
                                        <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(340, 75%, 55%)' }} />Receiving</span>
                                        <span className="tabular-nums">${data.receiving.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                      </div>
                                      {data.dutyTax > 0 && (
                                        <div className="flex items-center justify-between gap-4">
                                          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(200, 60%, 35%)' }} />Duty/Tax</span>
                                          <span className="tabular-nums">${data.dutyTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                      )}
                                      {data.credit < 0 && (
                                        <div className="flex items-center justify-between gap-4">
                                          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'hsl(120, 60%, 45%)' }} />Credit</span>
                                          <span className="tabular-nums text-green-600">${data.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              )
                            }}
                          />
                          <Area type="monotone" dataKey="shipping" stackId="1" stroke="hsl(220, 85%, 55%)" fill="url(#fillShipping)" />
                          <Area type="monotone" dataKey="warehousing" stackId="1" stroke="hsl(145, 65%, 42%)" fill="url(#fillWarehousing)" />
                          <Area type="monotone" dataKey="extraPicks" stackId="1" stroke="hsl(280, 70%, 55%)" fill="url(#fillExtraPicks)" />
                          <Area type="monotone" dataKey="multiHubIQ" stackId="1" stroke="hsl(185, 80%, 45%)" fill="url(#fillMultiHubIQ)" />
                          <Area type="monotone" dataKey="b2b" stackId="1" stroke="hsl(45, 90%, 50%)" fill="url(#fillB2B)" />
                          <Area type="monotone" dataKey="vasKitting" stackId="1" stroke="hsl(25, 90%, 55%)" fill="url(#fillVasKitting)" />
                          <Area type="monotone" dataKey="receiving" stackId="1" stroke="hsl(340, 75%, 55%)" fill="url(#fillReceiving)" />
                          <Area type="monotone" dataKey="dutyTax" stackId="1" stroke="hsl(200, 60%, 35%)" fill="url(#fillDutyTax)" />
                        </AreaChart>
                      </ChartContainer>
                      {/* Legend */}
                      <div className="flex flex-wrap justify-center gap-3 mt-2 text-xs">
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(220, 85%, 55%)' }} /><span>Shipping</span></div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(145, 65%, 42%)' }} /><span>Warehousing</span></div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(280, 70%, 55%)' }} /><span>Extra Picks</span></div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(185, 80%, 45%)' }} /><span>MultiHub IQ</span></div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(45, 90%, 50%)' }} /><span>B2B</span></div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(25, 90%, 55%)' }} /><span>VAS/Kitting</span></div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(340, 75%, 55%)' }} /><span>Receiving</span></div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(200, 60%, 35%)' }} /><span>Duty/Tax</span></div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(120, 60%, 45%)' }} /><span>Credit</span></div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Summary Panel */}
                  <Card className="h-fit">
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg">Period Summary</CardTitle>
                      <CardDescription>{dateRangeDisplayLabel}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      {/* Total Cost */}
                      <div className="text-center py-4 px-4 bg-muted/50 rounded-lg">
                        <div className="text-xs text-muted-foreground mb-1">Total Cost</div>
                        <div className="text-3xl font-bold tabular-nums">
                          ${billingSummary.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </div>
                        <div className={cn(
                          "text-xs mt-1",
                          billingSummary.periodChange.totalCost > 0 ? "text-red-500" : billingSummary.periodChange.totalCost < 0 ? "text-green-500" : "text-muted-foreground"
                        )}>
                          {billingSummary.periodChange.totalCost > 0 ? "+" : ""}{billingSummary.periodChange.totalCost.toFixed(1)}% vs prev period
                        </div>
                      </div>

                      {/* Orders & Cost per Order */}
                      <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 bg-muted/30 rounded-lg">
                          <div className="text-[10px] text-muted-foreground">Orders</div>
                          <div className="text-lg font-bold tabular-nums">{billingSummary.orderCount.toLocaleString()}</div>
                          <div className={cn(
                            "text-[10px]",
                            billingSummary.periodChange.orderCount > 0 ? "text-green-500" : billingSummary.periodChange.orderCount < 0 ? "text-red-500" : "text-muted-foreground"
                          )}>
                            {billingSummary.periodChange.orderCount > 0 ? "+" : ""}{billingSummary.periodChange.orderCount.toFixed(1)}%
                          </div>
                        </div>
                        <div className="p-3 bg-muted/30 rounded-lg">
                          <div className="text-[10px] text-muted-foreground">Cost per Order</div>
                          <div className="text-lg font-bold tabular-nums">${billingSummary.costPerOrder.toFixed(2)}</div>
                          <div className={cn(
                            "text-[10px]",
                            billingSummary.periodChange.costPerOrder > 0 ? "text-red-500" : billingSummary.periodChange.costPerOrder < 0 ? "text-green-500" : "text-muted-foreground"
                          )}>
                            {billingSummary.periodChange.costPerOrder > 0 ? "+" : ""}{billingSummary.periodChange.costPerOrder.toFixed(1)}%
                          </div>
                        </div>
                      </div>

                      {/* Efficiency Metrics */}
                      <div className="space-y-2 pt-2 border-t">
                        <div className="text-xs font-semibold">Efficiency Metrics</div>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Cost per Item</span>
                            <span className="font-medium tabular-nums">${billingEfficiencyMetrics.costPerItem.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Avg Items/Order</span>
                            <span className="font-medium tabular-nums">{billingEfficiencyMetrics.avgItemsPerOrder.toFixed(2)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Shipping % of Total</span>
                            <span className="font-medium tabular-nums">{billingEfficiencyMetrics.shippingAsPercentOfTotal.toFixed(1)}%</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Orders w/ Surcharge</span>
                            <span className="font-medium tabular-nums">{billingEfficiencyMetrics.surchargeRate.toFixed(1)}%</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Orders w/ Insurance</span>
                            <span className="font-medium tabular-nums">{billingEfficiencyMetrics.insuranceRate.toFixed(1)}%</span>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Row 2: Cost Distribution + Pick/Pack + Cost per Order Trend */}
                <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                  {/* Cost Distribution Donut */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Cost Distribution</CardTitle>
                      <CardDescription>Breakdown by category</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer
                        config={{
                          amount: { label: "Amount" },
                        }}
                        className="h-[240px] w-full"
                      >
                        <RadialBarChart
                          data={billingCategoryBreakdown.slice(0, 5).map((cat, idx) => ({
                            ...cat,
                            fill: [
                              'hsl(217, 91%, 60%)',
                              'hsl(142, 71%, 45%)',
                              'hsl(262, 83%, 58%)',
                              'hsl(25, 95%, 53%)',
                              'hsl(340, 82%, 52%)',
                            ][idx],
                          }))}
                          innerRadius={50}
                          outerRadius={100}
                          barSize={12}
                          startAngle={90}
                          endAngle={-270}
                        >
                          <PolarGrid gridType="circle" radialLines={false} stroke="none" />
                          <RadialBar dataKey="percent" background cornerRadius={6} />
                          <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
                            <RechartsLabel
                              content={({ viewBox }) => {
                                if (viewBox && "cx" in viewBox && "cy" in viewBox) {
                                  return (
                                    <text x={viewBox.cx} y={viewBox.cy} textAnchor="middle" dominantBaseline="middle">
                                      <tspan x={viewBox.cx} y={viewBox.cy} className="fill-foreground text-xl font-bold">
                                        ${(billingSummary.totalCost / 1000).toFixed(0)}k
                                      </tspan>
                                      <tspan x={viewBox.cx} y={(viewBox.cy || 0) + 18} className="fill-muted-foreground text-xs">
                                        Total
                                      </tspan>
                                    </text>
                                  )
                                }
                              }}
                            />
                          </PolarRadiusAxis>
                        </RadialBarChart>
                      </ChartContainer>
                      {/* Legend */}
                      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-2 text-xs">
                        {billingCategoryBreakdown.slice(0, 6).map((cat, idx) => (
                          <div key={cat.category} className="flex items-center justify-between">
                            <span className="flex items-center gap-1.5 truncate">
                              <span className="w-2 h-2 rounded-full flex-shrink-0" style={{
                                backgroundColor: [
                                  'hsl(217, 91%, 60%)',
                                  'hsl(142, 71%, 45%)',
                                  'hsl(262, 83%, 58%)',
                                  'hsl(25, 95%, 53%)',
                                  'hsl(340, 82%, 52%)',
                                  'hsl(173, 80%, 40%)',
                                ][idx]
                              }} />
                              <span className="truncate">{cat.category}</span>
                            </span>
                            <span className="font-medium tabular-nums ml-2">{cat.percent.toFixed(1)}%</span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Pick/Pack Distribution */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Pick & Pack Distribution</CardTitle>
                      <CardDescription>Orders by item count</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer
                        config={{
                          orderCount: { label: "Orders", color: "hsl(262, 83%, 58%)" },
                        }}
                        className="h-[240px] w-full"
                      >
                        <BarChart data={pickPackDistribution} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                          <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => v.toLocaleString()} />
                          <YAxis type="category" dataKey="itemCount" tickLine={false} axisLine={false} fontSize={11} width={60} />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null
                              const data = payload[0].payload
                              return (
                                <div className="bg-background border rounded-lg shadow-lg p-3 space-y-2">
                                  <div className="font-semibold">{data.itemCount}</div>
                                  <div className="space-y-1 text-sm">
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Orders</span>
                                      <span className="font-medium tabular-nums">{data.orderCount.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Percentage</span>
                                      <span className="font-medium tabular-nums">{data.percent.toFixed(1)}%</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Unit Price</span>
                                      <span className="font-medium tabular-nums">${data.unitPrice.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Total Cost</span>
                                      <span className="font-medium tabular-nums">${data.totalCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                  </div>
                                </div>
                              )
                            }}
                          />
                          <Bar dataKey="orderCount" fill="hsl(262, 83%, 58%)" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ChartContainer>
                      {/* Stats */}
                      <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                        {pickPackDistribution.map((pp) => (
                          <div key={pp.itemCount} className="p-2 bg-muted/30 rounded">
                            <div className="text-[10px] text-muted-foreground">{pp.itemCount}</div>
                            <div className="text-sm font-semibold tabular-nums">{pp.percent.toFixed(1)}%</div>
                            <div className="text-[10px] text-muted-foreground">${pp.unitPrice.toFixed(2)}/ea</div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Cost per Order Trend */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Cost per Order Trend</CardTitle>
                      <CardDescription>Average cost over time</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer
                        config={{
                          costPerOrder: { label: "Cost per Order", color: "hsl(142, 71%, 45%)" },
                        }}
                        className="h-[240px] w-full"
                      >
                        <AreaChart data={costPerOrderTrend} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                          <defs>
                            <linearGradient id="fillCostPerOrder" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.8} />
                              <stop offset="95%" stopColor="hsl(142, 71%, 45%)" stopOpacity={0.1} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="monthLabel" tickLine={false} axisLine={false} fontSize={10} tickMargin={8} />
                          <YAxis tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => `$${v.toFixed(0)}`} domain={['dataMin - 1', 'dataMax + 1']} />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null
                              const data = payload[0].payload
                              return (
                                <div className="bg-background border rounded-lg shadow-lg p-3 space-y-2">
                                  <div className="font-semibold">{data.monthLabel}</div>
                                  <div className="space-y-1 text-sm">
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Cost per Order</span>
                                      <span className="font-medium tabular-nums">${data.costPerOrder.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Orders</span>
                                      <span className="font-medium tabular-nums">{data.orderCount.toLocaleString()}</span>
                                    </div>
                                  </div>
                                </div>
                              )
                            }}
                          />
                          <Area type="monotone" dataKey="costPerOrder" stroke="hsl(142, 71%, 45%)" fill="url(#fillCostPerOrder)" strokeWidth={2} />
                        </AreaChart>
                      </ChartContainer>
                      {/* Min/Max indicators */}
                      <div className="flex justify-between mt-3 text-xs">
                        <div className="p-2 bg-green-500/10 rounded">
                          <div className="text-[10px] text-muted-foreground">Lowest</div>
                          <div className="font-semibold text-green-600 tabular-nums">
                            ${costPerOrderTrend.length > 0 ? Math.min(...costPerOrderTrend.map(d => d.costPerOrder)).toFixed(2) : '0.00'}
                          </div>
                        </div>
                        <div className="p-2 bg-muted/30 rounded">
                          <div className="text-[10px] text-muted-foreground">Average</div>
                          <div className="font-semibold tabular-nums">
                            ${costPerOrderTrend.length > 0 ? (costPerOrderTrend.reduce((s, d) => s + d.costPerOrder, 0) / costPerOrderTrend.length).toFixed(2) : '0.00'}
                          </div>
                        </div>
                        <div className="p-2 bg-red-500/10 rounded">
                          <div className="text-[10px] text-muted-foreground">Highest</div>
                          <div className="font-semibold text-red-600 tabular-nums">
                            ${costPerOrderTrend.length > 0 ? Math.max(...costPerOrderTrend.map(d => d.costPerOrder)).toFixed(2) : '0.00'}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Row 3: Shipping by Zone + Surcharge Breakdown */}
                <div className="grid gap-6 md:grid-cols-2">
                  {/* Shipping Cost by Zone */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Shipping Cost by Zone</CardTitle>
                      <CardDescription>Zone-based shipping analysis</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer
                        config={{
                          avgShipping: { label: "Avg Shipping", color: "hsl(217, 91%, 60%)" },
                        }}
                        className="h-[260px] w-full"
                      >
                        <ComposedChart data={shippingCostByZone} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="zone" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => `Zone ${v}`} />
                          <YAxis yAxisId="left" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => `$${v.toFixed(0)}`} />
                          <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => v.toLocaleString()} />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null
                              const data = payload[0].payload
                              return (
                                <div className="bg-background border rounded-lg shadow-lg p-3 space-y-2">
                                  <div className="font-semibold">Zone {data.zone} - {data.zoneLabel}</div>
                                  <div className="space-y-1 text-sm">
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Average Shipping</span>
                                      <span className="font-medium tabular-nums">${data.avgShipping.toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Orders</span>
                                      <span className="font-medium tabular-nums">{data.orderCount.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">% of Orders</span>
                                      <span className="font-medium tabular-nums">{data.percent.toFixed(1)}%</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Total Shipping</span>
                                      <span className="font-medium tabular-nums">${data.totalShipping.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                  </div>
                                </div>
                              )
                            }}
                          />
                          <Bar yAxisId="left" dataKey="avgShipping" fill="hsl(217, 91%, 60%)" radius={[4, 4, 0, 0]} />
                          <Line yAxisId="right" type="monotone" dataKey="orderCount" stroke="hsl(0, 0%, 20%)" strokeWidth={2} dot={{ fill: 'hsl(0, 0%, 20%)', strokeWidth: 0, r: 4 }} />
                        </ComposedChart>
                      </ChartContainer>
                      <div className="flex justify-center gap-6 mt-2 text-xs">
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded" style={{ backgroundColor: 'hsl(217, 91%, 60%)' }} /><span>Avg Shipping Cost</span></div>
                        <div className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full" style={{ backgroundColor: 'hsl(0, 0%, 20%)' }} /><span>Order Volume</span></div>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Additional Services Breakdown */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Additional Services Breakdown</CardTitle>
                      <CardDescription>Breakdown of additional service fees</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer
                        config={{
                          amount: { label: "Amount", color: "hsl(25, 95%, 53%)" },
                        }}
                        className="h-[200px] w-full"
                      >
                        <BarChart data={additionalServicesBreakdown} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} />
                          <XAxis type="number" tickLine={false} axisLine={false} fontSize={11} tickFormatter={(v) => `$${v.toLocaleString()}`} />
                          <YAxis type="category" dataKey="category" tickLine={false} axisLine={false} fontSize={10} width={110} />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null
                              const data = payload[0].payload
                              return (
                                <div className="bg-background border rounded-lg shadow-lg p-3 space-y-2">
                                  <div className="font-semibold">{data.category}</div>
                                  <div className="space-y-1 text-sm">
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Total Amount</span>
                                      <span className="font-medium tabular-nums">${data.amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Transactions</span>
                                      <span className="font-medium tabular-nums">{data.transactionCount.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">% of Total</span>
                                      <span className="font-medium tabular-nums">{data.percent.toFixed(1)}%</span>
                                    </div>
                                  </div>
                                </div>
                              )
                            }}
                          />
                          <Bar dataKey="amount" fill="hsl(25, 95%, 53%)" radius={[0, 4, 4, 0]} />
                        </BarChart>
                      </ChartContainer>
                      {/* Additional services summary stats */}
                      <div className="grid grid-cols-3 gap-3 mt-4 pt-3 border-t">
                        <div className="text-center">
                          <div className="text-[10px] text-muted-foreground">Total Fees</div>
                          <div className="text-sm font-bold tabular-nums">
                            ${additionalServicesBreakdown.reduce((s, d) => s + d.amount, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-muted-foreground">Transactions</div>
                          <div className="text-sm font-bold tabular-nums">
                            {additionalServicesBreakdown.reduce((s, d) => s + d.transactionCount, 0).toLocaleString()}
                          </div>
                        </div>
                        <div className="text-center">
                          <div className="text-[10px] text-muted-foreground">Avg Fee</div>
                          <div className="text-sm font-bold tabular-nums">
                            ${additionalServicesBreakdown.length > 0 && additionalServicesBreakdown.reduce((s, d) => s + d.transactionCount, 0) > 0
                              ? (additionalServicesBreakdown.reduce((s, d) => s + d.amount, 0) / additionalServicesBreakdown.reduce((s, d) => s + d.transactionCount, 0)).toFixed(2)
                              : '0.00'}
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Row 4: Detailed Breakdown Table */}
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">{getGranularityLabel(billingGranularity)} Fee Breakdown</CardTitle>
                        <CardDescription>Detailed breakdown by category</CardDescription>
                      </div>
                      <Button variant="outline" size="sm" className="h-8">
                        <DownloadIcon className="w-4 h-4 mr-1" />
                        Export
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="pt-[7px]">
                    <div className="rounded-md border overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="text-left p-3 font-medium">{billingGranularity === 'daily' ? 'Date' : billingGranularity === 'weekly' ? 'Week' : 'Month'}</th>
                              <th className="text-right p-3 font-medium">Orders</th>
                              <th className="text-right p-3 font-medium">Shipping</th>
                              <th className="text-right p-3 font-medium">Warehousing</th>
                              <th className="text-right p-3 font-medium">Extra Picks</th>
                              <th className="text-right p-3 font-medium">MultiHub IQ</th>
                              <th className="text-right p-3 font-medium">B2B</th>
                              <th className="text-right p-3 font-medium">VAS/Kitting</th>
                              <th className="text-right p-3 font-medium">Receiving</th>
                              <th className="text-right p-3 font-medium">Duty/Tax</th>
                              <th className="text-right p-3 font-medium">Credit</th>
                              <th className="text-right p-3 font-medium">Total</th>
                              <th className="text-right p-3 font-medium">$/Order</th>
                            </tr>
                          </thead>
                          <tbody>
                            {billingTrendData.map((month, idx) => (
                              <tr key={month.month} className={cn("border-b", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                <td className="p-3 font-medium">{month.monthLabel}</td>
                                <td className="p-3 text-right tabular-nums">{month.orderCount.toLocaleString()}</td>
                                <td className="p-3 text-right tabular-nums">${month.shipping.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="p-3 text-right tabular-nums">${month.warehousing.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="p-3 text-right tabular-nums">${month.extraPicks.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="p-3 text-right tabular-nums">${month.multiHubIQ.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="p-3 text-right tabular-nums">${month.b2b.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="p-3 text-right tabular-nums">${month.vasKitting.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="p-3 text-right tabular-nums">${month.receiving.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="p-3 text-right tabular-nums">${month.dutyTax.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className={cn("p-3 text-right tabular-nums", month.credit < 0 ? "text-green-600" : "")}>
                                  ${month.credit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="p-3 text-right tabular-nums font-semibold">${month.total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td className="p-3 text-right tabular-nums text-muted-foreground">${month.costPerOrder.toFixed(2)}</td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot>
                            <tr className="border-t-2 bg-muted/30 font-semibold">
                              <td className="p-3">Total</td>
                              <td className="p-3 text-right tabular-nums">{billingTrendData.reduce((s, m) => s + m.orderCount, 0).toLocaleString()}</td>
                              <td className="p-3 text-right tabular-nums">${billingTrendData.reduce((s, m) => s + m.shipping, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right tabular-nums">${billingTrendData.reduce((s, m) => s + m.warehousing, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right tabular-nums">${billingTrendData.reduce((s, m) => s + m.extraPicks, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right tabular-nums">${billingTrendData.reduce((s, m) => s + m.multiHubIQ, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right tabular-nums">${billingTrendData.reduce((s, m) => s + m.b2b, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right tabular-nums">${billingTrendData.reduce((s, m) => s + m.vasKitting, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right tabular-nums">${billingTrendData.reduce((s, m) => s + m.receiving, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right tabular-nums">${billingTrendData.reduce((s, m) => s + m.dutyTax, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right tabular-nums text-green-600">${billingTrendData.reduce((s, m) => s + m.credit, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right tabular-nums">${billingTrendData.reduce((s, m) => s + m.total, 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                              <td className="p-3 text-right tabular-nums text-muted-foreground">
                                ${billingTrendData.length > 0 ? (billingTrendData.reduce((s, m) => s + m.total, 0) / billingTrendData.reduce((s, m) => s + m.orderCount, 0)).toFixed(2) : '0.00'}
                              </td>
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Tab 2: Cost & Speed Analysis */}
              <TabsContent value="cost-speed" className="space-y-7 mt-7">
                {/* Average Cost over Time */}
                <Card>
                  <CardHeader className="flex flex-row items-start justify-between">
                    <div>
                      <CardTitle className="text-base">Average Cost over Time</CardTitle>
                      <CardDescription>Average cost per order with and without surcharges</CardDescription>
                    </div>
                    {overallAvgCost !== null && (
                      <div className="text-right">
                        <div className="text-xs text-muted-foreground">Period Average</div>
                        <div className="text-lg font-bold">${overallAvgCost.toFixed(2)}</div>
                      </div>
                    )}
                  </CardHeader>
                  <CardContent className="px-2 pt-4 sm:px-6 sm:pt-6">
                    <ChartContainer
                      config={{
                        avgCostBase: {
                          label: "Base Cost",
                          color: "hsl(210, 70%, 35%)",
                        },
                        avgCostWithSurcharge: {
                          label: "With Surcharges",
                          color: "hsl(200, 70%, 55%)",
                        },
                        movingAverage: {
                          label: `${maWindowSize}-Day Average`,
                          color: "hsl(0, 0%, 15%)",
                        },
                      }}
                      className="aspect-auto h-[250px] w-full"
                    >
                      <ComposedChart data={costTrendDataWithMA}>
                        <defs>
                          <linearGradient id="fillCostBase" x1="0" y1="0" x2="0" y2="1">
                            <stop
                              offset="5%"
                              stopColor="var(--color-avgCostBase)"
                              stopOpacity={0.8}
                            />
                            <stop
                              offset="95%"
                              stopColor="var(--color-avgCostBase)"
                              stopOpacity={0.1}
                            />
                          </linearGradient>
                          <linearGradient id="fillCostWithSurcharge" x1="0" y1="0" x2="0" y2="1">
                            <stop
                              offset="5%"
                              stopColor="var(--color-avgCostWithSurcharge)"
                              stopOpacity={0.8}
                            />
                            <stop
                              offset="95%"
                              stopColor="var(--color-avgCostWithSurcharge)"
                              stopOpacity={0.1}
                            />
                          </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="month"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          minTickGap={32}
                          tickFormatter={(value) => {
                            const date = new Date(value)
                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          }}
                        />
                        <YAxis
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `$${value.toFixed(2)}`}
                          domain={costYAxisConfig.domain}
                          ticks={costYAxisConfig.ticks}
                          width={55}
                        />
                        <ChartTooltip
                          cursor={false}
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) => {
                                return new Date(value).toLocaleDateString('en-US', {
                                  month: 'short',
                                  day: 'numeric',
                                  year: 'numeric'
                                })
                              }}
                              formatter={(value, name) => {
                                const cost = Number(value).toFixed(2)
                                const priceElement = <span className="font-bold">${cost}</span>
                                if (name === 'avgCostBase') return [priceElement, <span className="ml-2">Base Cost</span>]
                                if (name === 'movingAverage') return [priceElement, <span className="ml-2">{maWindowSize}-Day Average</span>]
                                return [priceElement, <span className="ml-2">With Surcharges</span>]
                              }}
                              indicator="dot"
                            />
                          }
                        />
                        <Area
                          dataKey="avgCostWithSurcharge"
                          type="natural"
                          fill="url(#fillCostWithSurcharge)"
                          stroke="var(--color-avgCostWithSurcharge)"
                        />
                        <Area
                          dataKey="avgCostBase"
                          type="natural"
                          fill="url(#fillCostBase)"
                          stroke="var(--color-avgCostBase)"
                        />
                        <Line
                          dataKey="movingAverage"
                          type="monotone"
                          stroke="var(--color-movingAverage)"
                          strokeWidth={2}
                          dot={(props: any) => {
                            // Only show dots at intervals matching the moving average window
                            const showDot = props.index % maWindowSize === 0
                            return (
                              <circle
                                key={props.index}
                                cx={props.cx}
                                cy={props.cy}
                                r={showDot ? 3 : 0}
                                fill="var(--color-movingAverage)"
                              />
                            )
                          }}
                        />
                        <ChartLegend content={<ChartLegendContent />} />
                      </ComposedChart>
                    </ChartContainer>
                  </CardContent>
                </Card>

                {/* Geography: Cost + Transit by State */}
                <Card>
                  <CardHeader className="text-center">
                    <CardTitle className="text-base">Cost + Transit Time by State</CardTitle>
                    <CardDescription>Geographic distribution of shipping costs and delivery times</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid gap-4 md:grid-cols-2">
                      <CostSpeedStateMap
                        data={stateCostSpeedData}
                        metric="cost"
                        title="Avg Shipping Cost"
                      />
                      <CostSpeedStateMap
                        data={stateCostSpeedData}
                        metric="transit"
                        title="Avg Transit Time"
                      />
                    </div>
                  </CardContent>
                </Card>

                {/* Cost by Zone */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Cost by Shipping Zone</CardTitle>
                    <CardDescription>How shipping cost and transit time scale with zone distance</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer
                      config={{
                        avgCost: {
                          label: "Avg Cost",
                          color: "#328bcb",
                        },
                        avgTransitTime: {
                          label: "Avg Transit",
                          color: "#000000",
                        },
                      }}
                      className="h-[250px] w-full"
                    >
                      <ComposedChart
                        data={zoneCostData}
                        margin={{ top: 20, right: 20, left: 20, bottom: 0 }}
                      >
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="zone"
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `Zone ${value}`}
                        />
                        <YAxis
                          yAxisId="cost"
                          orientation="left"
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `$${value}`}
                        />
                        <YAxis
                          yAxisId="transit"
                          orientation="right"
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `${value}d`}
                        />
                        <ChartTooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            const data = payload[0].payload
                            return (
                              <div className="bg-background border rounded-lg shadow-lg p-3 space-y-2">
                                <div className="font-semibold">Zone {data.zone}</div>
                                <div className="space-y-1 text-sm">
                                  <div className="flex justify-between gap-4">
                                    <span className="text-muted-foreground">Average Cost</span>
                                    <span className="font-medium tabular-nums">${data.avgCost.toFixed(2)}</span>
                                  </div>
                                  <div className="flex justify-between gap-4">
                                    <span className="text-muted-foreground">Average Transit Time</span>
                                    <span className="font-medium tabular-nums">{data.avgTransitTime.toFixed(1)} days</span>
                                  </div>
                                </div>
                              </div>
                            )
                          }}
                        />
                        <Bar
                          yAxisId="cost"
                          dataKey="avgCost"
                          fill="var(--color-avgCost)"
                          radius={[4, 4, 0, 0]}
                        />
                        <Line
                          yAxisId="transit"
                          type="monotone"
                          dataKey="avgTransitTime"
                          stroke="var(--color-avgTransitTime)"
                          strokeWidth={2}
                          dot={{ fill: "var(--color-avgTransitTime)", r: 4 }}
                        />
                      </ComposedChart>
                    </ChartContainer>
                  </CardContent>
                </Card>

                {/* Transit Time Distribution */}
                <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Transit Time Distribution</CardTitle>
                      <CardDescription>Min, median, max by carrier</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-4">
                        {transitTimeDistributionData.map((carrier) => (
                          <div key={carrier.carrier}>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="font-medium">{carrier.carrier}</span>
                              <span className="text-muted-foreground text-xs">{carrier.orderCount} orders</span>
                            </div>
                            <div className="relative h-8">
                              {/* Background bar */}
                              <div className="absolute inset-0 bg-muted rounded-md" />

                              {/* Range bar (min to max) */}
                              <div
                                className="absolute top-1/2 -translate-y-1/2 h-2 bg-primary/20 rounded-full"
                                style={{
                                  left: `${(carrier.min / carrier.max) * 100}%`,
                                  width: `${((carrier.max - carrier.min) / carrier.max) * 100}%`,
                                }}
                              />

                              {/* IQR bar (Q1 to Q3) */}
                              <div
                                className="absolute top-1/2 -translate-y-1/2 h-3 bg-primary/50 rounded"
                                style={{
                                  left: `${(carrier.q1 / carrier.max) * 100}%`,
                                  width: `${((carrier.q3 - carrier.q1) / carrier.max) * 100}%`,
                                }}
                              />

                              {/* Median line */}
                              <div
                                className="absolute top-1/2 -translate-y-1/2 h-5 w-0.5 bg-primary"
                                style={{
                                  left: `${(carrier.median / carrier.max) * 100}%`,
                                }}
                              />
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground mt-1">
                              <span>{carrier.min.toFixed(1)}d</span>
                              <span>Median: {carrier.median.toFixed(1)}d</span>
                              <span>{carrier.max.toFixed(1)}d</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                </Card>

              </TabsContent>

              {/* Tab 3: Order Volume */}
              <TabsContent value="order-volume" className="space-y-7 mt-7">
                {/* Layered Volume Heat Map with State Details */}
                {isMounted && volumeData.stateData.length > 0 && (
                  <div className="grid gap-4 lg:grid-cols-3">
                    <Card className="lg:col-span-2">
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">Order Volume Heat Map</CardTitle>
                        <CardDescription className="text-xs">
                          <span className="lg:hidden">For USA domestic orders only. State colors show relative order volume (white-to-green), with city-level volume overlay (blue/orange/red dots).</span>
                          <span className="hidden lg:inline">For USA domestic orders only. View state-level averages (white-to-green) with city-level volume overlay (blue/orange/red dots).<br />Hover over states or cities for details, or click states to see average order volume and top cities.</span>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="relative pt-0">
                        {/* Show stale data during loading - better than flash */}
                        <LayeredVolumeHeatMap
                          stateData={volumeData.stateData}
                          zipCodeData={volumeData.zipCodeData}
                          onStateSelect={(stateCode) => setSelectedVolumeState(stateCode)}
                        />
                        {/* Overlay loading indicator when data is stale */}
                        {!isVolumeDataCurrent && (
                          <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-background/80 px-3 py-2 rounded-md">
                              <Loader2 className="h-4 w-4 animate-spin" />
                              <span>Updating map...</span>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>

                    {/* State details sidebar - hidden on mobile */}
                    <div className="hidden lg:block">
                      {selectedVolumeState && Array.isArray(volumeData.stateData) && volumeData.stateData.find(s => s.state === selectedVolumeState) && (
                        <StateVolumeDetailsPanel
                          stateData={volumeData.stateData.find(s => s.state === selectedVolumeState)!}
                          cityData={volumeData.cityData}
                          onClose={() => setSelectedVolumeState(null)}
                        />
                      )}

                      {!selectedVolumeState && (
                        <NationalVolumeOverviewPanel
                          stateData={volumeData.stateData}
                          cityData={volumeData.zipCodeData}
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Daily Trend */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Daily Order Volume</CardTitle>
                    <CardDescription>Order count trend over the selected period</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer
                      config={{
                        orderCount: {
                          label: "Orders",
                          color: "#328bcb",
                        },
                      }}
                      className="h-[300px] w-full"
                    >
                      <AreaChart
                        data={dailyOrderVolume}
                        margin={{ top: 20, right: 20, left: -20, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="fillOrders" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="#328bcb" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="#328bcb" stopOpacity={0.05} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          interval={(() => {
                            const dataLength = dailyOrderVolume.length
                            if (dataLength <= 7) return 0
                            if (dataLength <= 30) return Math.floor(dataLength / 6)
                            if (dataLength <= 90) return Math.floor(dataLength / 5)
                            return Math.floor(dataLength / 8)
                          })()}
                          tickFormatter={(value) => {
                            const date = new Date(value)
                            const dataLength = dailyOrderVolume.length
                            if (dataLength > 90) {
                              return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                            }
                            return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                          }}
                        />
                        <YAxis tickLine={false} axisLine={false} />
                        <ChartTooltip
                          content={<ChartTooltipContent
                            formatter={(value, name, item) => {
                              const growth = item.payload.growthPercent
                              const growthText = growth !== null
                                ? ` (${growth > 0 ? '+' : ''}${growth.toFixed(1)}%)`
                                : ''
                              return [`${value}${growthText}`, 'Orders']
                            }}
                          />}
                        />
                        <Area
                          type="monotone"
                          dataKey="orderCount"
                          stroke="var(--color-orderCount)"
                          strokeWidth={2}
                          fill="url(#fillOrders)"
                          dot={false}
                        />
                      </AreaChart>
                    </ChartContainer>
                  </CardContent>
                </Card>

                {/* Pattern Charts Row */}
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Orders by Hour of Day</CardTitle>
                      <CardDescription>When do orders come in throughout the day?</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer
                        config={{
                          orderCount: {
                            label: "Orders",
                            color: "#328bcb",
                          },
                        }}
                        className="h-[300px] w-full"
                      >
                        <BarChart
                          data={orderVolumeByHour}
                          margin={{ top: 20, right: 20, left: -20, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="hour"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => {
                              const hour = parseInt(value)
                              if (hour === 0) return '12am'
                              if (hour === 12) return '12pm'
                              if (hour < 12) return `${hour}am`
                              return `${hour - 12}pm`
                            }}
                          />
                          <YAxis tickLine={false} axisLine={false} />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null
                              const data = payload[0].payload
                              const hour = parseInt(data.hour)
                              let timeLabel = ''
                              if (hour === 0) timeLabel = '12:00 AM'
                              else if (hour === 12) timeLabel = '12:00 PM'
                              else if (hour < 12) timeLabel = `${hour}:00 AM`
                              else timeLabel = `${hour - 12}:00 PM`
                              return (
                                <div className="bg-background border rounded-lg shadow-lg p-3 space-y-2">
                                  <div className="font-semibold">{timeLabel}</div>
                                  <div className="space-y-1 text-sm">
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Order Count</span>
                                      <span className="font-medium tabular-nums">{data.orderCount.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Percentage</span>
                                      <span className="font-medium tabular-nums">{data.percent.toFixed(1)}%</span>
                                    </div>
                                  </div>
                                </div>
                              )
                            }}
                          />
                          <Bar
                            dataKey="orderCount"
                            fill="var(--color-orderCount)"
                            radius={[4, 4, 0, 0]}
                          />
                        </BarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Orders by Day of Week</CardTitle>
                      <CardDescription>Which days are busiest?</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer
                        config={{
                          orderCount: {
                            label: "Orders",
                            color: "#ec9559",
                          },
                        }}
                        className="h-[300px] w-full"
                      >
                        <BarChart
                          data={orderVolumeByDayOfWeek}
                          margin={{ top: 30, right: 20, left: 20, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} horizontal={false} />
                          <XAxis
                            dataKey="dayName"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => value.slice(0, 3)}
                          />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null
                              const data = payload[0].payload
                              return (
                                <div className="bg-background border rounded-lg shadow-lg p-3 space-y-2">
                                  <div className="font-semibold">{data.dayName}</div>
                                  <div className="space-y-1 text-sm">
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Order Count</span>
                                      <span className="font-medium tabular-nums">{data.orderCount.toLocaleString()}</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-muted-foreground">Percentage</span>
                                      <span className="font-medium tabular-nums">{data.percent.toFixed(1)}%</span>
                                    </div>
                                  </div>
                                </div>
                              )
                            }}
                          />
                          <Bar
                            dataKey="orderCount"
                            fill="var(--color-orderCount)"
                            radius={[4, 4, 0, 0]}
                          >
                            <LabelList
                              dataKey="orderCount"
                              position="top"
                              formatter={(value: number) => value.toLocaleString()}
                              className="fill-foreground text-xs"
                            />
                          </Bar>
                        </BarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                </div>

                {/* Distribution Tables Row */}
                <div className="grid gap-4 md:grid-cols-2">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Orders by Fulfillment Center</CardTitle>
                      <CardDescription>Which FCs handle the most volume?</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left p-3 font-semibold">FC</th>
                              <th className="text-right p-3 font-semibold">Orders</th>
                              <th className="text-right p-3 font-semibold">%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orderVolumeByFC.slice(0, 10).map((fc) => (
                              <tr key={fc.fcName} className="border-b border-border/50 hover:bg-muted/50">
                                <td className="p-3 font-medium">{fc.fcName}</td>
                                <td className="p-3 text-right">{fc.orderCount.toLocaleString()}</td>
                                <td className="p-3 text-right">{fc.percent.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Orders by Store Integration</CardTitle>
                      <CardDescription>Which stores generate the most orders?</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border">
                              <th className="text-left p-3 font-semibold">Store</th>
                              <th className="text-right p-3 font-semibold">Orders</th>
                              <th className="text-right p-3 font-semibold">%</th>
                            </tr>
                          </thead>
                          <tbody>
                            {orderVolumeByStore.slice(0, 10).map((store) => (
                              <tr key={store.storeIntegrationName} className="border-b border-border/50 hover:bg-muted/50">
                                <td className="p-3 font-medium">{store.storeIntegrationName}</td>
                                <td className="p-3 text-right">{store.orderCount.toLocaleString()}</td>
                                <td className="p-3 text-right">{store.percent.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              </TabsContent>

              {/* Tab 4: Carriers + Zones */}
              <TabsContent value="carriers-zones" className="space-y-7 mt-7">
                {/* Zone Performance Landscape - Feature Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Zone Performance Landscape</CardTitle>
                    <CardDescription>How shipping cost and transit time scale with distance from your fulfillment center</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                      {/* Main Chart */}
                      <div className="lg:col-span-3">
                        <ChartContainer
                          config={{
                            avgCost: { label: "Avg Cost", color: "#328bcb" },
                            avgTransitTime: { label: "Avg Transit", color: "#000000" },
                            orderCount: { label: "Orders", color: "hsl(142, 76%, 36%)" },
                          }}
                          className="h-[350px] w-full"
                        >
                          <ComposedChart
                            data={zoneCostData}
                            margin={{ top: 30, right: 30, left: 20, bottom: 20 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis
                              dataKey="zone"
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(value) => `Zone ${value}`}
                            />
                            <YAxis
                              yAxisId="cost"
                              orientation="left"
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(value) => `$${value}`}
                            />
                            <YAxis
                              yAxisId="volume"
                              orientation="right"
                              tickLine={false}
                              axisLine={false}
                              tickFormatter={(value) => value >= 1000 ? `${(value/1000).toFixed(0)}k` : value}
                            />
                            <ChartTooltip
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null
                                const data = payload[0].payload
                                return (
                                  <div className="bg-background border rounded-lg shadow-lg p-3 space-y-2">
                                    <div className="font-semibold">Zone {data.zone}</div>
                                    <div className="space-y-1 text-sm">
                                      <div className="flex justify-between gap-4">
                                        <span className="text-muted-foreground">Order Volume</span>
                                        <span className="font-medium tabular-nums">{data.orderCount.toLocaleString()}</span>
                                      </div>
                                      <div className="flex justify-between gap-4">
                                        <span className="text-muted-foreground">Average Cost</span>
                                        <span className="font-medium tabular-nums">${data.avgCost.toFixed(2)}</span>
                                      </div>
                                      <div className="flex justify-between gap-4">
                                        <span className="text-muted-foreground">Average Transit Time</span>
                                        <span className="font-medium tabular-nums">{data.avgTransitTime.toFixed(1)} days</span>
                                      </div>
                                    </div>
                                  </div>
                                )
                              }}
                            />
                            <Bar
                              yAxisId="volume"
                              dataKey="orderCount"
                              fill="var(--color-orderCount)"
                              radius={[4, 4, 0, 0]}
                              opacity={0.3}
                            />
                            <Line
                              yAxisId="cost"
                              type="monotone"
                              dataKey="avgCost"
                              stroke="var(--color-avgCost)"
                              strokeWidth={3}
                              dot={{ fill: "var(--color-avgCost)", r: 5 }}
                            />
                          </ComposedChart>
                        </ChartContainer>
                        <div className="flex items-center justify-center gap-6 mt-2 text-xs text-muted-foreground">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-3 rounded-sm" style={{ backgroundColor: 'hsl(142, 76%, 36%)', opacity: 0.3 }} />
                            <span>Order Volume</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-0.5" style={{ backgroundColor: '#328bcb' }} />
                            <span>Avg Cost</span>
                          </div>
                        </div>
                      </div>

                      {/* Zone Summary Stats */}
                      <div className="space-y-3">
                        <div className="text-sm font-medium text-muted-foreground">Zone Distribution</div>
                        {zoneCostData.map((zone) => {
                          const totalOrders = zoneCostData.reduce((sum, z) => sum + z.orderCount, 0)
                          const percent = totalOrders > 0 ? (zone.orderCount / totalOrders * 100) : 0
                          return (
                            <div key={zone.zone} className="space-y-1">
                              <div className="flex justify-between text-sm">
                                <span className="font-medium">Zone {zone.zone}</span>
                                <span className="text-muted-foreground tabular-nums">{percent.toFixed(1)}%</span>
                              </div>
                              <div className="h-2 bg-muted rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all"
                                  style={{
                                    width: `${percent}%`,
                                    backgroundColor: `hsl(142, ${40 + percent}%, ${50 - percent * 0.3}%)`
                                  }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Network Summary Row */}
                <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                  {/* Network Stats */}
                  {(() => {
                    const totalOrders = carrierPerformance.reduce((sum, cp) => sum + cp.orderCount, 0)
                    const totalOnTime = carrierPerformance.reduce((sum, cp) => sum + (cp.orderCount * cp.onTimePercent / 100), 0)
                    const networkOnTime = totalOrders > 0 ? (totalOnTime / totalOrders * 100) : 0
                    const avgTransit = totalOrders > 0
                      ? carrierPerformance.reduce((sum, cp) => sum + (cp.avgTransitTime * cp.orderCount), 0) / totalOrders
                      : 0
                    const avgCost = totalOrders > 0
                      ? carrierPerformance.reduce((sum, cp) => sum + cp.totalCost, 0) / totalOrders
                      : 0

                    return (
                      <>
                        <Card>
                          <CardContent className="pt-6">
                            <div className="text-center">
                              <div className="text-3xl font-bold tabular-nums">{networkOnTime.toFixed(1)}%</div>
                              <div className="text-sm text-muted-foreground mt-1">Network On-Time Rate</div>
                            </div>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-6">
                            <div className="text-center">
                              <div className="text-3xl font-bold tabular-nums">{avgTransit.toFixed(1)} <span className="text-lg font-normal">days</span></div>
                              <div className="text-sm text-muted-foreground mt-1">Avg Transit Time</div>
                            </div>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-6">
                            <div className="text-center">
                              <div className="text-3xl font-bold tabular-nums">${avgCost.toFixed(2)}</div>
                              <div className="text-sm text-muted-foreground mt-1">Avg Cost per Shipment</div>
                            </div>
                          </CardContent>
                        </Card>
                        <Card>
                          <CardContent className="pt-6">
                            <div className="text-center">
                              <div className="text-3xl font-bold tabular-nums">{carrierPerformance.length}</div>
                              <div className="text-sm text-muted-foreground mt-1">Active Carriers</div>
                            </div>
                          </CardContent>
                        </Card>
                      </>
                    )
                  })()}
                </div>

                {/* Your Carrier Network Section */}
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <div>
                        <CardTitle className="text-base">Your Carrier Network</CardTitle>
                        <CardDescription>Your shipments are distributed across {carrierPerformance.length} carriers for optimal coverage and competitive rates</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                      {/* Carrier Mix Donut */}
                      <div className="flex flex-col items-center justify-center">
                        <ChartContainer
                          config={Object.fromEntries(
                            carrierPerformance.map((cp, i) => [
                              cp.carrier,
                              { label: cp.carrier, color: `hsl(${(i * 45) % 360}, 70%, 50%)` }
                            ])
                          )}
                          className="h-[220px] w-full"
                        >
                          <RadialBarChart
                            data={carrierPerformance.map((cp, i) => ({
                              name: cp.carrier,
                              value: cp.orderCount,
                              fill: `hsl(${(i * 45) % 360}, 70%, 50%)`
                            }))}
                            innerRadius="40%"
                            outerRadius="80%"
                            startAngle={180}
                            endAngle={-180}
                          >
                            <RadialBar
                              dataKey="value"
                              background={{ fill: 'hsl(var(--muted))' }}
                              cornerRadius={4}
                            />
                          </RadialBarChart>
                        </ChartContainer>
                        <div className="text-sm text-muted-foreground mt-2">Volume Distribution</div>
                      </div>

                      {/* Carrier List - Non-comparative */}
                      <div className="lg:col-span-2">
                        <div className="rounded-md border">
                          <table className="w-full text-sm">
                            <thead className="bg-muted">
                              <tr className="border-b">
                                <th className="p-3 text-left font-semibold">Carrier</th>
                                <th className="p-3 text-right font-semibold">Orders</th>
                                <th className="p-3 text-right font-semibold">Volume %</th>
                                <th className="p-3 text-right font-semibold">Avg Cost</th>
                                <th className="p-3 text-right font-semibold">Avg Transit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {carrierPerformance.map((cp, idx) => {
                                const totalOrders = carrierPerformance.reduce((sum, c) => sum + c.orderCount, 0)
                                const volumePercent = totalOrders > 0 ? (cp.orderCount / totalOrders * 100) : 0
                                return (
                                  <tr key={cp.carrier} className={cn("border-b", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                    <td className="p-3 font-medium">{cp.carrier}</td>
                                    <td className="p-3 text-right tabular-nums">{cp.orderCount.toLocaleString()}</td>
                                    <td className="p-3 text-right tabular-nums text-muted-foreground">{volumePercent.toFixed(1)}%</td>
                                    <td className="p-3 text-right tabular-nums">${cp.avgCost.toFixed(2)}</td>
                                    <td className="p-3 text-right tabular-nums">{cp.avgTransitTime.toFixed(1)} days</td>
                                  </tr>
                                )
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                {/* Zone Deep Dive */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Zone Cost & Transit Details</CardTitle>
                    <CardDescription>Detailed breakdown of shipping metrics by zone distance</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr className="border-b">
                            <th className="p-3 text-left font-semibold">Zone</th>
                            <th className="p-3 text-right font-semibold">Orders</th>
                            <th className="p-3 text-right font-semibold">% of Total</th>
                            <th className="p-3 text-right font-semibold">Avg Cost</th>
                            <th className="p-3 text-right font-semibold">Avg Transit</th>
                            <th className="p-3 text-left font-semibold">Distance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {zoneCostData.map((zone, idx) => {
                            const totalOrders = zoneCostData.reduce((sum, z) => sum + z.orderCount, 0)
                            const percent = totalOrders > 0 ? (zone.orderCount / totalOrders * 100) : 0
                            const distanceLabels: Record<string, string> = {
                              '1': 'Local (same region)',
                              '2': 'Very close',
                              '3': 'Regional',
                              '4': 'Medium distance',
                              '5': 'Farther',
                              '6': 'Far',
                              '7': 'Very far',
                              '8': 'Coast to coast'
                            }
                            return (
                              <tr key={zone.zone} className={cn("border-b", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                <td className="p-3 font-medium">Zone {zone.zone}</td>
                                <td className="p-3 text-right tabular-nums">{zone.orderCount.toLocaleString()}</td>
                                <td className="p-3 text-right tabular-nums text-muted-foreground">{percent.toFixed(1)}%</td>
                                <td className="p-3 text-right tabular-nums">${zone.avgCost.toFixed(2)}</td>
                                <td className="p-3 text-right tabular-nums">{zone.avgTransitTime.toFixed(1)} days</td>
                                <td className="p-3 text-muted-foreground">{distanceLabels[zone.zone] || ''}</td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Tab 4: SLA Performance */}
              <TabsContent value="sla" className="space-y-7 mt-7">
                {/* On-Time Delivery Trend */}
                <Card>
                  <CardHeader className="pb-4">
                    <div className="flex items-start justify-between">
                      <div className="space-y-1">
                        <CardTitle className="text-base">Fulfillment SLA Success Rate</CardTitle>
                        <CardDescription>Daily performance trend across selected period</CardDescription>
                      </div>
                      <div className="text-right">
                        <div className="text-4xl font-bold tabular-nums"
                             style={{
                               color: slaMetrics.onTimePercent >= 95
                                 ? "hsl(142 71% 45%)"
                                 : slaMetrics.onTimePercent >= 90
                                 ? "hsl(45 93% 47%)"
                                 : "hsl(0 84% 60%)"
                             }}>
                          {slaMetrics.onTimePercent.toFixed(1)}%
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">Average</p>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer
                      config={{
                        onTimePercent: {
                          label: "On-Time %",
                          color: "hsl(var(--chart-1))",
                        },
                        target95: {
                          label: "95% Target",
                          color: "hsl(var(--chart-2))",
                        },
                        target90: {
                          label: "90% Target",
                          color: "hsl(var(--chart-3))",
                        },
                      }}
                      className="h-[300px] w-full"
                    >
                      <AreaChart
                        data={onTimeTrendData}
                        margin={{ top: 20, right: 12, left: -8, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="fillOnTime" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%" stopColor="var(--color-onTimePercent)" stopOpacity={0.3} />
                            <stop offset="95%" stopColor="var(--color-onTimePercent)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis
                          dataKey="date"
                          tickLine={false}
                          axisLine={false}
                          tickMargin={8}
                          minTickGap={32}
                          tickFormatter={(value) => {
                            const date = new Date(value)
                            return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
                          }}
                        />
                        <YAxis
                          type="number"
                          domain={[90, 100]}
                          ticks={[90, 92, 94, 96, 98, 100]}
                          allowDataOverflow={false}
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(value) => `${value}%`}
                        />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelFormatter={(value) => {
                                return new Date(value).toLocaleDateString("en-US", {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                })
                              }}
                              formatter={(value, name) => {
                                if (name === 'onTimePercent') {
                                  return [`${Number(value).toFixed(1)}%`, 'On-Time Rate']
                                }
                                return [value, name]
                              }}
                            />
                          }
                        />
                        <RechartsLabel value="95%" position="insideTopLeft" />
                        <Line
                          type="monotone"
                          dataKey={() => 95}
                          stroke="hsl(142 71% 45%)"
                          strokeWidth={1}
                          strokeDasharray="5 5"
                          dot={false}
                          legendType="none"
                        />
                        <Line
                          type="monotone"
                          dataKey={() => 90}
                          stroke="hsl(45 93% 47%)"
                          strokeWidth={1}
                          strokeDasharray="5 5"
                          dot={false}
                          legendType="none"
                        />
                        <Area
                          type="monotone"
                          dataKey="onTimePercent"
                          stroke="hsl(204 61% 50%)"
                          strokeWidth={2}
                          fill="url(#fillOnTime)"
                        />
                      </AreaChart>
                    </ChartContainer>
                  </CardContent>
                </Card>

                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Time to Fulfill Trends */}
                  <Card className="flex flex-col">
                    <CardHeader>
                      <CardTitle className="text-base">Time to Fulfill Trends</CardTitle>
                      <CardDescription>How long does it take to fulfill orders over time?</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1">
                      <ChartContainer
                        config={{
                          avgFulfillmentHours: {
                            label: "Average",
                            color: "#328bcb",
                          },
                          p90FulfillmentHours: {
                            label: "90th Percentile",
                            color: "#ec9559",
                          },
                        }}
                        className="h-[300px] w-full"
                      >
                        <ComposedChart
                          data={fulfillmentTrendData}
                          margin={{ top: 20, right: 20, left: -20, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient id="fillAvg" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#328bcb" stopOpacity={0.3} />
                              <stop offset="95%" stopColor="#328bcb" stopOpacity={0.05} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis
                            dataKey="date"
                            tickLine={false}
                            axisLine={false}
                            interval={(() => {
                              const dataLength = fulfillmentTrendData.length
                              if (dataLength <= 7) return 0 // Show all ticks for 7 days or less
                              if (dataLength <= 30) return Math.floor(dataLength / 6) // Show ~6 ticks for 30 days
                              if (dataLength <= 90) return Math.floor(dataLength / 5) // Show ~5 ticks for 90 days
                              return Math.floor(dataLength / 8) // Show ~8 ticks for 1 year
                            })()}
                            tickFormatter={(value) => {
                              const date = new Date(value)
                              const dataLength = fulfillmentTrendData.length
                              // For longer ranges, show month + year
                              if (dataLength > 90) {
                                return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
                              }
                              return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            }}
                          />
                          <YAxis
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => `${value}h`}
                          />
                          <ChartTooltip
                            content={<ChartTooltipContent
                              formatter={(value, name) => {
                                const hours = Number(value).toFixed(1)
                                if (name === 'avgFulfillmentHours') return [`${hours}h`, 'Average']
                                if (name === 'p90FulfillmentHours') return [`${hours}h`, '90th Percentile']
                                return [value, name]
                              }}
                            />}
                          />
                          <Area
                            type="monotone"
                            dataKey="avgFulfillmentHours"
                            stroke="var(--color-avgFulfillmentHours)"
                            strokeWidth={2}
                            fill="url(#fillAvg)"
                            dot={false}
                          />
                          <Line
                            type="monotone"
                            dataKey="p90FulfillmentHours"
                            stroke="var(--color-p90FulfillmentHours)"
                            strokeWidth={2}
                            dot={false}
                          />
                          <ChartLegend content={<ChartLegendContent />} />
                        </ComposedChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  {/* Fulfillment Speed by FC */}
                  <Card className="flex flex-col">
                    <CardHeader>
                      <CardTitle className="text-base">Fulfillment Speed by FC</CardTitle>
                      <CardDescription>Which fulfillment centers process orders fastest?</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1">
                      <ChartContainer
                        config={{
                          avgFulfillmentHours: {
                            label: "Avg Time (hours)",
                            color: "#328bcb",
                          },
                          breachRate: {
                            label: "Breach Rate (%)",
                            color: "#ec9559",
                          },
                        }}
                        className="h-[300px] w-full"
                      >
                        <BarChart
                          data={fcFulfillmentMetrics}
                          margin={{ top: 20, right: 20, left: -20, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="fcName" tickLine={false} axisLine={false} />
                          <YAxis
                            yAxisId="left"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => `${value}h`}
                          />
                          <YAxis
                            yAxisId="right"
                            orientation="right"
                            tickLine={false}
                            axisLine={false}
                            tickFormatter={(value) => `${value}%`}
                          />
                          <ChartTooltip
                            content={<ChartTooltipContent
                              formatter={(value, name) => {
                                if (name === 'avgFulfillmentHours') return [`${Number(value).toFixed(1)}h`, 'Avg Time']
                                if (name === 'breachRate') return [`${Number(value).toFixed(1)}%`, 'Breach Rate']
                                return [value, name]
                              }}
                            />}
                          />
                          <Bar
                            yAxisId="left"
                            dataKey="avgFulfillmentHours"
                            fill="var(--color-avgFulfillmentHours)"
                            radius={[4, 4, 0, 0]}
                          />
                          <Bar
                            yAxisId="right"
                            dataKey="breachRate"
                            fill="var(--color-breachRate)"
                            radius={[4, 4, 0, 0]}
                          />
                          <ChartLegend content={<ChartLegendContent />} />
                        </BarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>
                </div>

                {/* Recent SLA Breaches */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Recent SLA Breaches</CardTitle>
                    <CardDescription>Orders that missed their fulfillment deadline</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border">
                      <table className="w-full text-sm">
                        <thead className="bg-muted">
                          <tr className="border-b">
                            <th className="p-3 text-left font-semibold">Order ID</th>
                            <th className="p-3 text-left font-semibold">Customer</th>
                            <th className="p-3 text-left font-semibold">Order Received</th>
                            <th className="p-3 text-left font-semibold">Label Generated</th>
                            <th className="p-3 text-right font-semibold">Time to Ship</th>
                          </tr>
                        </thead>
                        <tbody>
                          {slaMetrics.shipments
                            .filter(s => !s.isOnTime)
                            .slice(0, 10)
                            .map((s, idx) => (
                              <tr key={s.orderId} className={cn("border-b", idx % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                <td className="p-3 font-medium">{s.orderId}</td>
                                <td className="p-3">{s.customerName}</td>
                                <td className="p-3">
                                  {new Date(s.orderInsertTimestamp).toLocaleString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit"
                                  })}
                                </td>
                                <td className="p-3">
                                  {new Date(s.labelGenerationTimestamp).toLocaleString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    hour: "numeric",
                                    minute: "2-digit"
                                  })}
                                </td>
                                <td className="p-3 text-right">
                                  <span className="text-destructive font-medium">
                                    {s.timeToShipHours.toFixed(1)}h
                                  </span>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>

              {/* Tab 5: Performance by State */}
              <TabsContent value="state-performance" className="space-y-7 mt-7">
                <div className="grid gap-4 lg:grid-cols-3">
                  {/* Interactive US Map - 2 columns */}
                  <Card className="lg:col-span-2">
                    <CardHeader>
                      <CardTitle className="text-base">US State Performance Map</CardTitle>
                      <CardDescription>
                        Click on any state to view detailed performance metrics
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="-mt-[35px] pr-0 pt-0">
                      <USStateMap
                        stateData={statePerformance}
                        onStateSelect={setSelectedState}
                      />
                    </CardContent>
                  </Card>

                  {/* State Details Panel - 1 column */}
                  <div className="lg:col-span-1">
                    {selectedState && statePerformance.find(s => s.state === selectedState) ? (
                      <StateDetailsPanel
                        stateData={statePerformance.find(s => s.state === selectedState)!}
                      />
                    ) : (
                      <NationalPerformanceOverviewPanel stateData={statePerformance} />
                    )}
                  </div>
                </div>
              </TabsContent>

              {/* Tab 6: Undelivered Shipments */}
              <TabsContent value="undelivered" className="space-y-6 mt-6">
                {/* KPI Summary Cards */}
                <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Total Undelivered</p>
                      <p className="text-2xl font-bold">{undeliveredSummary.totalUndelivered.toLocaleString()}</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Avg Days in Transit</p>
                      <p className="text-2xl font-bold">{undeliveredSummary.avgDaysInTransit.toFixed(1)}</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">Critical (7+ days)</p>
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">{undeliveredSummary.criticalCount.toLocaleString()}</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardContent className="pt-6">
                      <p className="text-sm text-muted-foreground">On Track (&lt;5 days)</p>
                      <p className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">{undeliveredSummary.onTrackCount.toLocaleString()}</p>
                    </CardContent>
                  </Card>
                </div>

                {/* Charts Row */}
                <div className="grid gap-4 lg:grid-cols-2">
                  {/* Age Distribution Chart */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Age Distribution</CardTitle>
                      <CardDescription>Days since label was generated</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ChartContainer
                        config={{
                          count: { label: "Shipments", color: "hsl(var(--chart-1))" },
                        }}
                        className="h-[280px] w-full"
                      >
                        <BarChart data={undeliveredByAge} layout="vertical" margin={{ left: 80, right: 20, top: 10, bottom: 10 }}>
                          <CartesianGrid horizontal={true} vertical={false} strokeDasharray="3 3" />
                          <XAxis type="number" tickFormatter={(v) => v.toLocaleString()} />
                          <YAxis type="category" dataKey="bucket" width={75} tick={{ fontSize: 12 }} />
                          <ChartTooltip
                            content={({ active, payload }) => {
                              if (!active || !payload?.length) return null
                              const data = payload[0].payload
                              return (
                                <div className="rounded-lg border bg-background p-2 shadow-sm">
                                  <p className="font-medium">{data.bucket}</p>
                                  <p className="text-sm text-muted-foreground">
                                    {data.count.toLocaleString()} shipments ({data.percent.toFixed(1)}%)
                                  </p>
                                </div>
                              )
                            }}
                          />
                          <Bar
                            dataKey="count"
                            radius={[0, 4, 4, 0]}
                            fill="hsl(var(--chart-1))"
                          >
                            {undeliveredByAge.map((entry, index) => (
                              <rect
                                key={`cell-${index}`}
                                fill={entry.minDays >= 7 ? "hsl(var(--destructive))" : entry.minDays >= 3 ? "hsl(221, 83%, 53%)" : "hsl(142, 76%, 36%)"}
                              />
                            ))}
                          </Bar>
                        </BarChart>
                      </ChartContainer>
                    </CardContent>
                  </Card>

                  {/* Status Breakdown */}
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Status Breakdown</CardTitle>
                      <CardDescription>Current shipment status distribution</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {/* Total count header */}
                      <div className="text-center mb-6 pb-4 border-b">
                        <p className="text-3xl font-bold">{undeliveredSummary.totalUndelivered.toLocaleString()}</p>
                        <p className="text-sm text-muted-foreground">Total Undelivered</p>
                      </div>
                      {/* Status bars */}
                      <div className="space-y-4">
                        {undeliveredByStatus.map((item) => {
                          const color = item.status === 'Exception' ? 'bg-red-500' :
                                       item.status === 'Delayed' ? 'bg-amber-500' :
                                       item.status === 'In Transit' ? 'bg-blue-500' :
                                       'bg-emerald-500'
                          const textColor = item.status === 'Exception' ? 'text-red-600 dark:text-red-400' :
                                           item.status === 'Delayed' ? 'text-amber-600 dark:text-amber-400' :
                                           item.status === 'In Transit' ? 'text-blue-600 dark:text-blue-400' :
                                           'text-emerald-600 dark:text-emerald-400'
                          return (
                            <div key={item.status} className="space-y-1.5">
                              <div className="flex items-center justify-between text-sm">
                                <span className={cn("font-medium", textColor)}>{item.status}</span>
                                <span className="text-muted-foreground tabular-nums">
                                  {item.count.toLocaleString()} ({item.percent.toFixed(0)}%)
                                </span>
                              </div>
                              <div className="h-3 w-full bg-muted rounded-full overflow-hidden">
                                <div
                                  className={cn("h-full rounded-full transition-all", color)}
                                  style={{ width: `${Math.max(item.percent, 1)}%` }}
                                />
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </CardContent>
                  </Card>
                </div>

                {/* Undelivered by Carrier */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Undelivered by Carrier</CardTitle>
                    <CardDescription>Shipment count and average days in transit per carrier</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer
                      config={{
                        count: { label: "Shipments", color: "hsl(var(--chart-1))" },
                        avgDaysInTransit: { label: "Avg Days", color: "hsl(var(--chart-2))" },
                      }}
                      className="h-[300px] w-full"
                    >
                      <ComposedChart data={undeliveredByCarrier} margin={{ left: 20, right: 20, top: 20, bottom: 60 }}>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" />
                        <XAxis
                          dataKey="carrier"
                          angle={-45}
                          textAnchor="end"
                          height={60}
                          tick={{ fontSize: 11 }}
                          interval={0}
                        />
                        <YAxis yAxisId="left" orientation="left" tickFormatter={(v) => v.toLocaleString()} />
                        <YAxis yAxisId="right" orientation="right" tickFormatter={(v) => `${v.toFixed(1)}d`} />
                        <ChartTooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            const data = payload[0].payload
                            return (
                              <div className="rounded-lg border bg-background p-2 shadow-sm">
                                <p className="font-medium">{data.carrier}</p>
                                <p className="text-sm text-muted-foreground">
                                  {data.count.toLocaleString()} shipments ({data.percent.toFixed(1)}%)
                                </p>
                                <p className="text-sm text-muted-foreground">
                                  Avg: {data.avgDaysInTransit.toFixed(1)} days
                                </p>
                                {data.criticalCount > 0 && (
                                  <p className="text-sm text-red-500">
                                    {data.criticalCount} critical (7+ days)
                                  </p>
                                )}
                              </div>
                            )
                          }}
                        />
                        <Bar yAxisId="left" dataKey="count" fill="hsl(var(--chart-1))" radius={[4, 4, 0, 0]} />
                        <Line yAxisId="right" type="monotone" dataKey="avgDaysInTransit" stroke="hsl(var(--foreground))" strokeWidth={2} dot={{ fill: "hsl(var(--foreground))" }} />
                      </ComposedChart>
                    </ChartContainer>
                  </CardContent>
                </Card>

                {/* Shipments Detail Table */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base">Undelivered Shipments Detail</CardTitle>
                    <CardDescription>
                      Showing {Math.min(50, undeliveredShipments.length)} of {undeliveredShipments.length} undelivered shipments, sorted by days in transit
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="rounded-md border overflow-hidden">
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b bg-muted/50">
                              <th className="text-left p-3 font-medium">Tracking ID</th>
                              <th className="text-left p-3 font-medium">Order ID</th>
                              <th className="text-left p-3 font-medium">Customer</th>
                              <th className="text-left p-3 font-medium">Carrier</th>
                              <th className="text-left p-3 font-medium">Destination</th>
                              <th className="text-right p-3 font-medium">Days</th>
                              <th className="text-left p-3 font-medium">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {undeliveredShipments.slice(0, 50).map((shipment, index) => (
                              <tr key={shipment.trackingId} className={cn("border-b", index % 2 === 0 ? "bg-background" : "bg-muted/20")}>
                                <td className="p-3 font-mono text-xs">{shipment.trackingId}</td>
                                <td className="p-3 font-mono text-xs">{shipment.orderId}</td>
                                <td className="p-3">{shipment.customerName}</td>
                                <td className="p-3">{shipment.carrier}</td>
                                <td className="p-3">{shipment.destination}</td>
                                <td className={cn(
                                  "p-3 text-right font-medium tabular-nums",
                                  shipment.daysInTransit >= 7 ? "text-red-600 dark:text-red-400" :
                                  shipment.daysInTransit >= 5 ? "text-amber-600 dark:text-amber-400" :
                                  "text-foreground"
                                )}>
                                  {shipment.daysInTransit}
                                </td>
                                <td className="p-3">
                                  <span className={cn(
                                    "inline-flex items-center rounded-full px-2 py-1 text-xs font-medium",
                                    shipment.status === 'Exception' ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                                    shipment.status === 'Delayed' ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                                    "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                                  )}>
                                    {shipment.status}
                                  </span>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    {undeliveredShipments.length > 50 && (
                      <p className="text-sm text-muted-foreground mt-3 text-center">
                        Showing top 50 shipments by days in transit. Export to see all {undeliveredShipments.length} records.
                      </p>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>
          </div>
        </div>
      </div>
    </>
  )
}
