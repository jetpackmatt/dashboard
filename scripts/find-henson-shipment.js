#!/usr/bin/env node
/**
 * Find shipment 314479977 (Henson, Nov 10)
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryAllPages(params) {
  let cursor = null
  let allItems = []
  let pageNum = 0

  do {
    pageNum++
    let url = `${BASE_URL}/2025-07/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ...params, page_size: 1000 })
    })

    const data = await response.json()
    allItems.push(...(data.items || []))
    cursor = data.next || null

    if (pageNum >= 20) break
  } while (cursor)

  return allItems
}

async function main() {
  console.log('Searching for shipment 314479977...\n')

  // Get all Nov 10 transactions
  const items = await queryAllPages({
    from_date: '2025-11-10T00:00:00Z',
    to_date: '2025-11-10T23:59:59Z'
  })

  console.log('Nov 10 transactions:', items.length)

  // Group by fulfillment center
  const byFC = {}
  for (const tx of items) {
    const fc = tx.fulfillment_center || 'Unknown'
    if (!byFC[fc]) byFC[fc] = 0
    byFC[fc]++
  }

  console.log('\nBy fulfillment center:')
  Object.entries(byFC).forEach(([fc, count]) => {
    console.log(`  ${fc}: ${count}`)
  })

  // Check reference_id range
  const refs = items.map(t => parseInt(t.reference_id)).filter(r => !isNaN(r)).sort((a, b) => a - b)
  console.log('\nReference ID range:')
  console.log('  Min:', refs[0])
  console.log('  Max:', refs[refs.length - 1])
  console.log('  Looking for: 314479977')

  // Search for it
  const found = items.find(t => t.reference_id === '314479977')
  console.log('\n314479977 found:', found ? 'YES' : 'NO')

  if (found) {
    console.log('\nTransaction details:')
    console.log(JSON.stringify(found, null, 2))
  } else {
    // Find closest
    const closest = refs.sort((a, b) => Math.abs(a - 314479977) - Math.abs(b - 314479977)).slice(0, 5)
    console.log('\nClosest reference_ids:')
    closest.forEach(r => console.log(`  ${r} (diff: ${Math.abs(r - 314479977)})`))
  }

  // Show Twin Lakes samples (Henson's FC)
  const twinLakes = items.filter(t => t.fulfillment_center.includes('Twin Lakes'))
  console.log('\nTwin Lakes (WI) transactions:', twinLakes.length)
  if (twinLakes.length > 0) {
    console.log('Sample reference_ids:')
    twinLakes.slice(0, 5).forEach(t => {
      console.log(`  ${t.reference_id} - ${t.transaction_fee}: $${t.amount}`)
    })
  }
}

main().catch(console.error)
