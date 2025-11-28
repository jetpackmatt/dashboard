// Sample Analytics Data for Development

import type { ShipmentData, AdditionalServiceData } from './types'
import usCitiesData from './us-cities-coords.json'

// Build city lookup by state and population tier for realistic mock data
const citiesByState = new Map<string, Array<{ name: string; lon: number; lat: number; population: number }>>()
const majorCitiesByState = new Map<string, Array<{ name: string; lon: number; lat: number; population: number }>>()
const mediumCitiesByState = new Map<string, Array<{ name: string; lon: number; lat: number; population: number }>>()
const smallCitiesByState = new Map<string, Array<{ name: string; lon: number; lat: number; population: number }>>()

usCitiesData.forEach(city => {
  const [cityName, state] = city.key.split('|')
  const cityData = { name: cityName, lon: city.lon, lat: city.lat, population: city.population }

  // Add to all cities
  if (!citiesByState.has(state)) {
    citiesByState.set(state, [])
  }
  citiesByState.get(state)!.push(cityData)

  // Categorize by population
  if (city.population >= 100000) {
    // Major cities (100K+)
    if (!majorCitiesByState.has(state)) {
      majorCitiesByState.set(state, [])
    }
    majorCitiesByState.get(state)!.push(cityData)
  } else if (city.population >= 10000) {
    // Medium cities (10K-100K)
    if (!mediumCitiesByState.has(state)) {
      mediumCitiesByState.set(state, [])
    }
    mediumCitiesByState.get(state)!.push(cityData)
  } else {
    // Small towns (<10K)
    if (!smallCitiesByState.has(state)) {
      smallCitiesByState.set(state, [])
    }
    smallCitiesByState.get(state)!.push(cityData)
  }
})

console.log(`Loaded cities: ${majorCitiesByState.size} states with major cities, ${mediumCitiesByState.size} with medium, ${smallCitiesByState.size} with small`)

// USPS Zone mapping from origin ZIP 60007 (Elk Grove Village, IL - near Chicago)
// Zones based on distance from origin
const stateToZone: Record<string, string> = {
  // Zone 1-2 (local/very close)
  'IL': '1',
  'IN': '2',
  'WI': '2',
  // Zone 3 (regional)
  'IA': '3',
  'MI': '3',
  'MO': '3',
  // Zone 4 (medium distance)
  'KY': '4',
  'OH': '4',
  'MN': '4',
  'NE': '4',
  // Zone 5 (farther)
  'KS': '5',
  'TN': '5',
  'WV': '5',
  'PA': '5',
  'NY': '5',
  'SD': '5',
  'ND': '5',
  'AR': '5',
  'OK': '5',
  'MS': '5',
  'VA': '5',
  'MD': '5',
  'DE': '5',
  'NJ': '5',
  'CO': '5',
  // Zone 6 (far)
  'LA': '6',
  'AL': '6',
  'GA': '6',
  'SC': '6',
  'NC': '6',
  'CT': '6',
  'RI': '6',
  'MA': '6',
  'MT': '6',
  'WY': '6',
  'TX': '6',
  'NM': '6',
  'VT': '6',
  'NH': '6',
  'UT': '6',
  // Zone 7 (very far)
  'FL': '7',
  'ME': '7',
  'AZ': '7',
  'ID': '7',
  'NV': '7',
  // Zone 8 (coast to coast)
  'CA': '8',
  'OR': '8',
  'WA': '8',
  'AK': '8',
  'HI': '8',
}

// Zone-based costs: $6.11 (zone 1) to $13.42 (zone 8)
// Linear interpolation between zones
const zoneCosts: Record<string, number> = {
  '1': 6.11,
  '2': 7.15,
  '3': 8.19,
  '4': 9.23,
  '5': 10.27,
  '6': 11.31,
  '7': 12.35,
  '8': 13.42,
}

// Zone-based transit times (business days)
const zoneTransitTimes: Record<string, { min: number; max: number }> = {
  '1': { min: 1.0, max: 2.0 },
  '2': { min: 1.5, max: 2.5 },
  '3': { min: 2.0, max: 3.0 },
  '4': { min: 2.5, max: 3.5 },
  '5': { min: 3.0, max: 4.5 },
  '6': { min: 3.5, max: 5.0 },
  '7': { min: 4.0, max: 5.5 },
  '8': { min: 5.0, max: 7.0 },
}

