/**
 * Check all distinct fee_type values in transactions table
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  console.log('=== ALL DISTINCT FEE_TYPE VALUES ===\n')

  // Get total count
  const { count: totalCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })

  console.log(`Total transactions in database: ${totalCount}\n`)

  // Get unique fee types by querying in batches
  const counts = {}
  let offset = 0
  const batchSize = 1000

  while (offset < totalCount) {
    const { data, error } = await supabase
      .from('transactions')
      .select('fee_type')
      .range(offset, offset + batchSize - 1)

    if (error) {
      console.error('Error:', error)
      return
    }

    for (const row of data || []) {
      const ft = row.fee_type || '(null)'
      counts[ft] = (counts[ft] || 0) + 1
    }

    offset += batchSize
    process.stdout.write(`\rProcessed ${Math.min(offset, totalCount)}/${totalCount}...`)
  }

  console.log('\n')

  // Sort by count descending
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1])

  for (const [ft, count] of sorted) {
    console.log(`  ${ft}: ${count}`)
  }

  // Check specifically for IPP Fee
  console.log('\n\n=== SEARCHING FOR INVENTORY/MULTI-HUB FEES ===')
  const ippMatches = sorted.filter(([ft]) =>
    ft.toLowerCase().includes('inventory') ||
    ft.toLowerCase().includes('ipp') ||
    ft.toLowerCase().includes('placement') ||
    ft.toLowerCase().includes('multi')
  )
  if (ippMatches.length > 0) {
    for (const [ft, count] of ippMatches) {
      console.log(`  Found: "${ft}" (${count} records)`)
    }
  } else {
    console.log('  No matches found for Inventory/Multi-Hub related fees')
  }

  // Check which clients have IPP Fee
  console.log('\n\n=== IPP FEE BY CLIENT ===')
  const { data: ippByClient, error: ippError } = await supabase
    .from('transactions')
    .select('client_id')
    .eq('fee_type', 'Inventory Placement Program Fee')

  if (ippError) {
    console.error('Error:', ippError)
  } else {
    // Count by client_id
    const clientCounts = {}
    for (const row of ippByClient || []) {
      const clientId = row.client_id || 'Unknown'
      clientCounts[clientId] = (clientCounts[clientId] || 0) + 1
    }

    // Get client names
    const clientIds = Object.keys(clientCounts)
    const { data: clients } = await supabase
      .from('clients')
      .select('id, brand_name')
      .in('id', clientIds)

    const clientNames = {}
    for (const c of clients || []) {
      clientNames[c.id] = c.brand_name || c.id
    }

    for (const [clientId, count] of Object.entries(clientCounts).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${clientNames[clientId] || clientId}: ${count}`)
    }
  }
}

check().catch(console.error)
