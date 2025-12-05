#!/usr/bin/env node
/**
 * Search for surcharge-type fee transactions across all data
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

async function main() {
  const surchargeTypes = [
    'Delivery Area Surcharge',
    'Residential Surcharge',
    'Additional Billing Fees',
    'Shipping Charge Correction',
    'WMS - Fuel Surcharge',
    'Others',
    'Address Correction'
  ]

  console.log('Searching for surcharge fee types across all data...\n')

  for (const feeType of surchargeTypes) {
    const response = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        transaction_fees: [feeType],
        page_size: 100
      })
    })

    const data = await response.json()
    const items = data.items || []

    console.log(`${feeType}: ${items.length} transactions`)

    if (items.length > 0) {
      items.slice(0, 3).forEach(t => {
        console.log(`  $${t.amount.toFixed(2)} - shipment ${t.reference_id} (${t.charge_date})`)
      })

      // Show amount distribution
      const amounts = items.map(t => t.amount)
      const uniqueAmounts = [...new Set(amounts.map(a => a.toFixed(2)))].sort()
      console.log(`  Unique amounts: ${uniqueAmounts.slice(0, 10).join(', ')}${uniqueAmounts.length > 10 ? '...' : ''}`)
    }
    console.log('')
  }

  // Check what date range the API covers
  console.log('═'.repeat(60))
  console.log('DATE RANGE CHECK')
  console.log('═'.repeat(60))

  // Get oldest transactions
  const oldResponse = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from_date: '2024-01-01T00:00:00Z',
      to_date: '2024-12-31T23:59:59Z',
      page_size: 10
    })
  })

  const oldData = await oldResponse.json()
  console.log(`2024 transactions: ${oldData.items?.length || 0}`)

  // Get most recent
  const newResponse = await fetch(`${BASE_URL}/2025-07/transactions:query`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      page_size: 5
    })
  })

  const newData = await newResponse.json()
  console.log(`Most recent transaction date: ${newData.items?.[0]?.charge_date}`)
}

main().catch(console.error)
