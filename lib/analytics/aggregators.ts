// Analytics Data Aggregation Utilities

import usCitiesData from './us-cities-coords.json'
import type {
  ShipmentData,
  AdditionalServiceData,
  ReturnData,
  ReceivingData,
  StorageData,
  CreditData,
  KPIMetrics,
  MonthlyInvoiceData,
  CarrierPerformance,
  ShipOptionMetrics,
  ZoneMetrics,
  SLAMetrics,
  UndeliveredShipment,
  DateRange,
  StatePerformance,
  FulfillmentTrendData,
  FCFulfillmentMetrics,
  CostTrendData,
  OrderVolumeTrendData,
  ShipOptionPerformanceData,
  CostVsTransitData,
  TransitTimeDistributionData,
  CostSpeedTrendData,
  OrderVolumeByHour,
  OrderVolumeByDayOfWeek,
  OrderVolumeByFC,
  OrderVolumeByStore,
  DailyOrderVolume,
  StateVolumeData,
  CityVolumeData,
  ZipCodeVolumeData,
  StateCostSpeedData,
  ZoneCostData,
  BillingSummary,
  BillingCategoryBreakdown,
  MonthlyBillingTrend,
  PickPackDistribution,
  CostPerOrderTrend,
  ShippingCostByZone,
  SurchargeBreakdown,
  AdditionalServicesBreakdown,
  BillingEfficiencyMetrics,
  UndeliveredSummary,
  UndeliveredByCarrier,
  UndeliveredByStatus,
  UndeliveredByAge,
  UndeliveredByState,
} from './types'

// Build city coordinates lookup map (module-level, computed once)
// Maps "CITY|STATE" => [longitude, latitude] for ~17k US cities
const usCitiesCoordinates = new Map<string, [number, number]>(
  usCitiesData.map(city => [city.key, [city.lon, city.lat]])
)

console.log(`Loaded ${usCitiesCoordinates.size} US city coordinates for exact mapping`)

// Date Utilities

export function isWithinDateRange(date: string, range: DateRange): boolean {
  const checkDate = new Date(date)
  return checkDate >= range.from && checkDate <= range.to
}

export function getMonthKey(date: string): string {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

export function getMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1)
  return date.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
}

