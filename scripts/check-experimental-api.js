#!/usr/bin/env node
/**
 * Check experimental API for additional fields
 */

require('dotenv').config({ path: '.env.local' })

const SHIPBOB_TOKEN = process.env.SHIPBOB_API_TOKEN

async function main() {
  // Get transactions for shipment 314479977 via experimental API
  const response = await fetch('https://api.shipbob.com/experimental/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from_date: '2025-11-20T00:00:00Z',
      to_date: '2025-11-30T23:59:59Z',
      page_size: 1000
    })
  })

  const data = await response.json()
  const items = data.items || []

  // Find our shipment
  const forShipment = items.filter(t => t.referenceId === '314479977')

  console.log('Transactions for shipment 314479977 (experimental API):')
  console.log('Found:', forShipment.length)

  forShipment.forEach(tx => {
    console.log('\n' + tx.transactionFee + ': $' + tx.amount)
    console.log('Full transaction:')
    console.log(JSON.stringify(tx, null, 2))
  })

  // Check if additionalDetails has anything useful
  console.log('\n' + '═'.repeat(60))
  console.log('Checking additionalDetails across all Shipping transactions...')

  const shippingTx = items.filter(t => t.transactionFee === 'Shipping')
  const detailKeys = new Set()

  shippingTx.forEach(tx => {
    if (tx.additionalDetails) {
      Object.keys(tx.additionalDetails).forEach(k => detailKeys.add(k))
    }
  })

  console.log('All keys in additionalDetails:', [...detailKeys].join(', '))

  // Check if any have extra keys beyond TrackingId and Comment
  const standardKeys = ['TrackingId', 'Comment']
  const withExtraKeys = shippingTx.filter(tx =>
    tx.additionalDetails &&
    Object.keys(tx.additionalDetails).some(k => !standardKeys.includes(k))
  )

  console.log('Transactions with extra additionalDetails keys:', withExtraKeys.length)
  if (withExtraKeys.length > 0) {
    console.log('Sample:')
    console.log(JSON.stringify(withExtraKeys[0].additionalDetails, null, 2))
  }

  // Also compare experimental vs 2025-07 response for same transaction
  console.log('\n' + '═'.repeat(60))
  console.log('Comparing experimental vs 2025-07 API...')

  const response2 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from_date: '2025-11-24T00:00:00Z',
      to_date: '2025-11-24T23:59:59Z',
      page_size: 1
    })
  })

  const data2 = await response2.json()
  const tx2025 = data2.items?.[0]

  const response3 = await fetch('https://api.shipbob.com/experimental/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from_date: '2025-11-24T00:00:00Z',
      to_date: '2025-11-24T23:59:59Z',
      page_size: 1
    })
  })

  const data3 = await response3.json()
  const txExp = data3.items?.[0]

  console.log('\n2025-07 fields:', Object.keys(tx2025 || {}).join(', '))
  console.log('Experimental fields:', Object.keys(txExp || {}).join(', '))

  // Check for any NEW fields in experimental
  const fields2025 = new Set(Object.keys(tx2025 || {}).map(k => k.toLowerCase().replace(/_/g, '')))
  const fieldsExp = new Set(Object.keys(txExp || {}).map(k => k.toLowerCase()))

  const newInExp = [...fieldsExp].filter(k => !fields2025.has(k))
  console.log('\nNew fields in experimental:', newInExp.length > 0 ? newInExp.join(', ') : 'None')
}

main().catch(console.error)
