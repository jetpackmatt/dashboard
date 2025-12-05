#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })

async function main() {
  const resp = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.SHIPBOB_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from_date: '2025-11-01T00:00:00Z',
      to_date: '2025-12-04T23:59:59Z',
      page_size: 1000
    })
  })

  const data = await resp.json()
  const items = data.items || []

  // Group by reference_type
  const byRefType = {}
  for (const t of items) {
    if (!byRefType[t.reference_type]) byRefType[t.reference_type] = { count: 0, fees: new Set() }
    byRefType[t.reference_type].count++
    byRefType[t.reference_type].fees.add(t.transaction_fee)
  }

  console.log('Transactions by reference_type:\n')
  for (const [type, data] of Object.entries(byRefType)) {
    console.log(`${type}: ${data.count} transactions`)
    console.log(`  Fee types: ${[...data.fees].join(', ')}`)
    console.log('')
  }

  // Look for any VAS or service fees
  console.log('═'.repeat(60))
  console.log('Looking for VAS or service-type transactions...\n')

  const vasFees = ['VAS - Paid Requests', 'FlavorCloud Service Fee', 'Custom Pick Fees', 'Fragile Item', 'Serial Scan']

  for (const fee of vasFees) {
    const matches = items.filter(t => t.transaction_fee === fee)
    console.log(`${fee}: ${matches.length} transactions`)
    if (matches.length > 0) {
      matches.slice(0, 2).forEach(t => {
        console.log(`  $${t.amount} - ${t.reference_id} (${t.reference_type})`)
        console.log(`  Details: ${JSON.stringify(t.additional_details)}`)
      })
    }
  }
}

main().catch(console.error)