// Daily key helpers
export function getDayKey(date: string): string {
  const d = new Date(date)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function getDayLabel(dayKey: string): string {
  const [year, month, day] = dayKey.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Weekly key helpers (week starting Monday)
export function getWeekKey(date: string): string {
  const d = new Date(date)
  // Get the Monday of the week
  const day = d.getDay()
  const diff = d.getDate() - day + (day === 0 ? -6 : 1) // Adjust when day is Sunday
  const monday = new Date(d.setDate(diff))
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}

export function getWeekLabel(weekKey: string): string {
  const [year, month, day] = weekKey.split('-')
  const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
  return `Week of ${date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}

// Get key based on granularity
export function getTimeKey(date: string, granularity: 'daily' | 'weekly' | 'monthly'): string {
  switch (granularity) {
    case 'daily':
      return getDayKey(date)
    case 'weekly':
      return getWeekKey(date)
    case 'monthly':
    default:
      return getMonthKey(date)
  }
}

// Get label based on granularity
export function getTimeLabel(key: string, granularity: 'daily' | 'weekly' | 'monthly'): string {
  switch (granularity) {
    case 'daily':
      return getDayLabel(key)
    case 'weekly':
      return getWeekLabel(key)
    case 'monthly':
    default:
      return getMonthLabel(key)
  }
}

export function getDaysAgo(days: number): Date {
  const date = new Date()
  date.setDate(date.getDate() - days)
  date.setHours(0, 0, 0, 0)
  return date
}

export function getDateRangeFromPreset(preset: string): DateRange {
  const to = new Date()
  to.setHours(23, 59, 59, 999)
  let from: Date

  switch (preset) {
    case '7d':
      from = getDaysAgo(7)
      break
    case '30d':
      from = getDaysAgo(30)
      break
    case '60d':
      from = getDaysAgo(60)
      break
    case '90d':
      from = getDaysAgo(90)
      break
    case '6mo':
      from = getDaysAgo(182) // ~6 months
      break
    case '1yr':
      from = getDaysAgo(365)
      break
    default:
      from = getDaysAgo(30)
  }

  return { from, to, preset: preset as any }
}

// KPI Calculations

export function calculateKPIs(
  shipments: ShipmentData[],
  additionalServices: AdditionalServiceData[],
  returns: ReturnData[],
  receiving: ReceivingData[],
  storage: StorageData[],
  credits: CreditData[],
  dateRange: DateRange,
  previousDateRange: DateRange
): KPIMetrics {
  // Current period
  const currentShipments = shipments.filter(s =>
    isWithinDateRange(s.transactionDate, dateRange)
  )

  const totalCost = currentShipments.reduce((sum, s) => sum + s.originalInvoice, 0)
  const orderCount = currentShipments.length
  const avgTransitTime =
    currentShipments.reduce((sum, s) => sum + (s.transitTimeDays || 0), 0) /
    (currentShipments.filter(s => s.transitTimeDays !== null).length || 1)

  const slaMetrics = calculateSLAMetrics(currentShipments)
  const slaPercent = slaMetrics.onTimePercent
  const lateOrders = slaMetrics.breachedCount
  const undelivered = currentShipments.filter(s => !s.deliveredDate).length

  // Previous period for comparison
  const previousShipments = shipments.filter(s =>
    isWithinDateRange(s.transactionDate, previousDateRange)
  )

  const prevTotalCost = previousShipments.reduce((sum, s) => sum + s.originalInvoice, 0)
  const prevOrderCount = previousShipments.length
  const prevAvgTransitTime =
    previousShipments.reduce((sum, s) => sum + (s.transitTimeDays || 0), 0) /
    (previousShipments.filter(s => s.transitTimeDays !== null).length || 1)
  const prevSlaMetrics = calculateSLAMetrics(previousShipments)
  const prevSlaPercent = prevSlaMetrics.onTimePercent
  const prevLateOrders = prevSlaMetrics.breachedCount
  const prevUndelivered = previousShipments.filter(s => !s.deliveredDate).length

  return {
    totalCost,
    orderCount,
    avgTransitTime,
    slaPercent,
    lateOrders,
    undelivered,
    periodChange: {
      totalCost: calculatePercentChange(totalCost, prevTotalCost),
      orderCount: calculatePercentChange(orderCount, prevOrderCount),
      avgTransitTime: calculatePercentChange(avgTransitTime, prevAvgTransitTime),
      slaPercent: slaPercent - prevSlaPercent, // percentage points
      lateOrders: calculatePercentChange(lateOrders, prevLateOrders),
      undelivered: calculatePercentChange(undelivered, prevUndelivered),
    },
  }
}

function calculatePercentChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

// Billing Summary Aggregations

export function aggregateMonthlyInvoices(
  shipments: ShipmentData[],
  additionalServices: AdditionalServiceData[],
  returns: ReturnData[],
  receiving: ReceivingData[],
  storage: StorageData[],
  dateRange: DateRange
): MonthlyInvoiceData[] {
  const monthMap = new Map<string, MonthlyInvoiceData>()

  // Aggregate shipments
  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .forEach(s => {
      const month = getMonthKey(s.transactionDate)
      if (!monthMap.has(month)) {
        monthMap.set(month, {
          month,
          fulfillmentBase: 0,
          surcharges: 0,
          additionalServices: 0,
          storage: 0,
          returns: 0,
          receiving: 0,
          total: 0,
        })
      }
      const data = monthMap.get(month)!
      data.fulfillmentBase += s.fulfillmentWithoutSurcharge
      data.surcharges += s.surchargeApplied
      data.total += s.originalInvoice
    })

  // Aggregate additional services
  additionalServices
    .filter(a => isWithinDateRange(a.transactionDate, dateRange))
    .forEach(a => {
      const month = getMonthKey(a.transactionDate)
      if (!monthMap.has(month)) {
        monthMap.set(month, {
          month,
          fulfillmentBase: 0,
          surcharges: 0,
          additionalServices: 0,
          storage: 0,
          returns: 0,
          receiving: 0,
          total: 0,
        })
      }
      const data = monthMap.get(month)!
      data.additionalServices += a.invoiceAmount
      data.total += a.invoiceAmount
    })

  // Aggregate returns
  returns
    .filter(r => isWithinDateRange(r.returnCreationDate, dateRange))
    .forEach(r => {
      const month = getMonthKey(r.returnCreationDate)
      if (!monthMap.has(month)) {
        monthMap.set(month, {
          month,
          fulfillmentBase: 0,
          surcharges: 0,
          additionalServices: 0,
          storage: 0,
          returns: 0,
          receiving: 0,
          total: 0,
        })
      }
      const data = monthMap.get(month)!
      data.returns += r.invoice
      data.total += r.invoice
    })

  // Aggregate receiving
  receiving
    .filter(r => isWithinDateRange(r.transactionDate, dateRange))
    .forEach(r => {
      const month = getMonthKey(r.transactionDate)
      if (!monthMap.has(month)) {
        monthMap.set(month, {
          month,
          fulfillmentBase: 0,
          surcharges: 0,
          additionalServices: 0,
          storage: 0,
          returns: 0,
          receiving: 0,
          total: 0,
        })
      }
      const data = monthMap.get(month)!
      data.receiving += r.invoiceAmount
      data.total += r.invoiceAmount
    })

  // Aggregate storage
  storage
    .filter(s => isWithinDateRange(s.chargeStartDate, dateRange))
    .forEach(s => {
      const month = getMonthKey(s.chargeStartDate)
      if (!monthMap.has(month)) {
        monthMap.set(month, {
          month,
          fulfillmentBase: 0,
          surcharges: 0,
          additionalServices: 0,
          storage: 0,
          returns: 0,
          receiving: 0,
          total: 0,
        })
      }
      const data = monthMap.get(month)!
      data.storage += s.invoice
      data.total += s.invoice
    })

  return Array.from(monthMap.values()).sort((a, b) => a.month.localeCompare(b.month))
}

// Carrier Performance Aggregations

export function aggregateCarrierPerformance(
  shipments: ShipmentData[],
  dateRange: DateRange
): CarrierPerformance[] {
  const carrierMap = new Map<string, {
    orderCount: number
    totalCost: number
    totalTransitTime: number
    transitTimeCount: number
    onTimeCount: number
    breachedCount: number
  }>()

  const slaMetrics = calculateSLAMetrics(
    shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))
  )
  const slaByOrder = new Map(slaMetrics.shipments.map(s => [s.orderId, s]))

  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .forEach(s => {
      if (!carrierMap.has(s.carrier)) {
        carrierMap.set(s.carrier, {
          orderCount: 0,
          totalCost: 0,
          totalTransitTime: 0,
          transitTimeCount: 0,
          onTimeCount: 0,
          breachedCount: 0,
        })
      }
      const data = carrierMap.get(s.carrier)!
      data.orderCount++
      data.totalCost += s.originalInvoice
      if (s.transitTimeDays !== null) {
        data.totalTransitTime += s.transitTimeDays
        data.transitTimeCount++
      }

      const sla = slaByOrder.get(s.orderId)
      if (sla) {
        if (sla.isOnTime) data.onTimeCount++
        if (sla.isBreach) data.breachedCount++
      }
    })

  return Array.from(carrierMap.entries())
    .map(([carrier, data]) => ({
      carrier,
      orderCount: data.orderCount,
      avgCost: data.totalCost / data.orderCount,
      totalCost: data.totalCost,
      avgTransitTime: data.transitTimeCount > 0
        ? data.totalTransitTime / data.transitTimeCount
        : 0,
      onTimePercent: data.orderCount > 0
        ? (data.onTimeCount / data.orderCount) * 100
        : 0,
      breachedOrders: data.breachedCount,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
}

// Ship Option Aggregations

export function aggregateShipOptions(
  shipments: ShipmentData[],
  dateRange: DateRange
): ShipOptionMetrics[] {
  const optionMap = new Map<string, {
    carrierService: string
    orderCount: number
    totalCost: number
    totalCostWithSurcharge: number
    totalTransitTime: number
    transitTimeCount: number
  }>()

  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .forEach(s => {
      if (!optionMap.has(s.shipOptionId)) {
        optionMap.set(s.shipOptionId, {
          carrierService: s.carrierService,
          orderCount: 0,
          totalCost: 0,
          totalCostWithSurcharge: 0,
          totalTransitTime: 0,
          transitTimeCount: 0,
        })
      }
      const data = optionMap.get(s.shipOptionId)!
      data.orderCount++
      data.totalCost += s.fulfillmentWithoutSurcharge
      data.totalCostWithSurcharge += s.originalInvoice
      if (s.transitTimeDays !== null) {
        data.totalTransitTime += s.transitTimeDays
        data.transitTimeCount++
      }
    })

  return Array.from(optionMap.entries())
    .map(([shipOptionId, data]) => ({
      shipOptionId,
      carrierService: data.carrierService,
      orderCount: data.orderCount,
      avgCost: data.totalCost / data.orderCount,
      avgCostWithSurcharge: data.totalCostWithSurcharge / data.orderCount,
      avgTransitTime: data.transitTimeCount > 0
        ? data.totalTransitTime / data.transitTimeCount
        : 0,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
}

// Zone Aggregations

export function aggregateZoneMetrics(
  shipments: ShipmentData[],
  dateRange: DateRange
): ZoneMetrics[] {
  const zoneMap = new Map<string, {
    orderCount: number
    totalCost: number
    totalTransitTime: number
    transitTimeCount: number
  }>()

  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .forEach(s => {
      if (!zoneMap.has(s.zoneUsed)) {
        zoneMap.set(s.zoneUsed, {
          orderCount: 0,
          totalCost: 0,
          totalTransitTime: 0,
          transitTimeCount: 0,
        })
      }
      const data = zoneMap.get(s.zoneUsed)!
      data.orderCount++
      data.totalCost += s.originalInvoice
      if (s.transitTimeDays !== null) {
        data.totalTransitTime += s.transitTimeDays
        data.transitTimeCount++
      }
    })

  return Array.from(zoneMap.entries())
    .map(([zone, data]) => ({
      zone,
      orderCount: data.orderCount,
      avgCost: data.totalCost / data.orderCount,
      avgTransitTime: data.transitTimeCount > 0
        ? data.totalTransitTime / data.transitTimeCount
        : 0,
    }))
    .sort((a, b) => parseInt(a.zone) - parseInt(b.zone))
}

// SLA Calculations

export function calculateSLAMetrics(
  shipments: ShipmentData[],
  timeToShipThresholdHours: number = 12
): {
  shipments: SLAMetrics[]
  onTimePercent: number
  breachedCount: number
} {
  const slaShipments: SLAMetrics[] = shipments.map(s => {
    const orderInsert = new Date(s.orderInsertTimestamp)
    const labelGen = new Date(s.labelGenerationTimestamp)
    const timeToShipHours = (labelGen.getTime() - orderInsert.getTime()) / (1000 * 60 * 60)

    // SLA Rule:
    // - Orders before 2pm local time: label must be generated by midnight same day
    // - Orders at/after 2pm local time: label must be generated by midnight next day
    const orderHour = orderInsert.getHours()
    let slaDeadline: Date

    if (orderHour < 14) {  // Before 2pm
      // Deadline is midnight same day
      slaDeadline = new Date(orderInsert)
      slaDeadline.setHours(23, 59, 59, 999)
    } else {  // 2pm or later
      // Deadline is midnight next day
      slaDeadline = new Date(orderInsert)
      slaDeadline.setDate(slaDeadline.getDate() + 1)
      slaDeadline.setHours(23, 59, 59, 999)
    }

    const isOnTime = labelGen <= slaDeadline
    const isBreach = labelGen > slaDeadline

    return {
      orderId: s.orderId,
      trackingId: s.trackingId,
      customerName: s.customerName,
      orderInsertTimestamp: s.orderInsertTimestamp,
      labelGenerationTimestamp: s.labelGenerationTimestamp,
      deliveredDate: s.deliveredDate,
      timeToShipHours,
      transitTimeDays: s.transitTimeDays,
      carrier: s.carrier,
      isOnTime,
      isBreach,
    }
  })

  const onTimeCount = slaShipments.filter(s => s.isOnTime).length
  const onTimePercent = shipments.length > 0
    ? (onTimeCount / shipments.length) * 100
    : 0
  const breachedCount = slaShipments.filter(s => s.isBreach).length

  return {
    shipments: slaShipments,
    onTimePercent,
    breachedCount,
  }
}

// Undelivered Shipments

export function getUndeliveredShipments(
  shipments: ShipmentData[]
): UndeliveredShipment[] {
  const now = new Date()

  return shipments
    .filter(s => !s.deliveredDate)
    .map(s => {
      const labelGen = new Date(s.labelGenerationTimestamp)
      const daysInTransit = Math.floor(
        (now.getTime() - labelGen.getTime()) / (1000 * 60 * 60 * 24)
      )

      return {
        trackingId: s.trackingId,
        orderId: s.orderId,
        customerName: s.customerName,
        labelGenerationTimestamp: s.labelGenerationTimestamp,
        daysInTransit,
        status: daysInTransit > 14 ? 'Exception' : 'In Transit',
        carrier: s.carrier,
        destination: `${s.city}, ${s.state}`,
        lastUpdate: s.labelGenerationTimestamp, // In real system, would have tracking updates
      }
    })
    .sort((a, b) => b.daysInTransit - a.daysInTransit)
}

// State Performance Aggregations

const STATE_NAMES: Record<string, string> = {
  'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas',
  'CA': 'California', 'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware',
  'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho',
  'IL': 'Illinois', 'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas',
  'KY': 'Kentucky', 'LA': 'Louisiana', 'ME': 'Maine', 'MD': 'Maryland',
  'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota', 'MS': 'Mississippi',
  'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
  'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
  'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma',
  'OR': 'Oregon', 'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina',
  'SD': 'South Dakota', 'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah',
  'VT': 'Vermont', 'VA': 'Virginia', 'WA': 'Washington', 'WV': 'West Virginia',
  'WI': 'Wisconsin', 'WY': 'Wyoming'
}

export function aggregateStatePerformance(
  shipments: ShipmentData[],
  dateRange: DateRange
): StatePerformance[] {
  const stateMap = new Map<string, {
    orderCount: number
    shippedCount: number
    deliveredCount: number
    totalDeliveryTime: number
    deliveredWithTimeCount: number
  }>()

  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .forEach(s => {
      if (!stateMap.has(s.state)) {
        stateMap.set(s.state, {
          orderCount: 0,
          shippedCount: 0,
          deliveredCount: 0,
          totalDeliveryTime: 0,
          deliveredWithTimeCount: 0,
        })
      }
      const data = stateMap.get(s.state)!
      data.orderCount++

      // Shipped if label was generated
      if (s.labelGenerationTimestamp) {
        data.shippedCount++
      }

      // Delivered if has delivery date
      if (s.deliveredDate) {
        data.deliveredCount++

        // Calculate time from order insert to delivery
        const orderInsert = new Date(s.orderInsertTimestamp)
        const delivered = new Date(s.deliveredDate)
        const deliveryTimeDays = (delivered.getTime() - orderInsert.getTime()) / (1000 * 60 * 60 * 24)
        data.totalDeliveryTime += deliveryTimeDays
        data.deliveredWithTimeCount++
      }
    })

  return Array.from(stateMap.entries())
    .map(([state, data]) => ({
      state,
      stateName: STATE_NAMES[state] || state,
      orderCount: data.orderCount,
      shippedCount: data.shippedCount,
      deliveredCount: data.deliveredCount,
      avgDeliveryTimeDays: data.deliveredWithTimeCount > 0
        ? data.totalDeliveryTime / data.deliveredWithTimeCount
        : 0,
      shippedPercent: data.orderCount > 0
        ? (data.shippedCount / data.orderCount) * 100
        : 0,
      deliveredPercent: data.orderCount > 0
        ? (data.deliveredCount / data.orderCount) * 100
        : 0,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
}

// Fulfillment Time Trend Aggregation

export function aggregateFulfillmentTrend(
  shipments: ShipmentData[],
  dateRange: DateRange
): FulfillmentTrendData[] {
  const dailyMap = new Map<string, number[]>()

  // Group fulfillment times by date
  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .forEach(s => {
      const orderDate = new Date(s.orderInsertTimestamp).toISOString().split('T')[0]
      const orderInsert = new Date(s.orderInsertTimestamp)
      const labelGen = new Date(s.labelGenerationTimestamp)
      const fulfillmentHours = (labelGen.getTime() - orderInsert.getTime()) / (1000 * 60 * 60)

      if (!dailyMap.has(orderDate)) {
        dailyMap.set(orderDate, [])
      }
      dailyMap.get(orderDate)!.push(fulfillmentHours)
    })

  // Calculate statistics for each day
  return Array.from(dailyMap.entries())
    .map(([date, times]) => {
      const sorted = times.sort((a, b) => a - b)
      const avg = times.reduce((sum, t) => sum + t, 0) / times.length
      const median = sorted[Math.floor(sorted.length / 2)]
      const p90Index = Math.floor(sorted.length * 0.9)
      const p90 = sorted[p90Index]

      return {
        date,
        avgFulfillmentHours: avg,
        medianFulfillmentHours: median,
        p90FulfillmentHours: p90,
        orderCount: times.length,
      }
    })
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
}

// Fulfillment Speed by FC Aggregation

export function aggregateFCFulfillmentMetrics(
  shipments: ShipmentData[],
  dateRange: DateRange
): FCFulfillmentMetrics[] {
  const fcMap = new Map<string, {
    totalFulfillmentTime: number
    orderCount: number
    breachedCount: number
  }>()

  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .forEach(s => {
      const fcName = s.fcName || 'Unknown'
      if (!fcMap.has(fcName)) {
        fcMap.set(fcName, {
          totalFulfillmentTime: 0,
          orderCount: 0,
          breachedCount: 0,
        })
      }

      const data = fcMap.get(fcName)!
      const orderInsert = new Date(s.orderInsertTimestamp)
      const labelGen = new Date(s.labelGenerationTimestamp)
      const fulfillmentHours = (labelGen.getTime() - orderInsert.getTime()) / (1000 * 60 * 60)

      data.totalFulfillmentTime += fulfillmentHours
      data.orderCount++

      // Check if breached (same logic as calculateSLAMetrics)
      const orderHour = orderInsert.getHours()
      let slaDeadline: Date

      if (orderHour < 14) {
        slaDeadline = new Date(orderInsert)
        slaDeadline.setHours(23, 59, 59, 999)
      } else {
        slaDeadline = new Date(orderInsert)
        slaDeadline.setDate(slaDeadline.getDate() + 1)
        slaDeadline.setHours(23, 59, 59, 999)
      }

      if (labelGen > slaDeadline) {
        data.breachedCount++
      }
    })

  return Array.from(fcMap.entries())
    .map(([fcName, data]) => ({
      fcName,
      avgFulfillmentHours: data.totalFulfillmentTime / data.orderCount,
      breachRate: (data.breachedCount / data.orderCount) * 100,
      orderCount: data.orderCount,
      breachedCount: data.breachedCount,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
}

// Cost + Speed Analysis Aggregators

/**
 * Aggregates cost trends by month showing average cost with and without surcharges
 */
export function aggregateCostTrend(
  shipments: ShipmentData[],
  dateRange: DateRange
): CostTrendData[] {
  // Aggregate by day (not month) so bar chart shows one bar per day
  const dailyMap = new Map<string, {
    totalCostBase: number
    totalCostWithSurcharge: number
    orderCount: number
  }>()

  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .forEach(s => {
      // Use date string directly (YYYY-MM-DD format)
      const day = s.transactionDate.split('T')[0]

      if (!dailyMap.has(day)) {
        dailyMap.set(day, {
          totalCostBase: 0,
          totalCostWithSurcharge: 0,
          orderCount: 0,
        })
      }

      const data = dailyMap.get(day)!
      data.totalCostBase += s.fulfillmentWithoutSurcharge
      data.totalCostWithSurcharge += s.fulfillmentWithoutSurcharge + s.surchargeApplied
      data.orderCount++
    })

  return Array.from(dailyMap.entries())
    .map(([day, data]) => {
      const avgCostBase = data.totalCostBase / data.orderCount
      const avgCostWithSurcharge = data.totalCostWithSurcharge / data.orderCount
      return {
        month: day, // Keep field name for compatibility but it's actually a day
        avgCostBase,
        avgCostWithSurcharge,
        surchargeOnly: avgCostWithSurcharge - avgCostBase,
        orderCount: data.orderCount,
      }
    })
    .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime())
}

/**
 * Aggregates order volume by month with growth percentage
 */
export function aggregateOrderVolumeTrend(
  shipments: ShipmentData[],
  dateRange: DateRange
): OrderVolumeTrendData[] {
  const monthlyMap = new Map<string, number>()

  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .forEach(s => {
      const month = getMonthKey(s.transactionDate)
      monthlyMap.set(month, (monthlyMap.get(month) || 0) + 1)
    })

  const sorted = Array.from(monthlyMap.entries())
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())

  return sorted.map(([month, orderCount], index) => {
    let growthPercent: number | null = null

    if (index > 0) {
      const prevCount = sorted[index - 1][1]
      growthPercent = ((orderCount - prevCount) / prevCount) * 100
    }

    return {
      month,
      orderCount,
      growthPercent,
    }
  })
}

/**
 * Aggregates cost and transit time performance by ship option
 */
export function aggregateShipOptionPerformance(
  shipments: ShipmentData[],
  dateRange: DateRange
): ShipOptionPerformanceData[] {
  const optionMap = new Map<string, {
    carrierService: string
    totalCost: number
    totalTransitTime: number
    orderCount: number
    transitTimeCount: number
  }>()

  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .forEach(s => {
      const key = s.shipOptionId || 'Unknown'

      if (!optionMap.has(key)) {
        optionMap.set(key, {
          carrierService: s.carrierService || 'Unknown',
          totalCost: 0,
          totalTransitTime: 0,
          orderCount: 0,
          transitTimeCount: 0,
        })
      }

      const data = optionMap.get(key)!
      data.totalCost += s.fulfillmentWithoutSurcharge + s.surchargeApplied
      data.orderCount++

      if (s.transitTimeDays !== null && s.transitTimeDays > 0) {
        data.totalTransitTime += s.transitTimeDays
        data.transitTimeCount++
      }
    })

  return Array.from(optionMap.entries())
    .map(([shipOptionId, data]) => ({
      shipOptionId,
      carrierService: data.carrierService,
      avgCost: data.totalCost / data.orderCount,
      avgTransitTime: data.transitTimeCount > 0
        ? data.totalTransitTime / data.transitTimeCount
        : 0,
      orderCount: data.orderCount,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
}

/**
 * Aggregates cost vs transit time data for scatter plot
 */
export function aggregateCostVsTransit(
  shipments: ShipmentData[],
  dateRange: DateRange
): CostVsTransitData[] {
  const serviceMap = new Map<string, {
    carrier: string
    totalCost: number
    totalTransitTime: number
    orderCount: number
    transitTimeCount: number
  }>()

  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .filter(s => s.transitTimeDays !== null && s.transitTimeDays > 0)
    .forEach(s => {
      const key = `${s.carrier}|${s.carrierService}`

      if (!serviceMap.has(key)) {
        serviceMap.set(key, {
          carrier: s.carrier || 'Unknown',
          totalCost: 0,
          totalTransitTime: 0,
          orderCount: 0,
          transitTimeCount: 0,
        })
      }

      const data = serviceMap.get(key)!
      data.totalCost += s.fulfillmentWithoutSurcharge + s.surchargeApplied
      data.orderCount++

      if (s.transitTimeDays !== null && s.transitTimeDays > 0) {
        data.totalTransitTime += s.transitTimeDays
        data.transitTimeCount++
      }
    })

  return Array.from(serviceMap.entries())
    .map(([key, data]) => ({
      carrier: data.carrier,
      carrierService: key.split('|')[1] || 'Unknown',
      avgCost: data.totalCost / data.orderCount,
      avgTransitTime: data.transitTimeCount > 0
        ? data.totalTransitTime / data.transitTimeCount
        : 0,
      orderCount: data.orderCount,
    }))
    .filter(d => d.orderCount >= 5) // Only include services with meaningful volume
    .sort((a, b) => b.orderCount - a.orderCount)
}

/**
 * Aggregates transit time distribution by carrier for box plot
 */
export function aggregateTransitTimeDistribution(
  shipments: ShipmentData[],
  dateRange: DateRange
): TransitTimeDistributionData[] {
  const carrierMap = new Map<string, number[]>()

  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .filter(s => s.transitTimeDays !== null && s.transitTimeDays > 0)
    .forEach(s => {
      const carrier = s.carrier || 'Unknown'

      if (!carrierMap.has(carrier)) {
        carrierMap.set(carrier, [])
      }

      carrierMap.get(carrier)!.push(s.transitTimeDays!)
    })

  return Array.from(carrierMap.entries())
    .map(([carrier, times]) => {
      const sorted = times.sort((a, b) => a - b)
      const len = sorted.length

      return {
        carrier,
        min: sorted[0],
        q1: sorted[Math.floor(len * 0.25)],
        median: sorted[Math.floor(len * 0.5)],
        q3: sorted[Math.floor(len * 0.75)],
        max: sorted[len - 1],
        orderCount: len,
      }
    })
    .filter(d => d.orderCount >= 10) // Only include carriers with meaningful volume
    .sort((a, b) => b.orderCount - a.orderCount)
}

/**
 * Aggregates combined cost and speed trends by month for dual-axis chart
 */
export function aggregateCostSpeedTrend(
  shipments: ShipmentData[],
  dateRange: DateRange
): CostSpeedTrendData[] {
  const monthlyMap = new Map<string, {
    totalCost: number
    totalTransitTime: number
    orderCount: number
    transitTimeCount: number
  }>()

  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .forEach(s => {
      const month = getMonthKey(s.transactionDate)

      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, {
          totalCost: 0,
          totalTransitTime: 0,
          orderCount: 0,
          transitTimeCount: 0,
        })
      }

      const data = monthlyMap.get(month)!
      data.totalCost += s.fulfillmentWithoutSurcharge + s.surchargeApplied
      data.orderCount++

      if (s.transitTimeDays !== null && s.transitTimeDays > 0) {
        data.totalTransitTime += s.transitTimeDays
        data.transitTimeCount++
      }
    })

  return Array.from(monthlyMap.entries())
    .map(([month, data]) => ({
      month,
      avgCost: data.totalCost / data.orderCount,
      avgTransitTime: data.transitTimeCount > 0
        ? data.totalTransitTime / data.transitTimeCount
        : 0,
      orderCount: data.orderCount,
    }))
    .sort((a, b) => new Date(a.month).getTime() - new Date(b.month).getTime())
}

// Order Volume Analysis Aggregators

/**
 * Aggregates order volume by hour of day
 */
export function aggregateOrderVolumeByHour(
  shipments: ShipmentData[],
  dateRange: DateRange
): OrderVolumeByHour[] {
  const hourMap = new Map<number, number>()

  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))
  const totalOrders = filtered.length

  filtered.forEach(s => {
    const hour = new Date(s.orderInsertTimestamp).getHours()
    hourMap.set(hour, (hourMap.get(hour) || 0) + 1)
  })

  // Fill in all hours (0-23) even if there are no orders
  const result: OrderVolumeByHour[] = []
  for (let hour = 0; hour < 24; hour++) {
    const orderCount = hourMap.get(hour) || 0
    result.push({
      hour,
      orderCount,
      percent: totalOrders > 0 ? (orderCount / totalOrders) * 100 : 0,
    })
  }

  return result
}

/**
 * Aggregates order volume by day of week
 */
export function aggregateOrderVolumeByDayOfWeek(
  shipments: ShipmentData[],
  dateRange: DateRange
): OrderVolumeByDayOfWeek[] {
  const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  const dayMap = new Map<number, number>()

  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))
  const totalOrders = filtered.length

  filtered.forEach(s => {
    const day = new Date(s.orderInsertTimestamp).getDay()
    dayMap.set(day, (dayMap.get(day) || 0) + 1)
  })

  // Fill in all days (0-6) even if there are no orders
  const result: OrderVolumeByDayOfWeek[] = []
  for (let day = 0; day < 7; day++) {
    const orderCount = dayMap.get(day) || 0
    result.push({
      dayOfWeek: day,
      dayName: dayNames[day],
      orderCount,
      percent: totalOrders > 0 ? (orderCount / totalOrders) * 100 : 0,
    })
  }

  return result
}

/**
 * Aggregates order volume by fulfillment center
 */
export function aggregateOrderVolumeByFC(
  shipments: ShipmentData[],
  dateRange: DateRange
): OrderVolumeByFC[] {
  const fcMap = new Map<string, number>()

  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))
  const totalOrders = filtered.length

  filtered.forEach(s => {
    const fc = s.fcName || 'Unknown'
    fcMap.set(fc, (fcMap.get(fc) || 0) + 1)
  })

  return Array.from(fcMap.entries())
    .map(([fcName, orderCount]) => ({
      fcName,
      orderCount,
      percent: totalOrders > 0 ? (orderCount / totalOrders) * 100 : 0,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
}

/**
 * Aggregates order volume by store integration
 */
export function aggregateOrderVolumeByStore(
  shipments: ShipmentData[],
  dateRange: DateRange
): OrderVolumeByStore[] {
  const storeMap = new Map<string, number>()

  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))
  const totalOrders = filtered.length

  filtered.forEach(s => {
    const store = s.storeIntegrationName || 'Unknown'
    storeMap.set(store, (storeMap.get(store) || 0) + 1)
  })

  return Array.from(storeMap.entries())
    .map(([storeIntegrationName, orderCount]) => ({
      storeIntegrationName,
      orderCount,
      percent: totalOrders > 0 ? (orderCount / totalOrders) * 100 : 0,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
}

/**
 * Aggregates daily order volume with growth percentage
 */
export function aggregateDailyOrderVolume(
  shipments: ShipmentData[],
  dateRange: DateRange
): DailyOrderVolume[] {
  const dailyMap = new Map<string, number>()

  shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .forEach(s => {
      const date = new Date(s.transactionDate).toISOString().split('T')[0]
      dailyMap.set(date, (dailyMap.get(date) || 0) + 1)
    })

  const sorted = Array.from(dailyMap.entries())
    .sort((a, b) => new Date(a[0]).getTime() - new Date(b[0]).getTime())

  return sorted.map(([date, orderCount], index) => {
    let growthPercent: number | null = null

    if (index > 0) {
      const prevCount = sorted[index - 1][1]
      growthPercent = ((orderCount - prevCount) / prevCount) * 100
    }

    return {
      date,
      orderCount,
      growthPercent,
    }
  })
}

/**
 * Aggregates order volume by state with zip code awareness
 */
export function aggregateStateVolume(
  shipments: ShipmentData[],
  dateRange: DateRange
): StateVolumeData[] {
  const stateMap = new Map<string, number>()

  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))
  const totalOrders = filtered.length

  // Calculate date range in days for avg orders per day
  const daysDiff = Math.ceil((dateRange.to.getTime() - dateRange.from.getTime()) / (1000 * 60 * 60 * 24))
  const daysInRange = daysDiff > 0 ? daysDiff : 1

  filtered.forEach(s => {
    const state = s.state || 'Unknown'
    stateMap.set(state, (stateMap.get(state) || 0) + 1)
  })

  return Array.from(stateMap.entries())
    .map(([state, orderCount]) => ({
      state,
      stateName: STATE_NAMES[state] || state,
      orderCount,
      percent: totalOrders > 0 ? (orderCount / totalOrders) * 100 : 0,
      avgOrdersPerDay: orderCount / daysInRange,
    }))
    .sort((a, b) => b.orderCount - a.orderCount)
}

/**
 * Aggregates order volume by city for a specific state
 */
export function aggregateCityVolumeByState(
  shipments: ShipmentData[],
  dateRange: DateRange,
  stateCode: string
): CityVolumeData[] {
  const cityMap = new Map<string, { zipCode: string; count: number }>()

  const filtered = shipments
    .filter(s => isWithinDateRange(s.transactionDate, dateRange))
    .filter(s => s.state === stateCode)

  const totalOrdersInState = filtered.length

  filtered.forEach(s => {
    const city = s.city || 'Unknown'
    const key = `${city}|${s.zipCode}`

    if (!cityMap.has(key)) {
      cityMap.set(key, { zipCode: s.zipCode, count: 0 })
    }

    cityMap.get(key)!.count++
  })

  return Array.from(cityMap.entries())
    .map(([key, data]) => {
      const city = key.split('|')[0]
      return {
        city,
        state: stateCode,
        zipCode: data.zipCode,
        orderCount: data.count,
        percent: totalOrdersInState > 0 ? (data.count / totalOrdersInState) * 100 : 0,
      }
    })
    .sort((a, b) => b.orderCount - a.orderCount)
    .slice(0, 10) // Top 10 cities
}

/**
 * Aggregates order volume by city across all states with coordinates
 * This is more scalable than zip code level for large datasets
 */
export function aggregateCityVolume(
  shipments: ShipmentData[],
  dateRange: DateRange
): Array<CityVolumeData & { lon: number; lat: number }> {
  const cityMap = new Map<string, { state: string; count: number }>()

  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))
  const totalOrders = filtered.length

  filtered.forEach(s => {
    const city = s.city || 'Unknown'
    const state = s.state || 'Unknown'
    const key = `${city}|${state}`

    if (!cityMap.has(key)) {
      cityMap.set(key, { state, count: 0 })
    }

    cityMap.get(key)!.count++
  })

  // State centroids for coordinate generation
  const stateCentroids: Record<string, [number, number]> = {
    'CA': [-119.4, 36.7], 'TX': [-99.9, 31.5], 'FL': [-81.5, 27.8],
    'NY': [-75.5, 43.0], 'PA': [-77.2, 40.9], 'IL': [-89.4, 40.1],
    'OH': [-82.9, 40.4], 'GA': [-83.4, 32.7], 'NC': [-79.0, 35.5],
    'MI': [-84.5, 44.3], 'NJ': [-74.5, 40.2], 'VA': [-78.6, 37.5],
    'WA': [-120.5, 47.4], 'AZ': [-111.1, 34.2], 'MA': [-71.4, 42.2],
    'TN': [-86.6, 35.8], 'IN': [-86.1, 39.8], 'MO': [-92.2, 38.4],
    'MD': [-76.6, 39.0], 'WI': [-89.6, 44.3], 'CO': [-105.6, 39.0],
    'MN': [-94.6, 46.3], 'SC': [-80.9, 33.9], 'AL': [-86.9, 32.8],
    'LA': [-91.9, 31.0], 'KY': [-85.0, 37.8], 'OR': [-120.5, 43.8],
    'OK': [-97.1, 35.5], 'CT': [-72.7, 41.6], 'UT': [-111.9, 39.3],
    'IA': [-93.5, 42.0], 'NV': [-116.4, 38.3], 'AR': [-92.4, 34.9],
    'MS': [-89.7, 32.7], 'KS': [-98.4, 38.5], 'NM': [-106.1, 34.3],
    'NE': [-99.8, 41.5], 'WV': [-80.6, 38.6], 'ID': [-114.5, 44.1],
    'HI': [-157.5, 19.9], 'NH': [-71.6, 43.9], 'ME': [-69.4, 45.4],
    'RI': [-71.5, 41.7], 'MT': [-110.3, 47.0], 'DE': [-75.5, 39.0],
    'SD': [-100.2, 44.5], 'ND': [-100.5, 47.5], 'AK': [-152.4, 64.2],
    'VT': [-72.6, 44.0], 'WY': [-107.5, 43.0]
  }

  return Array.from(cityMap.entries())
    .map(([key, data]) => {
      const [city, state] = key.split('|')

      // Try to get exact coordinates from the cities database
      const cityKey = `${city.toUpperCase()}|${state}`
      const exactCoords = usCitiesCoordinates.get(cityKey)

      let lon: number
      let lat: number

      if (exactCoords) {
        // Use exact coordinates from database
        lon = exactCoords[0]
        lat = exactCoords[1]
      } else {
        // Fallback: use state centroid with small offset for unmapped cities
        const baseCoord = stateCentroids[state] || [-98.5, 39.8]

        // Ensure baseCoord is valid
        if (!Array.isArray(baseCoord) || baseCoord.length !== 2 ||
            typeof baseCoord[0] !== 'number' || typeof baseCoord[1] !== 'number' ||
            isNaN(baseCoord[0]) || isNaN(baseCoord[1])) {
          console.error('Invalid baseCoord for state:', state, baseCoord)
          return null
        }

        // Small pseudo-random offset for unmapped cities
        const cityHash1 = city.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i + 1), 0)
        const cityHash2 = city.split('').reduce((acc, char, i) => acc + char.charCodeAt(0) * (i * 7 + 3), 0)
        const latOffset = ((cityHash1 % 100) - 50) / 100
        const lonOffset = ((cityHash2 % 100) - 50) / 100

        lon = baseCoord[0] + lonOffset
        lat = baseCoord[1] + latOffset
      }

      // Final validation
      if (isNaN(lon) || isNaN(lat) || !isFinite(lon) || !isFinite(lat)) {
        console.error('Invalid calculated coordinates for city:', city, { lon, lat })
        return null
      }

      return {
        city,
        state,
        zipCode: '', // Not applicable for city-level aggregation
        orderCount: data.count,
        percent: totalOrders > 0 ? (data.count / totalOrders) * 100 : 0,
        lon,
        lat
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.orderCount - a.orderCount)
}

/**
 * Aggregates order volume by zip code with approximate coordinates
 */
export function aggregateZipCodeVolume(
  shipments: ShipmentData[],
  dateRange: DateRange
): ZipCodeVolumeData[] {
  const zipMap = new Map<string, { city: string; state: string; count: number }>()

  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))
  const totalOrders = filtered.length

  filtered.forEach(s => {
    const zip = s.zipCode || 'Unknown'
    if (!zipMap.has(zip)) {
      zipMap.set(zip, { city: s.city || 'Unknown', state: s.state, count: 0 })
    }
    zipMap.get(zip)!.count++
  })

  // State centroids (approximate lat/long for demonstration)
  // In production, use a proper zip code database
  const stateCentroids: Record<string, [number, number]> = {
    'CA': [-119.4, 36.7], 'TX': [-99.9, 31.5], 'FL': [-81.5, 27.8],
    'NY': [-75.5, 43.0], 'PA': [-77.2, 40.9], 'IL': [-89.4, 40.1],
    'OH': [-82.9, 40.4], 'GA': [-83.4, 32.7], 'NC': [-79.0, 35.5],
    'MI': [-84.5, 44.3], 'NJ': [-74.5, 40.2], 'VA': [-78.6, 37.5],
    'WA': [-120.5, 47.4], 'AZ': [-111.1, 34.2], 'MA': [-71.4, 42.2],
    'TN': [-86.6, 35.8], 'IN': [-86.1, 39.8], 'MO': [-92.2, 38.4],
    'MD': [-76.6, 39.0], 'WI': [-89.6, 44.3], 'CO': [-105.6, 39.0],
    'MN': [-94.6, 46.3], 'SC': [-80.9, 33.9], 'AL': [-86.9, 32.8],
    'LA': [-91.9, 31.0], 'KY': [-85.0, 37.8], 'OR': [-120.5, 43.8],
    'OK': [-97.1, 35.5], 'CT': [-72.7, 41.6], 'UT': [-111.9, 39.3],
    'IA': [-93.5, 42.0], 'NV': [-116.4, 38.3], 'AR': [-92.4, 34.9],
    'MS': [-89.7, 32.7], 'KS': [-98.4, 38.5], 'NM': [-106.1, 34.3],
    'NE': [-99.8, 41.5], 'WV': [-80.6, 38.6], 'ID': [-114.5, 44.1],
    'HI': [-157.5, 19.9], 'NH': [-71.6, 43.9], 'ME': [-69.4, 45.4],
    'RI': [-71.5, 41.7], 'MT': [-110.3, 47.0], 'DE': [-75.5, 39.0],
    'SD': [-100.2, 44.5], 'ND': [-100.5, 47.5], 'AK': [-152.4, 64.2],
    'VT': [-72.6, 44.0], 'WY': [-107.5, 43.0]
  }

  return Array.from(zipMap.entries())
    .map(([zipCode, data]) => {
      // Get state centroid and add some random variation for visualization
      const baseCoord = stateCentroids[data.state] || [-98.5, 39.8] // US center as fallback

      // Ensure baseCoord is valid
      if (!Array.isArray(baseCoord) || baseCoord.length !== 2 ||
          typeof baseCoord[0] !== 'number' || typeof baseCoord[1] !== 'number' ||
          isNaN(baseCoord[0]) || isNaN(baseCoord[1])) {
        console.error('Invalid baseCoord for state:', data.state, baseCoord)
        return null
      }

      // Add pseudo-random variation based on zip code (deterministic)
      const zipNum = parseInt(zipCode) || 0
      const latOffset = ((zipNum % 100) - 50) / 20 // ±2.5 degrees variation
      const lonOffset = ((Math.floor(zipNum / 100) % 100) - 50) / 20

      // Validate offsets
      if (isNaN(latOffset) || isNaN(lonOffset)) {
        console.error('Invalid offsets for zipCode:', zipCode, { latOffset, lonOffset })
        return null
      }

      const lon = baseCoord[0] + lonOffset
      const lat = baseCoord[1] + latOffset

      // Final validation of calculated coordinates
      if (isNaN(lon) || isNaN(lat) || !isFinite(lon) || !isFinite(lat)) {
        console.error('Invalid calculated coordinates for zipCode:', zipCode, { lon, lat })
        return null
      }

      // Create a fresh array (not a tuple reference) to avoid any serialization issues
      const coordinates: [number, number] = [lon, lat]

      return {
        zipCode,
        city: data.city,
        state: data.state,
        orderCount: data.count,
        percent: totalOrders > 0 ? (data.count / totalOrders) * 100 : 0,
        coordinates
      }
    })
    .filter((item): item is NonNullable<typeof item> => item !== null)
    .sort((a, b) => b.orderCount - a.orderCount)
}

/**
 * Aggregates cost and transit time metrics by US state
 */
export function aggregateStateCostSpeed(
  shipments: ShipmentData[],
  dateRange: DateRange
): StateCostSpeedData[] {
  const stateMap = new Map<string, { totalCost: number; totalTransit: number; count: number; transitCount: number }>()

  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))

  filtered.forEach(s => {
    const state = s.state || 'Unknown'
    if (!stateMap.has(state)) {
      stateMap.set(state, { totalCost: 0, totalTransit: 0, count: 0, transitCount: 0 })
    }
    const data = stateMap.get(state)!
    data.totalCost += s.originalInvoice
    data.count++
    if (s.transitTimeDays !== null && s.transitTimeDays > 0) {
      data.totalTransit += s.transitTimeDays
      data.transitCount++
    }
  })

  return Array.from(stateMap.entries())
    .map(([state, data]) => ({
      state,
      stateName: STATE_NAMES[state] || state,
      avgCost: data.count > 0 ? data.totalCost / data.count : 0,
      avgTransitTime: data.transitCount > 0 ? data.totalTransit / data.transitCount : 0,
      orderCount: data.count,
    }))
    .filter(d => d.orderCount > 0)
    .sort((a, b) => b.orderCount - a.orderCount)
}

/**
 * Aggregates cost and transit time metrics by shipping zone
 */
export function aggregateCostByZone(
  shipments: ShipmentData[],
  dateRange: DateRange
): ZoneCostData[] {
  const zoneMap = new Map<string, { totalCost: number; totalTransit: number; count: number; transitCount: number }>()

  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))

  filtered.forEach(s => {
    const zone = s.zoneUsed || 'Unknown'
    if (!zoneMap.has(zone)) {
      zoneMap.set(zone, { totalCost: 0, totalTransit: 0, count: 0, transitCount: 0 })
    }
    const data = zoneMap.get(zone)!
    data.totalCost += s.originalInvoice
    data.count++
    if (s.transitTimeDays !== null && s.transitTimeDays > 0) {
      data.totalTransit += s.transitTimeDays
      data.transitCount++
    }
  })

  return Array.from(zoneMap.entries())
    .map(([zone, data]) => ({
      zone,
      avgCost: data.count > 0 ? data.totalCost / data.count : 0,
      avgTransitTime: data.transitCount > 0 ? data.totalTransit / data.transitCount : 0,
      orderCount: data.count,
    }))
    .filter(d => d.orderCount > 0)
    .sort((a, b) => {
      // Sort zones numerically (Zone 1, Zone 2, etc.)
      const aNum = parseInt(a.zone.replace(/\D/g, '')) || 999
      const bNum = parseInt(b.zone.replace(/\D/g, '')) || 999
      return aNum - bNum
    })
}

// =====================================================
// BILLING ANALYTICS AGGREGATORS
// =====================================================

// Fee category distribution percentages (based on typical fulfillment billing)
// Categories: Shipping, Warehousing, Extra Picks, MultiHub IQ, B2B, VAS/Kitting, Receiving, Duty/Tax
const FEE_DISTRIBUTION = {
  shipping: 0.60,           // ~60% - largest component (shipping + fulfillment)
  warehousing: 0.10,        // ~10% - monthly storage fees
  extraPicks: 0.08,         // ~8% - per pick charges beyond included
  multiHubIQ: 0.04,         // ~4% - Inventory Placement Program costs
  b2b: 0.06,                // ~6% - B2B pick, pack, freight
  vasKitting: 0.03,         // ~3% - value-added services / kitting
  receiving: 0.04,          // ~4% - receiving and putaway
  dutyTax: 0.03,            // ~3% - international duties and taxes
  creditRate: 0.02,         // ~2% of total as credits back
}

// Calculate billing breakdown for a shipment
function calculateShipmentBilling(shipment: ShipmentData) {
  // Shipping is the dominant cost (includes base fulfillment)
  const shipping = shipment.fulfillmentWithoutSurcharge + shipment.surchargeApplied

  // Other fees are proportional to the shipping cost
  const warehousing = shipping * (FEE_DISTRIBUTION.warehousing / FEE_DISTRIBUTION.shipping)

  // Extra picks: only items beyond the first (first pick is included)
  const extraPickItems = Math.max(0, shipment.totalQuantity - 1)
  const extraPicks = extraPickItems * 0.35 // $0.35 per extra pick

  // MultiHub IQ (IPP): ~15% of orders use this service
  const multiHubIQ = Math.random() < 0.15 ? shipping * 0.08 : 0

  // B2B: ~10% of orders have B2B components
  const b2b = Math.random() < 0.10 ? shipping * 0.12 : 0

  // VAS/Kitting: ~20% of orders have VAS
  const vasKitting = Math.random() < 0.20 ? shipping * 0.05 : 0

  // Receiving (amortized across orders)
  const receiving = shipping * (FEE_DISTRIBUTION.receiving / FEE_DISTRIBUTION.shipping) * 0.3

  // Duty/Tax: international orders only
  const dutyTax = shipment.destinationCountry !== 'US' ? shipping * 0.15 : 0

  // Credits are aggregated at monthly level, not per shipment
  const credit = 0

  const total = shipping + warehousing + extraPicks + multiHubIQ + b2b +
                vasKitting + receiving + dutyTax

  return {
    shipping,
    warehousing,
    extraPicks,
    multiHubIQ,
    b2b,
    vasKitting,
    receiving,
    dutyTax,
    credit,
    total,
  }
}

// Billing Summary (totals for the period)
export function calculateBillingSummary(
  shipments: ShipmentData[],
  dateRange: DateRange,
  previousDateRange: DateRange
): BillingSummary {
  const currentShipments = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))
  const previousShipments = shipments.filter(s => isWithinDateRange(s.transactionDate, previousDateRange))

  const currentTotal = currentShipments.reduce((sum, s) => {
    const billing = calculateShipmentBilling(s)
    return sum + billing.total
  }, 0)

  const previousTotal = previousShipments.reduce((sum, s) => {
    const billing = calculateShipmentBilling(s)
    return sum + billing.total
  }, 0)

  const currentCount = currentShipments.length
  const previousCount = previousShipments.length

  const currentCostPerOrder = currentCount > 0 ? currentTotal / currentCount : 0
  const previousCostPerOrder = previousCount > 0 ? previousTotal / previousCount : 0

  return {
    totalCost: currentTotal,
    orderCount: currentCount,
    costPerOrder: currentCostPerOrder,
    periodChange: {
      totalCost: calculatePercentChange(currentTotal, previousTotal),
      orderCount: calculatePercentChange(currentCount, previousCount),
      costPerOrder: calculatePercentChange(currentCostPerOrder, previousCostPerOrder),
    },
  }
}

// Billing Category Breakdown (pie chart data)
// Categories: Shipping, Warehousing, Extra Picks, MultiHub IQ, B2B, VAS/Kitting, Receiving, Duty/Tax, Credit
export function calculateBillingCategoryBreakdown(
  shipments: ShipmentData[],
  dateRange: DateRange
): BillingCategoryBreakdown[] {
  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))

  // Accumulate totals for each category
  let shippingTotal = 0
  let warehousingTotal = 0
  let extraPicksTotal = 0
  let multiHubIQTotal = 0
  let b2bTotal = 0
  let vasKittingTotal = 0
  let receivingTotal = 0
  let dutyTaxTotal = 0

  // Track orders with each fee type
  let ordersWithExtraPicks = 0
  let ordersWithMultiHubIQ = 0
  let ordersWithB2B = 0
  let ordersWithVas = 0
  let ordersWithDutyTax = 0

  filtered.forEach(s => {
    const billing = calculateShipmentBilling(s)
    shippingTotal += billing.shipping
    warehousingTotal += billing.warehousing
    extraPicksTotal += billing.extraPicks
    multiHubIQTotal += billing.multiHubIQ
    b2bTotal += billing.b2b
    vasKittingTotal += billing.vasKitting
    receivingTotal += billing.receiving
    dutyTaxTotal += billing.dutyTax

    if (billing.extraPicks > 0) ordersWithExtraPicks++
    if (billing.multiHubIQ > 0) ordersWithMultiHubIQ++
    if (billing.b2b > 0) ordersWithB2B++
    if (billing.vasKitting > 0) ordersWithVas++
    if (billing.dutyTax > 0) ordersWithDutyTax++
  })

  // Credits: ~2% of total billed back
  const subtotal = shippingTotal + warehousingTotal + extraPicksTotal + multiHubIQTotal +
                   b2bTotal + vasKittingTotal + receivingTotal + dutyTaxTotal
  const creditTotal = -(subtotal * 0.02)

  const grandTotal = subtotal + creditTotal
  const orderCount = filtered.length

  const categories: BillingCategoryBreakdown[] = [
    {
      category: 'Shipping',
      amount: shippingTotal,
      percent: grandTotal > 0 ? (shippingTotal / grandTotal) * 100 : 0,
      quantity: orderCount,
      unitPrice: orderCount > 0 ? shippingTotal / orderCount : 0,
    },
    {
      category: 'Warehousing',
      amount: warehousingTotal,
      percent: grandTotal > 0 ? (warehousingTotal / grandTotal) * 100 : 0,
      quantity: orderCount,
      unitPrice: orderCount > 0 ? warehousingTotal / orderCount : 0,
    },
    {
      category: 'Extra Picks',
      amount: extraPicksTotal,
      percent: grandTotal > 0 ? (extraPicksTotal / grandTotal) * 100 : 0,
      quantity: ordersWithExtraPicks,
      unitPrice: 0.35, // Per pick rate
    },
    {
      category: 'MultiHub IQ',
      amount: multiHubIQTotal,
      percent: grandTotal > 0 ? (multiHubIQTotal / grandTotal) * 100 : 0,
      quantity: ordersWithMultiHubIQ,
      unitPrice: ordersWithMultiHubIQ > 0 ? multiHubIQTotal / ordersWithMultiHubIQ : 0,
    },
    {
      category: 'B2B',
      amount: b2bTotal,
      percent: grandTotal > 0 ? (b2bTotal / grandTotal) * 100 : 0,
      quantity: ordersWithB2B,
      unitPrice: ordersWithB2B > 0 ? b2bTotal / ordersWithB2B : 0,
    },
    {
      category: 'VAS/Kitting',
      amount: vasKittingTotal,
      percent: grandTotal > 0 ? (vasKittingTotal / grandTotal) * 100 : 0,
      quantity: ordersWithVas,
      unitPrice: ordersWithVas > 0 ? vasKittingTotal / ordersWithVas : 0,
    },
    {
      category: 'Receiving',
      amount: receivingTotal,
      percent: grandTotal > 0 ? (receivingTotal / grandTotal) * 100 : 0,
      quantity: orderCount,
      unitPrice: orderCount > 0 ? receivingTotal / orderCount : 0,
    },
    {
      category: 'Duty/Tax',
      amount: dutyTaxTotal,
      percent: grandTotal > 0 ? (dutyTaxTotal / grandTotal) * 100 : 0,
      quantity: ordersWithDutyTax,
      unitPrice: ordersWithDutyTax > 0 ? dutyTaxTotal / ordersWithDutyTax : 0,
    },
    {
      category: 'Credit',
      amount: creditTotal,
      percent: grandTotal > 0 ? (creditTotal / grandTotal) * 100 : 0,
      quantity: Math.floor(orderCount * 0.05), // ~5% of orders get credits
      unitPrice: creditTotal / Math.max(Math.floor(orderCount * 0.05), 1),
    },
  ]

  // Sort by absolute amount descending (credits are negative but should appear by magnitude)
  return categories
    .filter(c => Math.abs(c.amount) > 0.01) // Remove zero categories
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
}

// Monthly Billing Trend (stacked area chart)
// Categories: Shipping, Warehousing, Extra Picks, MultiHub IQ, B2B, VAS/Kitting, Receiving, Duty/Tax, Credit
export function calculateMonthlyBillingTrend(
  shipments: ShipmentData[],
  dateRange: DateRange
): MonthlyBillingTrend[] {
  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))

  const monthMap = new Map<string, {
    shipping: number
    warehousing: number
    extraPicks: number
    multiHubIQ: number
    b2b: number
    vasKitting: number
    receiving: number
    dutyTax: number
    credit: number
    total: number
    orderCount: number
  }>()

  filtered.forEach(s => {
    const month = getMonthKey(s.transactionDate)
    if (!monthMap.has(month)) {
      monthMap.set(month, {
        shipping: 0,
        warehousing: 0,
        extraPicks: 0,
        multiHubIQ: 0,
        b2b: 0,
        vasKitting: 0,
        receiving: 0,
        dutyTax: 0,
        credit: 0,
        total: 0,
        orderCount: 0,
      })
    }

    const data = monthMap.get(month)!
    const billing = calculateShipmentBilling(s)

    data.shipping += billing.shipping
    data.warehousing += billing.warehousing
    data.extraPicks += billing.extraPicks
    data.multiHubIQ += billing.multiHubIQ
    data.b2b += billing.b2b
    data.vasKitting += billing.vasKitting
    data.receiving += billing.receiving
    data.dutyTax += billing.dutyTax
    data.total += billing.total
    data.orderCount++
  })

  // Add credits per month (~2% of total billed back)
  monthMap.forEach((data) => {
    data.credit = -(data.total * 0.02) // Negative value for credits
    data.total += data.credit // Adjust total to reflect credits
  })

  return Array.from(monthMap.entries())
    .map(([month, data]) => ({
      month,
      monthLabel: getMonthLabel(month),
      shipping: data.shipping,
      warehousing: data.warehousing,
      extraPicks: data.extraPicks,
      multiHubIQ: data.multiHubIQ,
      b2b: data.b2b,
      vasKitting: data.vasKitting,
      receiving: data.receiving,
      dutyTax: data.dutyTax,
      credit: data.credit,
      total: data.total,
      orderCount: data.orderCount,
      costPerOrder: data.orderCount > 0 ? data.total / data.orderCount : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

// Flexible Billing Trend (supports daily, weekly, monthly granularity)
// Categories: Shipping, Warehousing, Extra Picks, MultiHub IQ, B2B, VAS/Kitting, Receiving, Duty/Tax, Credit
export function calculateBillingTrend(
  shipments: ShipmentData[],
  dateRange: DateRange,
  granularity: 'daily' | 'weekly' | 'monthly' = 'monthly'
): MonthlyBillingTrend[] {
  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))

  const dataMap = new Map<string, {
    shipping: number
    warehousing: number
    extraPicks: number
    multiHubIQ: number
    b2b: number
    vasKitting: number
    receiving: number
    dutyTax: number
    credit: number
    total: number
    orderCount: number
  }>()

  filtered.forEach(s => {
    const key = getTimeKey(s.transactionDate, granularity)
    if (!dataMap.has(key)) {
      dataMap.set(key, {
        shipping: 0,
        warehousing: 0,
        extraPicks: 0,
        multiHubIQ: 0,
        b2b: 0,
        vasKitting: 0,
        receiving: 0,
        dutyTax: 0,
        credit: 0,
        total: 0,
        orderCount: 0,
      })
    }

    const data = dataMap.get(key)!
    const billing = calculateShipmentBilling(s)

    data.shipping += billing.shipping
    data.warehousing += billing.warehousing
    data.extraPicks += billing.extraPicks
    data.multiHubIQ += billing.multiHubIQ
    data.b2b += billing.b2b
    data.vasKitting += billing.vasKitting
    data.receiving += billing.receiving
    data.dutyTax += billing.dutyTax
    data.total += billing.total
    data.orderCount++
  })

  // Add credits per period (~2% of total billed back)
  dataMap.forEach((data) => {
    data.credit = -(data.total * 0.02) // Negative value for credits
    data.total += data.credit // Adjust total to reflect credits
  })

  return Array.from(dataMap.entries())
    .map(([key, data]) => ({
      month: key,
      monthLabel: getTimeLabel(key, granularity),
      shipping: data.shipping,
      warehousing: data.warehousing,
      extraPicks: data.extraPicks,
      multiHubIQ: data.multiHubIQ,
      b2b: data.b2b,
      vasKitting: data.vasKitting,
      receiving: data.receiving,
      dutyTax: data.dutyTax,
      credit: data.credit,
      total: data.total,
      orderCount: data.orderCount,
      costPerOrder: data.orderCount > 0 ? data.total / data.orderCount : 0,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

// Pick/Pack Distribution (using per-pick rate)
export function calculatePickPackDistribution(
  shipments: ShipmentData[],
  dateRange: DateRange
): PickPackDistribution[] {
  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))

  // Per-pick rate is $0.35 per item
  const PER_PICK_RATE = 0.35

  const distribution = {
    '1 item': { count: 0, cost: 0 },
    '2 items': { count: 0, cost: 0 },
    '3+ items': { count: 0, cost: 0, totalItems: 0 },
  }

  filtered.forEach(s => {
    const pickCost = s.totalQuantity * PER_PICK_RATE
    if (s.totalQuantity <= 1) {
      distribution['1 item'].count++
      distribution['1 item'].cost += pickCost
    } else if (s.totalQuantity === 2) {
      distribution['2 items'].count++
      distribution['2 items'].cost += pickCost
    } else {
      distribution['3+ items'].count++
      distribution['3+ items'].cost += pickCost
      distribution['3+ items'].totalItems += s.totalQuantity
    }
  })

  const totalOrders = filtered.length

  return [
    {
      itemCount: '1 item',
      orderCount: distribution['1 item'].count,
      percent: totalOrders > 0 ? (distribution['1 item'].count / totalOrders) * 100 : 0,
      totalCost: distribution['1 item'].cost,
      unitPrice: PER_PICK_RATE,
    },
    {
      itemCount: '2 items',
      orderCount: distribution['2 items'].count,
      percent: totalOrders > 0 ? (distribution['2 items'].count / totalOrders) * 100 : 0,
      totalCost: distribution['2 items'].cost,
      unitPrice: PER_PICK_RATE * 2,
    },
    {
      itemCount: '3+ items',
      orderCount: distribution['3+ items'].count,
      percent: totalOrders > 0 ? (distribution['3+ items'].count / totalOrders) * 100 : 0,
      totalCost: distribution['3+ items'].cost,
      unitPrice: distribution['3+ items'].count > 0
        ? distribution['3+ items'].cost / distribution['3+ items'].count
        : PER_PICK_RATE * 3,
    },
  ]
}

// Cost Per Order Trend
export function calculateCostPerOrderTrend(
  shipments: ShipmentData[],
  dateRange: DateRange
): CostPerOrderTrend[] {
  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))

  const monthMap = new Map<string, { total: number; count: number }>()

  filtered.forEach(s => {
    const month = getMonthKey(s.transactionDate)
    if (!monthMap.has(month)) {
      monthMap.set(month, { total: 0, count: 0 })
    }
    const data = monthMap.get(month)!
    const billing = calculateShipmentBilling(s)
    data.total += billing.total
    data.count++
  })

  return Array.from(monthMap.entries())
    .map(([month, data]) => ({
      month,
      monthLabel: getMonthLabel(month),
      costPerOrder: data.count > 0 ? data.total / data.count : 0,
      orderCount: data.count,
    }))
    .sort((a, b) => a.month.localeCompare(b.month))
}

// Shipping Cost By Zone
export function calculateShippingCostByZone(
  shipments: ShipmentData[],
  dateRange: DateRange
): ShippingCostByZone[] {
  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))

  const zoneLabels: Record<string, string> = {
    '1': 'Local',
    '2': 'Very Close',
    '3': 'Regional',
    '4': 'Medium',
    '5': 'Farther',
    '6': 'Far',
    '7': 'Very Far',
    '8': 'Coast to Coast',
  }

  const zoneMap = new Map<string, { count: number; totalShipping: number }>()

  filtered.forEach(s => {
    const zone = s.zoneUsed || 'Unknown'
    if (!zoneMap.has(zone)) {
      zoneMap.set(zone, { count: 0, totalShipping: 0 })
    }
    const data = zoneMap.get(zone)!
    data.count++
    data.totalShipping += s.fulfillmentWithoutSurcharge
  })

  const totalOrders = filtered.length

  return Array.from(zoneMap.entries())
    .map(([zone, data]) => ({
      zone,
      zoneLabel: zoneLabels[zone] || zone,
      orderCount: data.count,
      totalShipping: data.totalShipping,
      avgShipping: data.count > 0 ? data.totalShipping / data.count : 0,
      percent: totalOrders > 0 ? (data.count / totalOrders) * 100 : 0,
    }))
    .sort((a, b) => {
      const aNum = parseInt(a.zone) || 999
      const bNum = parseInt(b.zone) || 999
      return aNum - bNum
    })
}

// Surcharge Breakdown
export function calculateSurchargeBreakdown(
  shipments: ShipmentData[],
  dateRange: DateRange
): SurchargeBreakdown[] {
  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))

  // Simulate different surcharge types based on the surcharge amount
  // In production, this would come from actual surcharge type data
  const surchargeTypes = {
    'Fuel Surcharge': { amount: 0, count: 0 },
    'Residential Delivery': { amount: 0, count: 0 },
    'Dimensional Weight': { amount: 0, count: 0 },
    'Remote Area': { amount: 0, count: 0 },
    'Peak Season': { amount: 0, count: 0 },
  }

  const ordersWithSurcharge = filtered.filter(s => s.surchargeApplied > 0)

  ordersWithSurcharge.forEach((s, idx) => {
    // Distribute surcharges across types realistically
    const surchargeAmount = s.surchargeApplied

    // 40% are fuel surcharges
    if (idx % 10 < 4) {
      surchargeTypes['Fuel Surcharge'].amount += surchargeAmount
      surchargeTypes['Fuel Surcharge'].count++
    }
    // 30% are residential
    else if (idx % 10 < 7) {
      surchargeTypes['Residential Delivery'].amount += surchargeAmount
      surchargeTypes['Residential Delivery'].count++
    }
    // 15% are dim weight
    else if (idx % 10 < 8.5) {
      surchargeTypes['Dimensional Weight'].amount += surchargeAmount
      surchargeTypes['Dimensional Weight'].count++
    }
    // 10% are remote
    else if (idx % 10 < 9.5) {
      surchargeTypes['Remote Area'].amount += surchargeAmount
      surchargeTypes['Remote Area'].count++
    }
    // 5% are peak season
    else {
      surchargeTypes['Peak Season'].amount += surchargeAmount
      surchargeTypes['Peak Season'].count++
    }
  })

  const totalSurcharges = Object.values(surchargeTypes).reduce((sum, t) => sum + t.amount, 0)

  return Object.entries(surchargeTypes)
    .map(([type, data]) => ({
      type,
      amount: data.amount,
      orderCount: data.count,
      percent: totalSurcharges > 0 ? (data.amount / totalSurcharges) * 100 : 0,
    }))
    .filter(s => s.amount > 0)
    .sort((a, b) => b.amount - a.amount)
}

// Fee type to display category mapping
// Maps raw fee types to user-friendly category names
function mapFeeTypeToCategory(feeType: string): string {
  // Check for B2B fees (any fee containing "B2B")
  if (feeType.toUpperCase().includes('B2B')) {
    return 'B2B Fees'
  }

  // Specific mappings
  switch (feeType) {
    case 'Per Pick Fee':
      return 'D2C Extra Picks'
    case 'Inventory Placement Program Fee':
      return 'MultiHub IQ'
    case 'URO Storage Fee':
      return 'URO Fees'
    case 'VAS - Paid Requests':
    case 'Kitting Fee':
      return 'VAS/Kitting'
    case 'Address Correction':
      return 'Address Correction'
    default:
      // Return original if no mapping found
      return feeType
  }
}

// Additional Services Breakdown
export function calculateAdditionalServicesBreakdown(
  additionalServices: AdditionalServiceData[],
  dateRange: DateRange
): AdditionalServicesBreakdown[] {
  const filtered = additionalServices.filter(s => isWithinDateRange(s.transactionDate, dateRange))

  // Aggregate by mapped category
  const categoryTotals: Record<string, { amount: number; count: number }> = {}

  filtered.forEach(service => {
    const category = mapFeeTypeToCategory(service.feeType)

    if (!categoryTotals[category]) {
      categoryTotals[category] = { amount: 0, count: 0 }
    }

    categoryTotals[category].amount += service.invoiceAmount
    categoryTotals[category].count++
  })

  const totalAmount = Object.values(categoryTotals).reduce((sum, t) => sum + t.amount, 0)

  return Object.entries(categoryTotals)
    .map(([category, data]) => ({
      category,
      amount: data.amount,
      transactionCount: data.count,
      percent: totalAmount > 0 ? (data.amount / totalAmount) * 100 : 0,
    }))
    .filter(s => s.amount > 0)
    .sort((a, b) => b.amount - a.amount)
}

// Billing Efficiency Metrics
export function calculateBillingEfficiencyMetrics(
  shipments: ShipmentData[],
  dateRange: DateRange
): BillingEfficiencyMetrics {
  const filtered = shipments.filter(s => isWithinDateRange(s.transactionDate, dateRange))

  if (filtered.length === 0) {
    return {
      costPerItem: 0,
      avgItemsPerOrder: 0,
      shippingAsPercentOfTotal: 0,
      surchargeRate: 0,
      insuranceRate: 0,
    }
  }

  let totalCost = 0
  let totalShipping = 0
  let totalItems = 0
  let ordersWithSurcharge = 0
  let ordersWithInsurance = 0

  filtered.forEach(s => {
    const billing = calculateShipmentBilling(s)
    totalCost += billing.total
    totalShipping += billing.shipping
    totalItems += s.totalQuantity
    if (s.surchargeApplied > 0) ordersWithSurcharge++
    if (s.insuranceAmount > 0) ordersWithInsurance++
  })

  return {
    costPerItem: totalItems > 0 ? totalCost / totalItems : 0,
    avgItemsPerOrder: filtered.length > 0 ? totalItems / filtered.length : 0,
    shippingAsPercentOfTotal: totalCost > 0 ? (totalShipping / totalCost) * 100 : 0,
    surchargeRate: filtered.length > 0 ? (ordersWithSurcharge / filtered.length) * 100 : 0,
    insuranceRate: filtered.length > 0 ? (ordersWithInsurance / filtered.length) * 100 : 0,
  }
}

// =====================================
// Undelivered Shipments Analytics
// =====================================

// Get days in transit for a shipment
function getDaysInTransit(labelGenerationTimestamp: string): number {
  const now = new Date()
  const labelGen = new Date(labelGenerationTimestamp)
  return Math.floor((now.getTime() - labelGen.getTime()) / (1000 * 60 * 60 * 24))
}

// Undelivered Summary KPIs
export function getUndeliveredSummary(shipments: ShipmentData[]): UndeliveredSummary {
  const undelivered = shipments.filter(s => !s.deliveredDate)

  if (undelivered.length === 0) {
    return {
      totalUndelivered: 0,
      avgDaysInTransit: 0,
      criticalCount: 0,
      warningCount: 0,
      onTrackCount: 0,
      oldestDays: 0,
    }
  }

  const daysArray = undelivered.map(s => getDaysInTransit(s.labelGenerationTimestamp))
  const totalDays = daysArray.reduce((sum, d) => sum + d, 0)
  const maxDays = Math.max(...daysArray)

  return {
    totalUndelivered: undelivered.length,
    avgDaysInTransit: totalDays / undelivered.length,
    criticalCount: daysArray.filter(d => d >= 7).length,
    warningCount: daysArray.filter(d => d >= 5 && d < 7).length,
    onTrackCount: daysArray.filter(d => d < 5).length,
    oldestDays: maxDays,
  }
}

// Undelivered by Carrier
export function getUndeliveredByCarrier(shipments: ShipmentData[]): UndeliveredByCarrier[] {
  const undelivered = shipments.filter(s => !s.deliveredDate)
  const total = undelivered.length

  if (total === 0) return []

  const carrierMap = new Map<string, { count: number; totalDays: number; criticalCount: number }>()

  undelivered.forEach(s => {
    const days = getDaysInTransit(s.labelGenerationTimestamp)
    const existing = carrierMap.get(s.carrier) || { count: 0, totalDays: 0, criticalCount: 0 }
    carrierMap.set(s.carrier, {
      count: existing.count + 1,
      totalDays: existing.totalDays + days,
      criticalCount: existing.criticalCount + (days >= 7 ? 1 : 0),
    })
  })

  return Array.from(carrierMap.entries())
    .map(([carrier, data]) => ({
      carrier,
      count: data.count,
      avgDaysInTransit: data.totalDays / data.count,
      criticalCount: data.criticalCount,
      percent: (data.count / total) * 100,
    }))
    .sort((a, b) => b.count - a.count)
}

// Undelivered by Status
export function getUndeliveredByStatus(shipments: ShipmentData[]): UndeliveredByStatus[] {
  const undelivered = shipments.filter(s => !s.deliveredDate)
  const total = undelivered.length

  if (total === 0) return []

  const statusMap = new Map<string, number>()

  undelivered.forEach(s => {
    const days = getDaysInTransit(s.labelGenerationTimestamp)
    // Determine status based on days in transit
    let status: string
    if (days >= 14) {
      status = 'Exception'
    } else if (days >= 7) {
      status = 'Delayed'
    } else if (days <= 1) {
      status = 'Just Shipped'
    } else {
      status = 'In Transit'
    }
    statusMap.set(status, (statusMap.get(status) || 0) + 1)
  })

  // Define order for statuses
  const statusOrder = ['Just Shipped', 'In Transit', 'Delayed', 'Exception']

  return statusOrder
    .filter(status => statusMap.has(status))
    .map(status => ({
      status,
      count: statusMap.get(status)!,
      percent: (statusMap.get(status)! / total) * 100,
    }))
}

// Undelivered by Age Bucket
export function getUndeliveredByAge(shipments: ShipmentData[]): UndeliveredByAge[] {
  const undelivered = shipments.filter(s => !s.deliveredDate)
  const total = undelivered.length

  if (total === 0) return []

  // Define age buckets
  const buckets = [
    { bucket: '0-2 days', minDays: 0, maxDays: 2 },
    { bucket: '3-4 days', minDays: 3, maxDays: 4 },
    { bucket: '5-6 days', minDays: 5, maxDays: 6 },
    { bucket: '7-10 days', minDays: 7, maxDays: 10 },
    { bucket: '11-14 days', minDays: 11, maxDays: 14 },
    { bucket: '15+ days', minDays: 15, maxDays: 999 },
  ]

  const counts = new Map<string, number>()
  buckets.forEach(b => counts.set(b.bucket, 0))

  undelivered.forEach(s => {
    const days = getDaysInTransit(s.labelGenerationTimestamp)
    for (const b of buckets) {
      if (days >= b.minDays && days <= b.maxDays) {
        counts.set(b.bucket, counts.get(b.bucket)! + 1)
        break
      }
    }
  })

  return buckets.map(b => ({
    bucket: b.bucket,
    minDays: b.minDays,
    maxDays: b.maxDays,
    count: counts.get(b.bucket)!,
    percent: (counts.get(b.bucket)! / total) * 100,
  }))
}

// Undelivered by State
export function getUndeliveredByState(shipments: ShipmentData[]): UndeliveredByState[] {
  const undelivered = shipments.filter(s => !s.deliveredDate)
  const total = undelivered.length

  if (total === 0) return []

  const stateMap = new Map<string, { count: number; totalDays: number }>()

  undelivered.forEach(s => {
    const days = getDaysInTransit(s.labelGenerationTimestamp)
    const existing = stateMap.get(s.state) || { count: 0, totalDays: 0 }
    stateMap.set(s.state, {
      count: existing.count + 1,
      totalDays: existing.totalDays + days,
    })
  })

  return Array.from(stateMap.entries())
    .map(([state, data]) => ({
      state,
      stateName: STATE_NAMES[state] || state,
      count: data.count,
      avgDaysInTransit: data.totalDays / data.count,
      percent: (data.count / total) * 100,
    }))
    .sort((a, b) => b.count - a.count)
}
