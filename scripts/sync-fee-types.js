#!/usr/bin/env node
/**
 * Sync all fee types from ShipBob API to fee_type_categories table
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'

/**
 * Categorize fee types into the 6 billing categories matching UI tabs:
 * - Shipments: Shipping, pick/pack, fulfillment, surcharges
 * - Additional Services: B2B, VAS, ITO, WMS, kitting, admin, taxes
 * - Returns: Return processing fees
 * - Receiving: WRO, inbound, freight
 * - Storage: Storage, warehousing
 * - Credits: Credits, refunds
 */
function categorizeFeeType(feeType) {
  const ft = feeType.toLowerCase()

  // Credits - credits, refunds
  if (ft.includes('credit') || ft.includes('refund')) return 'Credits'

  // Returns - return processing
  if (ft.includes('return')) return 'Returns'

  // Storage - storage, warehousing
  if (ft.includes('storage') || ft.includes('warehousing')) return 'Storage'

  // Receiving - WRO, inbound, freight, receiving
  if (ft.includes('wro') || ft.includes('receiving') || ft.includes('freight') || ft.includes('inbound')) return 'Receiving'

  // Shipments - shipping, pick/pack, fulfillment core, surcharges, carrier fees
  if (
    ft === 'shipping' ||
    ft.includes('shipping') ||
    ft.includes('pick') ||
    ft.includes('pack') ||
    ft.includes('surcharge') ||
    ft.includes('correction') ||
    ft.includes('residential') ||
    ft.includes('carrier') ||
    ft.includes('delivery') ||
    ft.includes('handling')
  ) return 'Shipments'

  // Additional Services - everything else (B2B, VAS, ITO, WMS, admin, taxes, kitting, etc.)
  // This is a catch-all for value-added and specialized services
  return 'Additional Services'
}

async function main() {
  console.log('=== Fee Types Sync ===\n')
  console.log('NOTE: Only INSERTS new fee types. Never updates existing categories.\n')

  const token = process.env.SHIPBOB_API_TOKEN
  if (!token) {
    console.error('SHIPBOB_API_TOKEN not configured')
    return
  }

  // Fetch from ShipBob
  console.log('Fetching fee types from ShipBob...')
  const res = await fetch(`${SHIPBOB_API_BASE}/transaction-fees`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!res.ok) {
    console.error(`API error: ${res.status} ${res.statusText}`)
    return
  }

  const data = await res.json()
  const feeList = data.fee_list || []
  console.log(`Found ${feeList.length} fee types from API\n`)

  // Get existing fee types from database
  const { data: existing } = await supabase
    .from('fee_type_categories')
    .select('fee_type')

  const existingSet = new Set((existing || []).map(r => r.fee_type))
  console.log(`Found ${existingSet.size} existing fee types in database`)

  // Filter to only NEW fee types
  const newFeeTypes = feeList.filter(ft => !existingSet.has(ft))

  if (newFeeTypes.length === 0) {
    console.log('\n✓ No new fee types to add. All are already in database.')
    return
  }

  console.log(`Found ${newFeeTypes.length} NEW fee types to add:\n`)

  // Build records with auto-categorization for new types only
  const now = new Date().toISOString()
  const records = newFeeTypes.map(feeType => ({
    fee_type: feeType,
    category: categorizeFeeType(feeType),
    display_name: feeType,
    description: null,
    is_active: true,
    source: 'shipbob',
    synced_at: now,
  }))

  // Show what will be added
  const byCategory = {}
  for (const r of records) {
    const cat = r.category || 'Uncategorized'
    if (!byCategory[cat]) byCategory[cat] = []
    byCategory[cat].push(r.fee_type)
  }

  console.log('New fee types by category:')
  for (const [cat, fees] of Object.entries(byCategory).sort()) {
    console.log(`\n  ${cat} (${fees.length}):`)
    fees.forEach(f => console.log(`    - ${f}`))
  }

  // INSERT only (not upsert) - never overwrite existing
  console.log('\n\nInserting to database...')
  const { error } = await supabase
    .from('fee_type_categories')
    .insert(records)

  if (error) {
    console.error('Insert error:', error.message)
    return
  }

  console.log(`\n✓ Inserted ${records.length} new fee types`)

  // Show final counts
  const { data: counts } = await supabase
    .from('fee_type_categories')
    .select('category')

  const finalCounts = {}
  for (const row of counts || []) {
    const cat = row.category || 'Uncategorized'
    finalCounts[cat] = (finalCounts[cat] || 0) + 1
  }

  console.log('\nFinal counts by category:')
  for (const [cat, cnt] of Object.entries(finalCounts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${cat}: ${cnt}`)
  }
}

main().catch(console.error)
