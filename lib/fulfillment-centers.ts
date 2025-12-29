/**
 * Fulfillment Center utilities
 *
 * Provides functions to:
 * - Detect country (US/CA) from FC name
 * - Auto-register new FCs when encountered
 * - Look up tax rates for Canadian FCs
 */

import { SupabaseClient } from '@supabase/supabase-js'

// Canadian provinces (full names used in ShipBob FC names)
const CANADIAN_PROVINCES = [
  'Ontario', 'Quebec', 'British Columbia', 'Alberta', 'Manitoba',
  'Saskatchewan', 'Nova Scotia', 'New Brunswick', 'Newfoundland',
  'Prince Edward Island', 'Northwest Territories', 'Yukon', 'Nunavut'
]

// US state abbreviations (2-letter codes)
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
]

// Tax rates by Canadian province
const CANADIAN_TAX_RATES: Record<string, { rate: number; type: string }> = {
  'Ontario': { rate: 13, type: 'HST' },
  'Quebec': { rate: 14.975, type: 'GST+QST' },
  'British Columbia': { rate: 12, type: 'GST+PST' },
  'Alberta': { rate: 5, type: 'GST' },
  'Manitoba': { rate: 12, type: 'GST+PST' },
  'Saskatchewan': { rate: 11, type: 'GST+PST' },
  'Nova Scotia': { rate: 15, type: 'HST' },
  'New Brunswick': { rate: 15, type: 'HST' },
  'Newfoundland': { rate: 15, type: 'HST' },
  'Prince Edward Island': { rate: 15, type: 'HST' },
  'Northwest Territories': { rate: 5, type: 'GST' },
  'Yukon': { rate: 5, type: 'GST' },
  'Nunavut': { rate: 5, type: 'GST' },
}

export interface FCLocation {
  country: 'US' | 'CA'
  stateProvince: string | null
  taxRate: number | null
  taxType: string | null
}

export interface FulfillmentCenter {
  id: number
  name: string
  country: string
  state_province: string | null
  tax_rate: number | null
  tax_type: string | null
  auto_detected: boolean
}

/**
 * Detect country and state/province from FC name
 * Uses naming conventions from ShipBob:
 * - US: "City (STATE_ABBREV)" e.g., "Ontario 6 (CA)" = Ontario, California
 * - Canada: "City (PROVINCE_NAME)" e.g., "Brampton (Ontario) 2" = Brampton, Ontario
 *
 * IMPORTANT: Check for US state abbreviations FIRST, because:
 * - "Ontario 6 (CA)" = Ontario, California (US) - the (CA) means California
 * - "Brampton (Ontario) 2" = Brampton, Ontario (Canada) - full province name in parens
 */
export function detectFCLocation(fcName: string): FCLocation {
  // Check for US state abbreviations in parentheses FIRST
  // This catches "Ontario 6 (CA)" as California, not Canada
  const stateMatch = fcName.match(/\(([A-Z]{2})\)/)
  if (stateMatch && US_STATES.includes(stateMatch[1])) {
    return {
      country: 'US',
      stateProvince: stateMatch[1],
      taxRate: null,
      taxType: null
    }
  }

  // Check for Canadian provinces (full names in parentheses)
  // e.g., "Brampton (Ontario) 2" - province name is spelled out, not abbreviated
  for (const province of CANADIAN_PROVINCES) {
    // Look for province name in parentheses like "(Ontario)"
    const provincePattern = new RegExp(`\\(${province}\\)`, 'i')
    if (provincePattern.test(fcName)) {
      const taxInfo = CANADIAN_TAX_RATES[province] || { rate: 5, type: 'GST' }
      return {
        country: 'CA',
        stateProvince: province,
        taxRate: taxInfo.rate,
        taxType: taxInfo.type
      }
    }
  }

  // Check for "US" in the name
  if (fcName.includes('US ') || fcName.startsWith('US')) {
    return {
      country: 'US',
      stateProvince: null,
      taxRate: null,
      taxType: null
    }
  }

  // Default to US (most common)
  return {
    country: 'US',
    stateProvince: null,
    taxRate: null,
    taxType: null
  }
}

/**
 * Check if an FC name indicates a Canadian fulfillment center
 * Quick check without database lookup
 */
export function isCanadianFC(fcName: string | null | undefined): boolean {
  if (!fcName) return false
  return detectFCLocation(fcName).country === 'CA'
}

/**
 * Get tax info for a Canadian FC
 * Returns null if not Canadian or no tax info available
 */
export function getCanadianFCTaxInfo(fcName: string | null | undefined): { taxRate: number; taxType: string } | null {
  if (!fcName) return null
  const location = detectFCLocation(fcName)
  if (location.country === 'CA' && location.taxRate) {
    return {
      taxRate: location.taxRate,
      taxType: location.taxType || 'GST'
    }
  }
  return null
}

