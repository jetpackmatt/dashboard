#!/usr/bin/env node
/**
 * Deep check all billing endpoints for hidden arrays/fields
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function main() {
  // Get all invoice types
  const inv = await fetch(`${BASE_URL}/2025-07/invoices?limit=50`, {
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    }
  })
  const invData = await inv.json()

  // Group by invoice_type
  const byType = {}
  for (const i of invData.items || []) {
    if (!byType[i.invoice_type]) byType[i.invoice_type] = []
    byType[i.invoice_type].push(i)
  }

  console.log('Invoice types found:')
  for (const [type, invoices] of Object.entries(byType)) {
    console.log(`  ${type}: ${invoices.length} invoices`)
  }

  // Check each invoice type for transactions
  console.log('\n' + '═'.repeat(70))
  console.log('Checking transactions for each invoice type...')
  console.log('═'.repeat(70))

  for (const [type, invoices] of Object.entries(byType)) {
    const inv = invoices[0]
    const txResp = await fetch(`${BASE_URL}/2025-07/invoices/${inv.invoice_id}/transactions?limit=10`, {
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      }
    })
    const txData = await txResp.json()
    const items = txData.items || []

    console.log(`\n${type} (invoice ${inv.invoice_id}):`)
    console.log(`  Transactions: ${items.length}`)

    if (items.length > 0) {
      // Show unique fee types in this invoice
      const feeTypes = [...new Set(items.map(t => t.transaction_fee))]
      console.log(`  Fee types: ${feeTypes.join(', ')}`)

      // Check if any have non-empty taxes array
      const withTaxes = items.filter(t => t.taxes?.length > 0)
      if (withTaxes.length > 0) {
        console.log(`  Transactions with taxes: ${withTaxes.length}`)
        console.log(`  Sample taxes: ${JSON.stringify(withTaxes[0].taxes)}`)
      }

      // Check additional_details keys
      const allDetailKeys = new Set()
      for (const t of items) {
        if (t.additional_details) {
          Object.keys(t.additional_details).forEach(k => allDetailKeys.add(k))
        }
      }
      console.log(`  additional_details keys: ${[...allDetailKeys].join(', ')}`)

      // Show first transaction in full
      console.log(`  First transaction:`)
      console.log(JSON.stringify(items[0], null, 4).split('\n').map(l => '    ' + l).join('\n'))
    }
  }

  // Check if there's a pattern we're missing - look at ALL transactions
  console.log('\n' + '═'.repeat(70))
  console.log('Scanning ALL transactions for any with non-standard fields...')
  console.log('═'.repeat(70))

  let allItems = []
  let cursor = null
  let page = 0

  do {
    page++
    let url = `${BASE_URL}/2025-07/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from_date: '2025-11-01T00:00:00Z',
        to_date: '2025-12-04T23:59:59Z',
        page_size: 1000
      })
    })

    const data = await resp.json()
    allItems.push(...(data.items || []))
    cursor = data.next

    if (page >= 20) break
  } while (cursor)

  console.log(`Total transactions scanned: ${allItems.length}`)

  // Check for any transactions with non-empty taxes
  const withTaxes = allItems.filter(t => t.taxes?.length > 0)
  console.log(`Transactions with taxes: ${withTaxes.length}`)
  if (withTaxes.length > 0) {
    console.log('Sample:', JSON.stringify(withTaxes[0], null, 2))
  }

  // Check for any transactions with unusual additional_details
  const standardKeys = ['TrackingId', 'Comment']
  const withExtraDetails = allItems.filter(t => {
    if (!t.additional_details) return false
    return Object.keys(t.additional_details).some(k => !standardKeys.includes(k))
  })
  console.log(`Transactions with extra additional_details: ${withExtraDetails.length}`)
  if (withExtraDetails.length > 0) {
    console.log('Sample:', JSON.stringify(withExtraDetails[0].additional_details, null, 2))
  }

  // Check all keys across all transactions
  const allKeys = new Set()
  for (const t of allItems) {
    Object.keys(t).forEach(k => allKeys.add(k))
  }
  console.log('\nAll fields found across transactions:', [...allKeys].join(', '))
}

main().catch(console.error)