// Generate realistic sample shipment data
// 40K shipments across a year for realistic presentation
export const sampleShipments: ShipmentData[] = generateSampleShipments(40000)

function generateSampleShipments(count: number): ShipmentData[] {
  // Actual carriers from demo data
  const carriers = ['USPS', 'Amazon Shipping', 'BetterTrucks', 'CirroECommerce', 'DHLExpress', 'OSMWorldwide', 'OnTrac', 'Veho']
  const services: Record<string, string[]> = {
    'USPS': ['Priority Mail', 'First Class', 'Priority Express'],
    'Amazon Shipping': ['Standard', 'Expedited', 'Same Day'],
    'BetterTrucks': ['Ground', 'Express'],
    'CirroECommerce': ['Standard', 'Express'],
    'DHLExpress': ['Domestic', 'Express', 'Express 12:00'],
    'OSMWorldwide': ['Economy', 'Standard', 'Priority'],
    'OnTrac': ['Ground', 'Sunrise', 'Palletized'],
    'Veho': ['Standard', 'Next Day', 'Same Day']
  }

  // All 50 states with transit time ranges based on distance from IL distribution center
  // Grouped by distance with weights for distribution
  const stateTransitTimes: Record<string, { min: number, max: number, weight: number }> = {
    // Very close (1.5-2.5 days) - highest weight
    'IL': { min: 1.5, max: 2.2, weight: 3.5 },
    'IN': { min: 1.5, max: 2.3, weight: 3.5 },
    'WI': { min: 1.6, max: 2.4, weight: 3.0 },
    'IA': { min: 1.7, max: 2.5, weight: 3.0 },
    'MO': { min: 1.7, max: 2.5, weight: 3.0 },
    'KY': { min: 1.8, max: 2.5, weight: 3.0 },
    // Close (2.0-3.0 days)
    'OH': { min: 2.0, max: 2.8, weight: 2.5 },
    'MI': { min: 2.0, max: 2.9, weight: 2.5 },
    'MN': { min: 2.2, max: 3.0, weight: 2.5 },
    'KS': { min: 2.3, max: 3.0, weight: 2.5 },
    'NE': { min: 2.3, max: 3.0, weight: 2.5 },
    'TN': { min: 2.4, max: 3.0, weight: 2.5 },
    'AR': { min: 2.4, max: 3.0, weight: 2.5 },
    'WV': { min: 2.5, max: 3.0, weight: 2.5 },
    // Medium (3.0-5.0 days)
    'PA': { min: 3.0, max: 4.0, weight: 2.0 },
    'NY': { min: 3.2, max: 4.2, weight: 2.0 },
    'VA': { min: 3.0, max: 4.0, weight: 2.0 },
    'NC': { min: 3.2, max: 4.2, weight: 2.0 },
    'SC': { min: 3.3, max: 4.5, weight: 2.0 },
    'GA': { min: 3.3, max: 4.5, weight: 2.0 },
    'AL': { min: 3.3, max: 4.5, weight: 2.0 },
    'MS': { min: 3.2, max: 4.3, weight: 2.0 },
    'LA': { min: 3.3, max: 4.5, weight: 2.0 },
    'OK': { min: 3.0, max: 4.2, weight: 2.0 },
    'SD': { min: 3.0, max: 4.0, weight: 2.0 },
    'ND': { min: 3.2, max: 4.2, weight: 2.0 },
    'MD': { min: 3.2, max: 4.3, weight: 2.0 },
    'DE': { min: 3.3, max: 4.4, weight: 2.0 },
    'NJ': { min: 3.2, max: 4.3, weight: 2.0 },
    // Far (4.0-5.5 days)
    'TX': { min: 4.0, max: 5.2, weight: 1.5 },
    'FL': { min: 4.2, max: 5.5, weight: 1.5 },
    'MT': { min: 4.0, max: 5.2, weight: 1.5 },
    'WY': { min: 4.0, max: 5.0, weight: 1.5 },
    'CO': { min: 3.8, max: 4.8, weight: 1.5 },
    'NM': { min: 4.2, max: 5.3, weight: 1.5 },
    'AZ': { min: 4.5, max: 5.5, weight: 1.5 },
    'UT': { min: 4.0, max: 5.0, weight: 1.5 },
    'ID': { min: 4.2, max: 5.2, weight: 1.5 },
    'NV': { min: 4.5, max: 5.5, weight: 1.5 },
    'CT': { min: 3.5, max: 4.5, weight: 1.8 },
    'RI': { min: 3.6, max: 4.6, weight: 1.8 },
    'MA': { min: 3.6, max: 4.6, weight: 1.8 },
    'VT': { min: 3.7, max: 4.7, weight: 1.8 },
    'NH': { min: 3.7, max: 4.7, weight: 1.8 },
    'ME': { min: 3.8, max: 4.8, weight: 1.8 },
    // Very far (5.0-7.0 days) - lowest weight
    'CA': { min: 5.0, max: 6.5, weight: 1.0 },
    'OR': { min: 5.0, max: 6.5, weight: 1.0 },
    'WA': { min: 5.2, max: 6.5, weight: 1.0 },
    'AK': { min: 6.0, max: 7.0, weight: 0.5 },
    'HI': { min: 6.0, max: 7.0, weight: 0.5 },
  }

  // Create weighted state selection array
  const states = Object.keys(stateTransitTimes)
  const weightedStates: string[] = []
  states.forEach(state => {
    const weight = stateTransitTimes[state].weight
    // Add state multiple times based on weight (weight * 10 for granularity)
    const count = Math.round(weight * 10)
    for (let i = 0; i < count; i++) {
      weightedStates.push(state)
    }
  })

  const shipments: ShipmentData[] = []
  // Generate data for the last 12 months (1 year) from today
  const endDate = new Date()
  const startDate = new Date()
  startDate.setMonth(startDate.getMonth() - 12)

  for (let i = 0; i < count; i++) {
    const carrier = carriers[Math.floor(Math.random() * carriers.length)]
    const carrierService = services[carrier][Math.floor(Math.random() * services[carrier].length)]
    // Use weighted state selection for realistic distribution
    const state = weightedStates[Math.floor(Math.random() * weightedStates.length)]
    // Zone is determined by state (based on USPS zones from origin 60007)
    const zone = stateToZone[state] || '5' // Default to zone 5 if state not mapped

    // Population-weighted city selection: 50% major, 25% medium, 25% small
    const cityRand = Math.random()
    let cityPool: Array<{ name: string; lon: number; lat: number; population: number }> = []

    if (cityRand < 0.5) {
      // 50% chance: Major cities (100K+)
      cityPool = majorCitiesByState.get(state) || []
      if (cityPool.length === 0) {
        // Fallback to medium if no major cities in state
        cityPool = mediumCitiesByState.get(state) || citiesByState.get(state) || []
      }
    } else if (cityRand < 0.75) {
      // 25% chance: Medium cities (10K-100K)
      cityPool = mediumCitiesByState.get(state) || []
      if (cityPool.length === 0) {
        // Fallback to all cities if no medium cities in state
        cityPool = citiesByState.get(state) || []
      }
    } else {
      // 25% chance: Small towns (<10K)
      cityPool = smallCitiesByState.get(state) || []
      if (cityPool.length === 0) {
        // Fallback to all cities if no small towns in state
        cityPool = citiesByState.get(state) || []
      }
    }

    const city = cityPool.length > 0
      ? cityPool[Math.floor(Math.random() * cityPool.length)].name
      : `City ${i % 30}` // Ultimate fallback

    // Random date within range
    const transactionDate = new Date(
      startDate.getTime() + Math.random() * (endDate.getTime() - startDate.getTime())
    )

    // Order insert timestamp (transaction date + random 0-12 hours)
    const orderInsertTimestamp = new Date(transactionDate)
    orderInsertTimestamp.setHours(orderInsertTimestamp.getHours() + Math.random() * 12)

    // Label generation (most within 2-6 hours, rarely breach SLA)
    const labelGenerationTimestamp = new Date(orderInsertTimestamp)
    const rand = Math.random()
    let hoursToLabel
    if (rand < 0.98) {
      // 98% on-time: 2-8 hours (well under 12 hour SLA)
      hoursToLabel = 2 + Math.random() * 6
    } else {
      // 2% late: 12-20 hours (breach SLA but not extreme)
      hoursToLabel = 12 + Math.random() * 8
    }
    labelGenerationTimestamp.setHours(labelGenerationTimestamp.getHours() + hoursToLabel)

    // Transit time based on zone (correlates with distance from origin 60007)
    const zoneTransit = zoneTransitTimes[zone] || { min: 3.0, max: 4.5 }
    const transitDays = zoneTransit.min + Math.random() * (zoneTransit.max - zoneTransit.min)

    // Delivered date logic: Only recent shipments can be undelivered
    // Shipments older than 14 days should always be delivered
    const daysSinceLabelGeneration = (endDate.getTime() - labelGenerationTimestamp.getTime()) / (24 * 60 * 60 * 1000)
    let deliveredDate: Date | null

    if (daysSinceLabelGeneration > 14) {
      // Old shipments are always delivered
      deliveredDate = new Date(labelGenerationTimestamp.getTime() + transitDays * 24 * 60 * 60 * 1000)
    } else if (daysSinceLabelGeneration > 7) {
      // 7-14 days old: 5% chance of still being in transit (exception cases)
      deliveredDate = Math.random() < 0.95
        ? new Date(labelGenerationTimestamp.getTime() + transitDays * 24 * 60 * 60 * 1000)
        : null
    } else if (daysSinceLabelGeneration > 4) {
      // 4-7 days old: 15% still in transit (some delays)
      deliveredDate = Math.random() < 0.85
        ? new Date(labelGenerationTimestamp.getTime() + transitDays * 24 * 60 * 60 * 1000)
        : null
    } else if (daysSinceLabelGeneration > 2) {
      // 2-4 days old: 40% still in transit (normal in-transit)
      deliveredDate = Math.random() < 0.60
        ? new Date(labelGenerationTimestamp.getTime() + transitDays * 24 * 60 * 60 * 1000)
        : null
    } else {
      // 0-2 days old: 70% still in transit (very recent)
      deliveredDate = Math.random() < 0.30
        ? new Date(labelGenerationTimestamp.getTime() + transitDays * 24 * 60 * 60 * 1000)
        : null
    }

    // Zone-based costs: $6.11 (zone 1) to $13.42 (zone 8)
    // Add small random variation (±$0.50) for realism
    const zoneBaseCost = zoneCosts[zone] || 10.27
    const costVariation = (Math.random() - 0.5) * 1.00 // ±$0.50 variation
    const baseCost = zoneBaseCost + costVariation
    const surcharge = Math.random() < 0.25 ? 0.15 + Math.random() * 0.50 : 0 // 25% chance of $0.15-$0.65 surcharge
    const insurance = Math.random() < 0.2 ? 2 + Math.random() * 3 : 0

    shipments.push({
      userId: `USER${1000 + i}`,
      merchantName: 'Sample Merchant',
      customerName: `Customer ${i}`,
      storeIntegrationName: 'Shopify',
      orderId: `ORD${10000 + i}`,
      transactionType: 'Shipment',
      transactionDate: transactionDate.toISOString().split('T')[0],
      storeOrderId: `STORE${20000 + i}`,
      trackingId: `1Z${carrier}${Math.random().toString(36).substring(2, 15).toUpperCase()}`,
      fulfillmentWithoutSurcharge: parseFloat(baseCost.toFixed(2)),
      surchargeApplied: parseFloat(surcharge.toFixed(2)),
      originalInvoice: parseFloat((baseCost + surcharge + insurance).toFixed(2)),
      insuranceAmount: parseFloat(insurance.toFixed(2)),
      productsSold: `Product ${i % 50}`,
      totalQuantity: 1 + Math.floor(Math.random() * 3),
      shipOptionId: `${carrier}-${carrierService.replace(/\s/g, '')}`,
      carrier,
      carrierService,
      zoneUsed: zone,
      actualWeightOz: 8 + Math.floor(Math.random() * 64),
      dimWeightOz: 10 + Math.floor(Math.random() * 80),
      billableWeightOz: Math.max(
        8 + Math.floor(Math.random() * 64),
        10 + Math.floor(Math.random() * 80)
      ),
      length: 8 + Math.floor(Math.random() * 12),
      width: 6 + Math.floor(Math.random() * 10),
      height: 4 + Math.floor(Math.random() * 8),
      zipCode: `${10000 + Math.floor(Math.random() * 89999)}`,
      city,
      state,
      destinationCountry: 'US',
      orderInsertTimestamp: orderInsertTimestamp.toISOString(),
      labelGenerationTimestamp: labelGenerationTimestamp.toISOString(),
      deliveredDate: deliveredDate ? deliveredDate.toISOString() : null,
      transitTimeDays: deliveredDate ? transitDays : null,
      fcName: 'FC-East',
      orderCategory: 'Standard',
    })
  }

  return shipments.sort((a, b) =>
    new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime()
  )
}