// In-memory cache of known FCs to avoid repeated DB lookups
let fcCache: Map<string, FulfillmentCenter> | null = null
let fcCacheTime: number = 0
const FC_CACHE_TTL = 5 * 60 * 1000 // 5 minutes

/**
 * Get all fulfillment centers from database (with caching)
 */
export async function getFulfillmentCenters(supabase: SupabaseClient): Promise<Map<string, FulfillmentCenter>> {
  const now = Date.now()
  if (fcCache && (now - fcCacheTime) < FC_CACHE_TTL) {
    return fcCache
  }

  const { data, error } = await supabase
    .from('fulfillment_centers')
    .select('*')

  if (error) {
    console.error('Error fetching fulfillment centers:', error)
    return fcCache || new Map()
  }

  fcCache = new Map((data || []).map(fc => [fc.name, fc]))
  fcCacheTime = now
  return fcCache
}

/**
 * Ensure an FC exists in the database, auto-creating if needed
 * Call this when encountering an FC name during sync
 */
export async function ensureFCExists(
  supabase: SupabaseClient,
  fcName: string
): Promise<FulfillmentCenter | null> {
  if (!fcName) return null

  // Check cache first
  const cache = await getFulfillmentCenters(supabase)
  if (cache.has(fcName)) {
    return cache.get(fcName)!
  }

  // Not in cache, try to insert
  const location = detectFCLocation(fcName)

  const { data, error } = await supabase
    .from('fulfillment_centers')
    .upsert({
      name: fcName,
      country: location.country,
      state_province: location.stateProvince,
      tax_rate: location.taxRate,
      tax_type: location.taxType,
      auto_detected: true,
      updated_at: new Date().toISOString()
    }, { onConflict: 'name' })
    .select()
    .single()

  if (error) {
    // Might be a race condition, try to fetch
    const { data: existing } = await supabase
      .from('fulfillment_centers')
      .select('*')
      .eq('name', fcName)
      .single()

    if (existing) {
      // Update cache
      fcCache?.set(fcName, existing)
      return existing
    }

    console.error(`Error ensuring FC exists: ${fcName}`, error)
    return null
  }

  // Update cache
  if (data) {
    fcCache?.set(fcName, data)
  }

  // Log new FC detection
  if (data) {
    console.log(`[FC] Auto-registered new fulfillment center: ${fcName} (${location.country}, ${location.stateProvince || 'unknown'})`)
  }

  return data
}

/**
 * Batch ensure multiple FCs exist (more efficient for sync)
 */
export async function ensureFCsExist(
  supabase: SupabaseClient,
  fcNames: string[]
): Promise<void> {
  const uniqueNames = [...new Set(fcNames.filter(Boolean))]
  if (uniqueNames.length === 0) return

  const cache = await getFulfillmentCenters(supabase)
  const newNames = uniqueNames.filter(name => !cache.has(name))

  if (newNames.length === 0) return

  const records = newNames.map(name => {
    const location = detectFCLocation(name)
    return {
      name,
      country: location.country,
      state_province: location.stateProvince,
      tax_rate: location.taxRate,
      tax_type: location.taxType,
      auto_detected: true
    }
  })

  const { error } = await supabase
    .from('fulfillment_centers')
    .upsert(records, { onConflict: 'name' })

  if (error) {
    console.error('Error batch inserting FCs:', error)
  } else {
    console.log(`[FC] Auto-registered ${newNames.length} new fulfillment centers:`, newNames)
    // Invalidate cache
    fcCache = null
  }
}

/**
 * Check if an FC is Canadian using database lookup (more accurate than name detection)
 */
export async function isCanadianFCFromDB(
  supabase: SupabaseClient,
  fcName: string | null | undefined
): Promise<boolean> {
  if (!fcName) return false

  const cache = await getFulfillmentCenters(supabase)
  const fc = cache.get(fcName)

  if (fc) {
    return fc.country === 'CA'
  }

  // Fall back to name detection
  return isCanadianFC(fcName)
}

/**
 * Get tax rate for an FC from database
 */
export async function getFCTaxRate(
  supabase: SupabaseClient,
  fcName: string | null | undefined
): Promise<{ taxRate: number; taxType: string } | null> {
  if (!fcName) return null

  const cache = await getFulfillmentCenters(supabase)
  const fc = cache.get(fcName)

  if (fc && fc.tax_rate) {
    return {
      taxRate: fc.tax_rate,
      taxType: fc.tax_type || 'GST'
    }
  }

  // Fall back to name detection
  return getCanadianFCTaxInfo(fcName)
}
