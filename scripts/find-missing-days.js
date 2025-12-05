#!/usr/bin/env node
/**
 * Find where Dec 2-3 transactions are hiding
 * POST endpoint only returns Dec 4 (today)
 * Invoiced should cover up to Dec 1
 * Where are Dec 2-3?
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function getAllFromPost(params) {
  const allItems = []
  const seenIds = new Set()
  let cursor = null
  let pageNum = 0

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

    if (!response.ok) return []

    const data = await response.json()
    for (const t of (data.items || [])) {
      if (!seenIds.has(t.transaction_id)) {
        seenIds.add(t.transaction_id)
        allItems.push(t)
      }
    }

    cursor = data.next || null
    if (pageNum >= 50) break
    if ((data.items || []).every(t => seenIds.has(t.transaction_id))) break
  } while (cursor)

  return allItems
}

async function getAllFromInvoice(invoiceId) {
  const allItems = []
  let cursor = null
  let pageNum = 0

  do {
    pageNum++
    let endpoint = `${BASE_URL}/2025-07/invoices/${invoiceId}/transactions?PageSize=1000`
    if (cursor) endpoint += `&Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(endpoint, {
      headers: { 'Authorization': `Bearer ${SHIPBOB_TOKEN}` }
    })

    if (!response.ok) return []

    const data = await response.json()
    allItems.push(...(data.items || []))
    cursor = data.next || null
    if (pageNum >= 20) break
  } while (cursor)

  return allItems
}

async function main() {
  console.log('Finding missing days (Dec 2-3)\n')
  console.log('═'.repeat(70))

  // 1. Get ALL pending via comprehensive filters
  console.log('\n1. All PENDING via POST (comprehensive filters)...')
  const pendingAll = new Map()

  const txTypes = ['Charge', 'Credit', 'Payment']
  const refTypes = ['Shipment', 'Default', 'WRO', 'Return']

  for (const tx of txTypes) {
    const items = await getAllFromPost({ transaction_types: [tx], invoiced_status: false })
    for (const t of items) pendingAll.set(t.transaction_id, t)
  }
  for (const ref of refTypes) {
    const items = await getAllFromPost({ reference_types: [ref], invoiced_status: false })
    for (const t of items) pendingAll.set(t.transaction_id, t)
  }

  const pendingList = [...pendingAll.values()]
  const pendingDates = {}
  for (const t of pendingList) {
    const d = t.charge_date || 'null'
    pendingDates[d] = (pendingDates[d] || 0) + 1
  }

  console.log(`  Total unique pending: ${pendingList.length}`)
  console.log(`  By date:`)
  for (const [d, c] of Object.entries(pendingDates).sort()) {
    console.log(`    ${d}: ${c}`)
  }

  // 2. Get ALL invoiced via POST
  console.log('\n2. All INVOICED via POST (comprehensive filters)...')
  const invoicedAll = new Map()

  for (const tx of txTypes) {
    const items = await getAllFromPost({ transaction_types: [tx], invoiced_status: true })
    for (const t of items) invoicedAll.set(t.transaction_id, t)
  }
  for (const ref of refTypes) {
    const items = await getAllFromPost({ reference_types: [ref], invoiced_status: true })
    for (const t of items) invoicedAll.set(t.transaction_id, t)
  }

  const invoicedList = [...invoicedAll.values()]
  const invoicedDates = {}
  for (const t of invoicedList) {
    const d = t.charge_date || 'null'
    invoicedDates[d] = (invoicedDates[d] || 0) + 1
  }

  console.log(`  Total unique invoiced: ${invoicedList.length}`)
  console.log(`  By date:`)
  for (const [d, c] of Object.entries(invoicedDates).sort()) {
    console.log(`    ${d}: ${c}`)
  }

  // 3. Get transactions from specific Dec 1 invoices
  console.log('\n3. Transactions from Dec 1 invoices via GET endpoint...')

  const dec1Invoices = [
    { id: 8633612, type: 'Shipping' },
    { id: 8633634, type: 'AdditionalFee' },
    { id: 8633618, type: 'WarehouseStorage' },
  ]

  for (const inv of dec1Invoices) {
    const items = await getAllFromInvoice(inv.id)
    const dates = {}
    for (const t of items) {
      const d = t.charge_date || 'null'
      dates[d] = (dates[d] || 0) + 1
    }
    console.log(`  Invoice ${inv.id} (${inv.type}): ${items.length} transactions`)
    for (const [d, c] of Object.entries(dates).sort()) {
      console.log(`    ${d}: ${c}`)
    }
  }

  // 4. Check if Dec 2-3 are in some intermediate state
  console.log('\n4. Summary')
  console.log('═'.repeat(70))

  const allDates = new Set([...Object.keys(pendingDates), ...Object.keys(invoicedDates)])
  console.log('\nDates found across all queries:')
  console.log(`  ${[...allDates].sort().join(', ')}`)

  console.log('\nExpected dates (invoice period Mon-Sun):')
  console.log('  Nov 25-Dec 1 (last week) → should be invoiced')
  console.log('  Dec 2-4 (this week so far) → should be pending')

  console.log('\nMissing dates:')
  const expected = ['2025-12-02', '2025-12-03']
  for (const d of expected) {
    if (!allDates.has(d)) {
      console.log(`  ⚠️ ${d} - NOT FOUND anywhere!`)
    } else {
      const pend = pendingDates[d] || 0
      const inv = invoicedDates[d] || 0
      console.log(`  ✅ ${d} - pending: ${pend}, invoiced: ${inv}`)
    }
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
