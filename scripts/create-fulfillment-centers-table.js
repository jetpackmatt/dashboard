#!/usr/bin/env node
/**
 * Create fulfillment_centers table and seed with existing FCs
 * Auto-detects US vs Canada based on naming patterns
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Canadian provinces (full names used in ShipBob FC names)
const CANADIAN_PROVINCES = [
  'Ontario', 'Quebec', 'British Columbia', 'Alberta', 'Manitoba',
  'Saskatchewan', 'Nova Scotia', 'New Brunswick', 'Newfoundland',
  'Prince Edward Island', 'Northwest Territories', 'Yukon', 'Nunavut'
]

// US state abbreviations (2-letter codes in parentheses)
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA',
  'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD',
  'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC',
  'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'DC'
]

// Tax rates by Canadian province
const CANADIAN_TAX_RATES = {
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
  // Territories - GST only
  'Northwest Territories': { rate: 5, type: 'GST' },
  'Yukon': { rate: 5, type: 'GST' },
  'Nunavut': { rate: 5, type: 'GST' },
}

/**
 * Detect country and state/province from FC name
 * @param {string} fcName - e.g., "Brampton (Ontario) 2" or "Ontario 6 (CA)"
 * @returns {{ country: string, stateProvince: string | null, taxRate: number | null, taxType: string | null }}
 *
 * IMPORTANT: Check for US state abbreviations FIRST, because:
 * - "Ontario 6 (CA)" = Ontario, California (US) - the (CA) means California
 * - "Brampton (Ontario) 2" = Brampton, Ontario (Canada) - full province name in parens
 */
function detectFCLocation(fcName) {
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
  console.log(`  ⚠️  Could not auto-detect country for "${fcName}", defaulting to US`)
  return {
    country: 'US',
    stateProvince: null,
    taxRate: null,
    taxType: null
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('Creating fulfillment_centers table')
  console.log('='.repeat(60))

  // Check if table exists
  const { data: existingTable } = await supabase
    .from('fulfillment_centers')
    .select('id')
    .limit(1)

  if (existingTable !== null) {
    console.log('\n✅ Table already exists, checking for new FCs...')
  } else {
    console.log('\n⚠️  Table does not exist. Please run this SQL in Supabase Dashboard:\n')
    console.log(`
CREATE TABLE fulfillment_centers (
  id SERIAL PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  country TEXT NOT NULL DEFAULT 'US',
  state_province TEXT,
  tax_rate NUMERIC(5,2),
  tax_type TEXT,
  auto_detected BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

COMMENT ON TABLE fulfillment_centers IS 'Fulfillment center metadata for tax calculations. Canadian FCs require GST/HST handling.';

ALTER TABLE fulfillment_centers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow read access" ON fulfillment_centers FOR SELECT USING (true);
CREATE POLICY "Service role full access" ON fulfillment_centers FOR ALL USING (auth.role() = 'service_role');
`)
    console.log('\nThen run this script again to seed the data.')
    return
  }

  // Get all unique FC names from transactions using cursor-based pagination
  // (Supabase returns max 1000 rows per query)
  console.log('\nFetching unique FC names from transactions...')
  const allFCNames = new Set()
  const pageSize = 1000
  let lastId = null
  let pageCount = 0

  while (true) {
    let query = supabase
      .from('transactions')
      .select('transaction_id, fulfillment_center')
      .not('fulfillment_center', 'is', null)
      .order('transaction_id', { ascending: true })
      .limit(pageSize)

    if (lastId) {
      query = query.gt('transaction_id', lastId)
    }

    const { data: page, error } = await query
    if (error) {
      console.error('Error fetching transactions:', error)
      break
    }
    if (!page || page.length === 0) break

    page.forEach(tx => allFCNames.add(tx.fulfillment_center))
    lastId = page[page.length - 1].transaction_id
    pageCount++

    if (page.length < pageSize) break
  }

  const uniqueFCs = [...allFCNames]
  console.log(`Found ${uniqueFCs.length} unique fulfillment centers (scanned ${pageCount} pages)`)

  // Get existing FCs in our table
  const { data: existingFCs } = await supabase
    .from('fulfillment_centers')
    .select('name')

  const existingNames = new Set(existingFCs?.map(f => f.name) || [])

  // Find new FCs
  const newFCs = uniqueFCs.filter(name => !existingNames.has(name))

  if (newFCs.length === 0) {
    console.log('\n✅ All FCs already in table, nothing to add.')
    return
  }

  console.log(`\n${newFCs.length} new FCs to add:`)

  // Build records for new FCs
  const records = newFCs.map(name => {
    const location = detectFCLocation(name)
    console.log(`  ${location.country === 'CA' ? '🍁' : '🇺🇸'} ${name} → ${location.country} (${location.stateProvince || 'unknown'})`)
    return {
      name,
      country: location.country,
      state_province: location.stateProvince,
      tax_rate: location.taxRate,
      tax_type: location.taxType,
      auto_detected: true
    }
  })

  // Insert
  const { error } = await supabase
    .from('fulfillment_centers')
    .insert(records)

  if (error) {
    console.error('\n❌ Error inserting FCs:', error)
    return
  }

  console.log(`\n✅ Added ${records.length} fulfillment centers`)

  // Show final state
  const { data: allFCs } = await supabase
    .from('fulfillment_centers')
    .select('*')
    .order('country', { ascending: false })
    .order('name')

  console.log('\n=== All Fulfillment Centers ===')
  console.log('Country | State/Province | Tax Rate | Name')
  console.log('-'.repeat(70))
  for (const fc of allFCs || []) {
    const taxInfo = fc.tax_rate ? `${fc.tax_rate}% ${fc.tax_type}` : '-'
    console.log(`   ${fc.country}   |    ${(fc.state_province || '-').padEnd(10)} |  ${taxInfo.padEnd(12)} | ${fc.name}`)
  }
}

main().catch(err => {
  console.error('Error:', err)
  process.exit(1)
})
