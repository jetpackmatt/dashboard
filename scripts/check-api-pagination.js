#!/usr/bin/env node
/**
 * Check API pagination for invoice transactions and query transactions directly
 */

require('dotenv').config({ path: '.env.local' })

async function main() {
  const token = process.env.SHIPBOB_API_TOKEN

  // First, let's see the raw response structure
  console.log('=== Checking invoice transactions API response ===\n')

  const url = 'https://api.shipbob.com/2025-07/invoices/8730385/transactions?PageSize=100'
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  })

  const data = await response.json()

  console.log('Response keys:', Object.keys(data))
  console.log('Has items?', Array.isArray(data.items))
  console.log('Items length:', data.items?.length || 'N/A')
  console.log('Has next?', !!data.next)
  console.log('Next cursor:', data.next?.substring(0, 100) + '...')
  console.log('Is array?', Array.isArray(data))
  if (Array.isArray(data)) console.log('Array length:', data.length)

  // Try direct transactions query with date range
  console.log('\n=== Querying transactions directly for Dec 15 ===\n')

  const txUrl = 'https://api.shipbob.com/2025-07/billing/transactions?StartDate=2025-12-15&EndDate=2025-12-15&PageSize=100'
  const txResponse = await fetch(txUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  })

  console.log('Status:', txResponse.status)
  if (txResponse.status === 200) {
    const txData = await txResponse.json()
    console.log('Response keys:', Object.keys(txData))
    const items = txData.items || txData
    console.log('Items count:', items.length)
    if (items.length > 0) {
      console.log('Sample tx:', JSON.stringify(items[0], null, 2).substring(0, 600))
    }
  } else {
    console.log('Error:', await txResponse.text())
  }

  // Check one of the missing shipment IDs via shipments API
  console.log('\n=== Checking shipment 328290041 ===\n')

  const shipUrl = 'https://api.shipbob.com/1.0/shipment/328290041'
  const shipResponse = await fetch(shipUrl, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    }
  })

  console.log('Status:', shipResponse.status)
  if (shipResponse.status === 200) {
    const shipData = await shipResponse.json()
    console.log('Shipment data:', JSON.stringify(shipData, null, 2).substring(0, 800))
  } else {
    console.log('Error:', await shipResponse.text())
  }

  // Count ALL transactions in the invoice via pagination
  console.log('\n=== Counting ALL transactions in invoice 8730385 ===\n')

  let allTx = []
  let cursor = null
  let page = 0

  do {
    page++
    let pageUrl = 'https://api.shipbob.com/2025-07/invoices/8730385/transactions?PageSize=1000'
    if (cursor) pageUrl += `&Cursor=${encodeURIComponent(cursor)}`

    const pageResponse = await fetch(pageUrl, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    })

    const pageData = await pageResponse.json()
    const items = pageData.items || []
    allTx.push(...items)

    cursor = pageData.next || null
    console.log(`  Page ${page}: ${items.length} items, has next: ${!!cursor}`)

    if (page > 10) {
      console.log('  Breaking after 10 pages to avoid infinite loop')
      break
    }
  } while (cursor)

  console.log('\nTotal fetched:', allTx.length)

  // Check the fee_type distribution
  const feeTypes = {}
  for (const tx of allTx) {
    feeTypes[tx.transaction_fee] = (feeTypes[tx.transaction_fee] || 0) + 1
  }
  console.log('By fee type:', feeTypes)
}

main().catch(console.error)
