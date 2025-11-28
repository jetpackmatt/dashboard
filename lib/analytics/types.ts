// Analytics Data Types

export interface ShipmentData {
  userId: string
  merchantName: string
  customerName: string
  storeIntegrationName: string
  orderId: string
  transactionType: string
  transactionDate: string
  storeOrderId: string
  trackingId: string
  fulfillmentWithoutSurcharge: number
  surchargeApplied: number
  originalInvoice: number
  insuranceAmount: number
  productsSold: string
  totalQuantity: number
  shipOptionId: string
  carrier: string
  carrierService: string
  zoneUsed: string
  actualWeightOz: number
  dimWeightOz: number
  billableWeightOz: number
  length: number
  width: number
  height: number
  zipCode: string
  city: string
  state: string
  destinationCountry: string
  orderInsertTimestamp: string
  labelGenerationTimestamp: string
  deliveredDate: string | null
  transitTimeDays: number | null
  fcName: string
  orderCategory: string
}

export interface AdditionalServiceData {
  userId: string
  merchantName: string
  referenceId: string
  feeType: string
  invoiceAmount: number
  transactionDate: string
}

export interface ReturnData {
  userId: string
  merchantName: string
  returnId: string
  originalOrderId: string
  trackingId: string
  invoice: number
  transactionType: string
  returnStatus: string
  returnType: string
  returnCreationDate: string
  fcName: string
}

export interface ReceivingData {
  userId: string
  merchantName: string
  referenceId: string
  feeType: string
  invoiceAmount: number
  transactionType: string
  transactionDate: string
}

export interface StorageData {
  merchantName: string
  chargeStartDate: string
  fcName: string
  inventoryId: string
  locationType: string
  comment: string
  invoice: number
}

export interface CreditData {
  userId: string
  merchantName: string
  referenceId: string
  transactionDate: string
  creditReason: string
  creditAmount: number
}

// Aggregated Metrics

export interface KPIMetrics {
  totalCost: number
  orderCount: number
  avgTransitTime: number
  slaPercent: number
  lateOrders: number
  undelivered: number
  periodChange: {
    totalCost: number // percentage
    orderCount: number // percentage
    avgTransitTime: number // percentage
    slaPercent: number // percentage points
    lateOrders: number // percentage
    undelivered: number // percentage
  }
}

export interface MonthlyInvoiceData {
  month: string
  fulfillmentBase: number
  surcharges: number
  additionalServices: number
  storage: number
  returns: number
  receiving: number
  total: number
}

export interface CarrierPerformance {
  carrier: string
  orderCount: number
  avgCost: number
  totalCost: number
  avgTransitTime: number
  onTimePercent: number
  breachedOrders: number
}

export interface ShipOptionMetrics {
  shipOptionId: string
  carrierService: string
  orderCount: number
  avgCost: number
  avgCostWithSurcharge: number
  avgTransitTime: number
}

export interface ZoneMetrics {
  zone: string
  orderCount: number
  avgCost: number
  avgTransitTime: number
}

export interface SLAMetrics {
  orderId: string
  trackingId: string
  customerName: string
  orderInsertTimestamp: string
  labelGenerationTimestamp: string
  deliveredDate: string | null
  timeToShipHours: number
  transitTimeDays: number | null
  carrier: string
  isOnTime: boolean
  isBreach: boolean
}

export interface UndeliveredShipment {
  trackingId: string
  orderId: string
  customerName: string
  labelGenerationTimestamp: string
  daysInTransit: number
  status: string
  carrier: string
  destination: string
  lastUpdate: string
}

export interface FulfillmentTrendData {
  date: string
  avgFulfillmentHours: number
  medianFulfillmentHours: number
  p90FulfillmentHours: number
  orderCount: number
}

export interface FCFulfillmentMetrics {
  fcName: string
  avgFulfillmentHours: number
  breachRate: number
  orderCount: number
  breachedCount: number
}

export interface ChartDataPoint {
  [key: string]: string | number | null
}

// Date Range Types

export type DateRangePreset = '7d' | '30d' | '60d' | '90d' | '6mo' | '1yr' | 'custom'

// Granularity for time-series charts based on date range
export type ChartGranularity = 'daily' | 'weekly' | 'monthly'

// Helper to determine appropriate granularity based on date range
export function getGranularityForRange(preset: DateRangePreset): ChartGranularity {
  switch (preset) {
    case '7d':
    case '30d':
      return 'daily'
    case '60d':
    case '90d':
      return 'weekly'
    case '6mo':
    case '1yr':
    case 'custom':
    default:
      return 'monthly'
  }
}

// Get label for granularity
export function getGranularityLabel(granularity: ChartGranularity): string {
  switch (granularity) {
    case 'daily':
      return 'Daily'
    case 'weekly':
      return 'Weekly'
    case 'monthly':
      return 'Monthly'
  }
}

export interface DateRange {
  from: Date
  to: Date
  preset: DateRangePreset
}

