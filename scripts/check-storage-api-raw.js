/**
 * Fetch raw storage transactions from ShipBob Billing API
 * to see all available fields
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Use the parent token (has billing API access)
  const token = process.env.SHIPBOB_API_TOKEN
  if (!token) {
    console.log('No SHIPBOB_API_TOKEN found')
    return
  }

  // JPHS-0037 invoice IDs - 8633618 has FC (storage) transactions in our DB
  const invoiceId = 8633618
  console.log(`Using invoice ID: ${invoiceId}\n`)
  const response = await fetch(
    `https://api.shipbob.com/2025-07/invoices/${invoiceId}/transactions?pageSize=50`,
    { headers: { Authorization: `Bearer ${token}` } }
  )

  if (!response.ok) {
    console.log(`Error: ${response.status}`)
    return
  }

  const data = await response.json()
  console.log('Raw response keys:', Object.keys(data))
  console.log('Raw response (first 500 chars):', JSON.stringify(data).substring(0, 500))
  console.log()

  // Handle paginated response
  const items = Array.isArray(data) ? data : (data.items || [])

  // Find FC (Storage) transactions
  const storageTxs = items.filter(t => t.reference_type === 'FC')

  console.log('=== RAW TRANSACTIONS FROM API ===\n')
  console.log(`Total items: ${items.length}\n`)

  // Show unique reference_types
  const types = [...new Set(items.map(t => t.reference_type))]
  console.log('Reference types in this batch:', types.join(', '))
  console.log()

  // Find FC (Storage) transactions
  console.log(`Found ${storageTxs.length} FC (storage) transactions\n`)

  // Show first 5 items regardless of type
  console.log('First 5 items:')
  for (let i = 0; i < Math.min(5, items.length); i++) {
    console.log(`\n--- Transaction ${i + 1} (${items[i].reference_type}) ---`)
    console.log(JSON.stringify(items[i], null, 2))
  }
}
main().catch(console.error)