// Sample data for other tabs (to be used in Phase 2)
export const sampleReturns = []
export const sampleReceiving = []
export const sampleStorage = []
export const sampleCredits = []

// Fee types for additional services (as they appear in raw data)
const additionalServicesFeeTypes = [
  // D2C Extra Picks
  { feeType: 'Per Pick Fee', weight: 30, minAmount: 0.25, maxAmount: 1.50 },
  // B2B Fees (various)
  { feeType: 'B2B - Case Pick Fee', weight: 5, minAmount: 2.00, maxAmount: 8.00 },
  { feeType: 'B2B - Each Pick Fee', weight: 5, minAmount: 0.50, maxAmount: 2.00 },
  { feeType: 'B2B - Label Fee', weight: 3, minAmount: 0.25, maxAmount: 1.00 },
  { feeType: 'B2B - Order Fee', weight: 4, minAmount: 3.00, maxAmount: 10.00 },
  { feeType: 'B2B - Pallet Material Charge', weight: 2, minAmount: 5.00, maxAmount: 20.00 },
  { feeType: 'B2B - Pallet Pack Fee', weight: 2, minAmount: 8.00, maxAmount: 25.00 },
  { feeType: 'B2B - ShipBob Freight Fee', weight: 3, minAmount: 15.00, maxAmount: 75.00 },
  { feeType: 'B2B - Supplies', weight: 2, minAmount: 1.00, maxAmount: 5.00 },
  // MultiHub IQ
  { feeType: 'Inventory Placement Program Fee', weight: 18, minAmount: 2.00, maxAmount: 8.00 },
  // URO Fees
  { feeType: 'URO Storage Fee', weight: 8, minAmount: 0.50, maxAmount: 3.00 },
  // VAS/Kitting
  { feeType: 'VAS - Paid Requests', weight: 6, minAmount: 3.00, maxAmount: 15.00 },
  { feeType: 'Kitting Fee', weight: 6, minAmount: 2.00, maxAmount: 12.00 },
  // Other
  { feeType: 'Address Correction', weight: 6, minAmount: 5.00, maxAmount: 15.00 },
]