// Filter Types

export interface AnalyticsFilters {
  dateRange: DateRange
  carriers?: string[]
  zones?: string[]
  shipOptions?: string[]
  feeTypes?: string[]
  status?: string[]
}

// Export Types

export interface ExportConfig {
  format: 'csv' | 'excel' | 'pdf'
  filename: string
  data: any[]
  columns: string[]
  title?: string
}

// State Performance Types

export interface StatePerformance {
  state: string
  stateName: string
  orderCount: number
  shippedCount: number
  deliveredCount: number
  avgDeliveryTimeDays: number
  shippedPercent: number
  deliveredPercent: number
}

// Cost + Speed Analysis Types

export interface CostTrendData {
  month: string
  avgCostBase: number
  avgCostWithSurcharge: number
  surchargeOnly: number
  orderCount: number
}

export interface OrderVolumeTrendData {
  month: string
  orderCount: number
  growthPercent: number | null
}

export interface ShipOptionPerformanceData {
  shipOptionId: string
  carrierService: string
  avgCost: number
  avgTransitTime: number
  orderCount: number
}

export interface CostVsTransitData {
  carrier: string
  carrierService: string
  avgCost: number
  avgTransitTime: number
  orderCount: number
}

export interface TransitTimeDistributionData {
  carrier: string
  min: number
  q1: number
  median: number
  q3: number
  max: number
  orderCount: number
}

export interface CostSpeedTrendData {
  month: string
  avgCost: number
  avgTransitTime: number
  orderCount: number
}

// Order Volume Analysis Types

export interface OrderVolumeByHour {
  hour: number
  orderCount: number
  percent: number
}

export interface OrderVolumeByDayOfWeek {
  dayOfWeek: number
  dayName: string
  orderCount: number
  percent: number
}

export interface OrderVolumeByFC {
  fcName: string
  orderCount: number
  percent: number
}

export interface OrderVolumeByStore {
  storeIntegrationName: string
  orderCount: number
  percent: number
}

export interface DailyOrderVolume {
  date: string
  orderCount: number
  growthPercent: number | null
}

export interface StateVolumeData {
  state: string
  stateName: string
  orderCount: number
  percent: number
  avgOrdersPerDay: number
}

export interface CityVolumeData {
  city: string
  state: string
  zipCode: string
  orderCount: number
  percent: number
}

export interface ZipCodeVolumeData {
  zipCode: string
  city: string
  state: string
  orderCount: number
  percent: number
  coordinates?: [number, number] // [longitude, latitude] - legacy format
  lon?: number // longitude - new format
  lat?: number // latitude - new format
}

// Geography Cost + Speed Types

export interface StateCostSpeedData {
  state: string
  stateName: string
  avgCost: number
  avgTransitTime: number
  orderCount: number
}

export interface ZoneCostData {
  zone: string
  avgCost: number
  avgTransitTime: number
  orderCount: number
}

// Billing Analytics Types

export interface BillingSummary {
  totalCost: number
  orderCount: number
  costPerOrder: number
  periodChange: {
    totalCost: number
    orderCount: number
    costPerOrder: number
  }
}

export interface BillingCategoryBreakdown {
  category: string
  amount: number
  percent: number
  quantity: number
  unitPrice: number
}

export interface MonthlyBillingTrend {
  month: string
  monthLabel: string
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
  costPerOrder: number
}

export interface PickPackDistribution {
  itemCount: string
  orderCount: number
  percent: number
  totalCost: number
  unitPrice: number
}

export interface CostPerOrderTrend {
  month: string
  monthLabel: string
  costPerOrder: number
  orderCount: number
}

export interface ShippingCostByZone {
  zone: string
  zoneLabel: string
  orderCount: number
  totalShipping: number
  avgShipping: number
  percent: number
}

export interface SurchargeBreakdown {
  type: string
  amount: number
  orderCount: number
  percent: number
}

export interface AdditionalServicesBreakdown {
  category: string
  amount: number
  transactionCount: number
  percent: number
}

export interface BillingEfficiencyMetrics {
  costPerItem: number
  avgItemsPerOrder: number
  shippingAsPercentOfTotal: number
  surchargeRate: number
  insuranceRate: number
}

// Undelivered Analytics Types

export interface UndeliveredSummary {
  totalUndelivered: number
  avgDaysInTransit: number
  criticalCount: number // 7+ days
  warningCount: number // 5-6 days
  onTrackCount: number // 0-4 days
  oldestDays: number
}

export interface UndeliveredByCarrier {
  carrier: string
  count: number
  avgDaysInTransit: number
  criticalCount: number
  percent: number
}

export interface UndeliveredByStatus {
  status: string
  count: number
  percent: number
}

export interface UndeliveredByAge {
  bucket: string
  minDays: number
  maxDays: number
  count: number
  percent: number
}

export interface UndeliveredByState {
  state: string
  stateName: string
  count: number
  avgDaysInTransit: number
  percent: number
}
