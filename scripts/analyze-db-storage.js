/**
 * Analyze storage transactions in our DB to understand the structure
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'
  const storageInvoiceId = 8633618

  console.log('='.repeat(70))
  console.log('DATABASE STORAGE TRANSACTION ANALYSIS')
  console.log('='.repeat(70))

  // Get all storage transactions for this invoice
  let allTx = []
  let offset = 0
  while (true) {
    const { data, error } = await supabase
      .from('transactions')
      .select('*')
      .eq('client_id', hensonId)
      .eq('invoice_id_sb', storageInvoiceId)
      .range(offset, offset + 999)

    if (error || !data || data.length === 0) break
    allTx.push(...data)
    if (data.length < 1000) break
    offset += 1000
  }

  console.log('Total storage transactions:', allTx.length)

  // Analyze charge_date distribution
  const dateDistribution = {}
  for (const tx of allTx) {
    const date = tx.charge_date
    dateDistribution[date] = (dateDistribution[date] || 0) + 1
  }

  console.log('\n--- CHARGE_DATE DISTRIBUTION ---')
  for (const [date, count] of Object.entries(dateDistribution).sort()) {
    console.log(`  ${date}: ${count} rows`)
  }
  console.log('Total unique charge_dates:', Object.keys(dateDistribution).length)

  // Analyze reference_id structure
  console.log('\n--- REFERENCE_ID STRUCTURE ---')
  // Format: FC-InventoryID-LocationType (e.g., 156-20101185-Pallet)
  const inventoryMap = {}
  const fcSet = new Set()
  const locationTypes = new Set()

  for (const tx of allTx) {
    const parts = tx.reference_id.split('-')
    if (parts.length >= 3) {
      const [fc, invId, locType] = parts
      fcSet.add(fc)
      locationTypes.add(locType)

      const key = `${invId}-${locType}`
      if (!inventoryMap[key]) {
        inventoryMap[key] = { invId, locType, fc: new Set(), count: 0, costs: [] }
      }
      inventoryMap[key].fc.add(fc)
      inventoryMap[key].count++
      inventoryMap[key].costs.push(Number(tx.cost))
    }
  }

  console.log('Unique FC IDs:', [...fcSet])
  console.log('Unique location types:', [...locationTypes])
  console.log('Unique inventory-location combinations:', Object.keys(inventoryMap).length)

  // Sample inventory items
  console.log('\n--- SAMPLE INVENTORY ITEMS ---')
  const entries = Object.entries(inventoryMap).sort((a, b) => b[1].count - a[1].count)
  for (const [key, info] of entries.slice(0, 10)) {
    const avgCost = info.costs.reduce((a, b) => a + b, 0) / info.costs.length
    console.log(`  ${key}: ${info.count} txns, FCs: ${[...info.fc].join(',')}, avg cost: $${avgCost.toFixed(4)}`)
  }

  // Check if count matches expected days
  console.log('\n--- DATE INFERENCE ---')
  console.log('If invoice period is Nov 16-30 (15 days):')
  const expectedDays = 15
  let matchCount = 0
  for (const [key, info] of entries) {
    if (info.count % expectedDays === 0) {
      matchCount++
    }
  }
  console.log(`Items with count divisible by 15: ${matchCount}/${entries.length}`)

  // Calculate per-day rate
  console.log('\n--- PER-DAY COST ANALYSIS ---')
  const perDayCosts = {}
  for (const [key, info] of entries) {
    // Each transaction is 1 day for 1 unit
    const uniqueCosts = [...new Set(info.costs.map(c => c.toFixed(4)))]
    perDayCosts[key] = { count: info.count, costs: uniqueCosts }
  }

  console.log('Sample per-day costs (should match daily rate):')
  for (const [key, info] of entries.slice(0, 10)) {
    const uniqueCosts = [...new Set(info.costs.map(c => c.toFixed(4)))]
    console.log(`  ${key}: ${uniqueCosts.join(', ')}`)
  }

  // Final count
  console.log('\n--- SUMMARY ---')
  console.log(`Total transactions: ${allTx.length}`)
  console.log(`All have charge_date = ${Object.keys(dateDistribution)[0]}`)
  console.log('Each transaction represents 1 day for 1 storage unit')
  console.log(`If 15 days in period: ~${Math.round(allTx.length / 15)} storage units on average per day`)
}

main().catch(console.error)
