#!/usr/bin/env node
/**
 * Test combining filters to get past the 250-per-filter cap
 * E.g., Charge+Shipment, Charge+Default, Charge+WRO separately
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function queryWithStats(params, label) {
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

    if (!response.ok) return { items: [], label, error: response.status }

    const data = await response.json()
    const items = data.items || []

    let newCount = 0
    for (const t of items) {
      if (!seenIds.has(t.transaction_id)) {
        seenIds.add(t.transaction_id)
        allItems.push(t)
        newCount++
      }
    }

    cursor = data.next || null
    if (pageNum >= 30 || (items.length > 0 && newCount === 0)) break
  } while (cursor)

  return { items: allItems, label }
}

async function main() {
  console.log('Testing combined filters to get ALL Charge transactions\n')
  console.log('═'.repeat(70))

  const masterSet = new Map()

  // Single Charge filter
  const chargeOnly = await queryWithStats({ transaction_types: ['Charge'] }, 'Charge only')
  console.log(`Charge only: ${chargeOnly.items.length}`)
  for (const t of chargeOnly.items) masterSet.set(t.transaction_id, t)

  console.log('\nCombined Charge + reference_type:')

  // Charge + each reference type
  const refTypes = ['Shipment', 'Default', 'WRO', 'FC Transfer', 'TicketNumber', 'Return', 'Storage']
  for (const ref of refTypes) {
    const result = await queryWithStats(
      { transaction_types: ['Charge'], reference_types: [ref] },
      `Charge + ${ref}`
    )
    console.log(`  Charge + ${ref}: ${result.items.length}`)
    for (const t of result.items) masterSet.set(t.transaction_id, t)
  }

  console.log('\nCombined Charge + invoice_type:')

  // Charge + each invoice type
  const invTypes = ['Shipping', 'AdditionalFee', 'WarehouseStorage', 'ReturnsFee', 'Credits', 'WarehouseInboundFee']
  for (const inv of invTypes) {
    const result = await queryWithStats(
      { transaction_types: ['Charge'], invoice_types: [inv] },
      `Charge + ${inv}`
    )
    console.log(`  Charge + ${inv}: ${result.items.length}`)
    for (const t of result.items) masterSet.set(t.transaction_id, t)
  }

  console.log('\nCombined Charge + invoiced_status:')

  const chargePending = await queryWithStats(
    { transaction_types: ['Charge'], invoiced_status: false },
    'Charge + pending'
  )
  console.log(`  Charge + pending: ${chargePending.items.length}`)
  for (const t of chargePending.items) masterSet.set(t.transaction_id, t)

  const chargeInvoiced = await queryWithStats(
    { transaction_types: ['Charge'], invoiced_status: true },
    'Charge + invoiced'
  )
  console.log(`  Charge + invoiced: ${chargeInvoiced.items.length}`)
  for (const t of chargeInvoiced.items) masterSet.set(t.transaction_id, t)

  // Summary
  console.log('\n' + '═'.repeat(70))
  console.log('SUMMARY')
  console.log('═'.repeat(70))

  // Filter to just Charges
  const charges = [...masterSet.values()].filter(t => t.transaction_type === 'Charge')
  console.log(`\nTotal unique CHARGE transactions from combined queries: ${charges.length}`)

  // Compare to expected
  console.log(`\nBreakdown by reference_type (within Charges):`)
  const byRef = {}
  for (const t of charges) {
    const ref = t.reference_type || 'unknown'
    byRef[ref] = (byRef[ref] || 0) + 1
  }
  for (const [k, v] of Object.entries(byRef).sort((a,b) => b[1] - a[1])) {
    console.log(`  ${k}: ${v}`)
  }

  console.log(`\nBreakdown by invoiced_status (within Charges):`)
  const pending = charges.filter(t => !t.invoiced_status).length
  const invoiced = charges.filter(t => t.invoiced_status).length
  console.log(`  pending: ${pending}`)
  console.log(`  invoiced: ${invoiced}`)

  // Did we get more?
  if (charges.length > 250) {
    console.log(`\n✅ SUCCESS! Got ${charges.length} Charges (vs 250 from single query)`)
    console.log(`   Improvement: +${charges.length - 250} transactions (${((charges.length - 250) / 250 * 100).toFixed(1)}% more)`)
  } else {
    console.log(`\n⚠️ Combined filters returned same as single query: ${charges.length}`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