// Generate sample additional services data
export function generateSampleAdditionalServices(count: number = 500): AdditionalServiceData[] {
  const services: AdditionalServiceData[] = []
  const now = new Date()
  const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)

  // Create weighted fee type selection
  const weightedFeeTypes: typeof additionalServicesFeeTypes[0][] = []
  additionalServicesFeeTypes.forEach(ft => {
    for (let i = 0; i < ft.weight; i++) {
      weightedFeeTypes.push(ft)
    }
  })

  const merchantNames = [
    'Acme Corp', 'TechVision LLC', 'GlobalTrade Inc', 'Premier Logistics',
    'Apex Manufacturing', 'NexGen Solutions', 'Coastal Distributors',
    'ValueChain Corp', 'Summit Supply', 'Metropolitan Holdings'
  ]

  for (let i = 0; i < count; i++) {
    const randomFeeType = weightedFeeTypes[Math.floor(Math.random() * weightedFeeTypes.length)]
    const randomMerchant = merchantNames[Math.floor(Math.random() * merchantNames.length)]

    // Random date within the last year
    const randomTime = oneYearAgo.getTime() + Math.random() * (now.getTime() - oneYearAgo.getTime())
    const transactionDate = new Date(randomTime)

    // Calculate amount based on fee type ranges
    const amount = randomFeeType.minAmount + Math.random() * (randomFeeType.maxAmount - randomFeeType.minAmount)

    services.push({
      userId: `USR-${String(Math.floor(Math.random() * 100) + 1).padStart(3, '0')}`,
      merchantName: randomMerchant,
      referenceId: `REF-${String(i + 1).padStart(5, '0')}`,
      feeType: randomFeeType.feeType,
      invoiceAmount: Math.round(amount * 100) / 100,
      transactionDate: transactionDate.toISOString(),
    })
  }

  return services.sort((a, b) =>
    new Date(b.transactionDate).getTime() - new Date(a.transactionDate).getTime()
  )
}

// Pre-generate sample additional services data
export const sampleAdditionalServices = generateSampleAdditionalServices(500)
