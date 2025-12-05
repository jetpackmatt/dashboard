#!/usr/bin/env node
/**
 * Investigate why we're only seeing ~270 pending transactions
 * when there should be 2500-2600 for the week
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryTransactions(params, label) {
  const allItems = []
  const seenIds = new Set()
  let cursor = null
  let pageNum = 0
  let totalFromApi = 0

  do {
    pageNum++
    const body = { ...params, page_size: 250 }
    if (cursor) body.cursor = cursor

    const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const text = await response.text()
      console.log(`  ERROR ${response.status}: ${text.substring(0, 200)}`)
      return { items: [], label }
    }

    const data = await response.json()
    const items = data.items || []
    totalFromApi += items.length

    for (const t of items) {
      if (!seenIds.has(t.transaction_id)) {
        seenIds.add(t.transaction_id)
        allItems.push(t)
      }
    }

    cursor = data.next || null
    if (pageNum >= 50) {
      console.log(`  WARNING: Hit 50 page limit`)
      break
    }
    // Stop if pagination loops
    if (items.length > 0 && items.every(t => seenIds.has(t.transaction_id))) break
  } while (cursor)

  return { items: allItems, label, totalFromApi, pages: pageNum }
}

async function main() {
  console.log('Investigating missing pending transactions\n')
  console.log('Expected: ~2500-2600 pending transactions this week')
  console.log('Finding: ~270 pending transactions')
  console.log('Gap: ~90% missing\n')
  console.log('═'.repeat(70))

  // 1. Check token info
  console.log('\n1. Checking token capabilities...')
  const meResponse = await fetch(`${BASE_URL}/1.0/user`, {
    headers: { 'Authorization': `Bearer ${SHIPBOB_TOKEN}` }
  })
  if (meResponse.ok) {
    const me = await meResponse.json()
    console.log(`  User: ${JSON.stringify(me, null, 2)}`)
  } else {
    console.log(`  User endpoint: ${meResponse.status}`)
  }

  // 2. Check channels/merchants
  console.log('\n2. Checking channels...')
  const channelsResponse = await fetch(`${BASE_URL}/1.0/channel`, {
    headers: { 'Authorization': `Bearer ${SHIPBOB_TOKEN}` }
  })
  if (channelsResponse.ok) {
    const channels = await channelsResponse.json()
    console.log(`  Channels: ${JSON.stringify(channels, null, 2)}`)
  } else {
    console.log(`  Channels endpoint: ${channelsResponse.status}`)
  }

  // 3. Try with no filters at all
  console.log('\n3. Query with NO filters...')
  const noFilter = await queryTransactions({}, 'No filters')
  console.log(`  Result: ${noFilter.items.length} unique, ${noFilter.totalFromApi} total from API, ${noFilter.pages} pages`)

  // 4. Try with just invoiced_status: false
  console.log('\n4. Query with invoiced_status: false only...')
  const pendingOnly = await queryTransactions({ invoiced_status: false }, 'Pending only')
  console.log(`  Result: ${pendingOnly.items.length} unique, ${pendingOnly.totalFromApi} total from API, ${pendingOnly.pages} pages`)

  // 5. Check if there's a merchant_id or channel_id parameter we should use
  console.log('\n5. Trying different parameter names for merchant filtering...')

  // Try merchant_ids (if it exists)
  const withMerchant = await queryTransactions({ merchant_ids: [] }, 'Empty merchant_ids')
  console.log(`  merchant_ids=[]: ${withMerchant.items.length} items`)

  // 6. Check the date range of what we ARE getting
  console.log('\n6. Analyzing what we ARE getting...')
  if (pendingOnly.items.length > 0) {
    const dates = pendingOnly.items.map(t => t.charge_date).filter(Boolean).sort()
    const uniqueDates = [...new Set(dates)]
    console.log(`  Date range: ${uniqueDates[0]} to ${uniqueDates[uniqueDates.length - 1]}`)
    console.log(`  Dates: ${uniqueDates.join(', ')}`)

    // Count by date
    console.log('\n  Transactions per date:')
    for (const d of uniqueDates) {
      const count = pendingOnly.items.filter(t => t.charge_date === d).length
      console.log(`    ${d}: ${count}`)
    }

    // Check for any merchant/channel IDs in the data
    const merchantIds = new Set()
    const channelIds = new Set()
    for (const t of pendingOnly.items) {
      if (t.merchant_id) merchantIds.add(t.merchant_id)
      if (t.channel_id) channelIds.add(t.channel_id)
    }
    console.log(`\n  Merchant IDs in data: ${[...merchantIds].join(', ') || 'none'}`)
    console.log(`  Channel IDs in data: ${[...channelIds].join(', ') || 'none'}`)

    // Sample transaction to see all fields
    console.log('\n  Sample transaction (all fields):')
    console.log(JSON.stringify(pendingOnly.items[0], null, 2))
  }

  // 7. Compare to invoiced transactions count
  console.log('\n7. Comparing pending vs invoiced counts...')
  const invoicedOnly = await queryTransactions({ invoiced_status: true }, 'Invoiced only')
  console.log(`  Pending: ${pendingOnly.items.length}`)
  console.log(`  Invoiced: ${invoicedOnly.items.length}`)
  console.log(`  Total: ${pendingOnly.items.length + invoicedOnly.items.length}`)

  // 8. Check Dec 1 invoice transaction count via GET endpoint
  console.log('\n8. Checking Dec 1 invoice via GET endpoint...')
  const dec1Response = await fetch(
    `${BASE_URL}/2025-07/invoices/8633612/transactions?PageSize=1000`,
    { headers: { 'Authorization': `Bearer ${SHIPBOB_TOKEN}` } }
  )
  if (dec1Response.ok) {
    const dec1Data = await dec1Response.json()
    console.log(`  Dec 1 Shipping invoice: ${dec1Data.items?.length || 0} transactions`)
    if (dec1Data.next) console.log(`  Has more pages: yes`)
  }

  console.log('\n' + '═'.repeat(70))
  console.log('ANALYSIS')
  console.log('═'.repeat(70))
  console.log(`
Possible causes for missing transactions:
1. Token is a child token (only sees one merchant)
2. API has an undocumented global cap
3. Data retention is even shorter than 7 days for pending
4. Need to specify merchant_id or channel_id parameter
5. Different API version needed

Check the token type - is SHIPBOB_API_TOKEN the PARENT token?
`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
