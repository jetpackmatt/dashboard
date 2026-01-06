#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })

async function test() {
  const token = process.env.SHIPBOB_API_TOKEN

  // Test with specific transaction_ids from our DB
  const txIds = [
    '01KCN88ZRMSGBV8Y34D7YK18HB',
    '01KCHVH6F9PJGCKYSRQPF73BFT',
    '01KCHVJWRVC9PRR8YP3A9SAY5D'
  ]

  console.log('Querying by transaction_ids:', txIds)

  const resp = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      transaction_ids: txIds,
      page_size: 100
    })
  })

  const data = await resp.json()
  console.log('Response:', JSON.stringify(data, null, 2))

  // Now try by reference_id (shipment_id) - we know 328885442 is in explore-gst.js
  console.log('\n\nNow trying by reference_id 328885442...')

  const resp2 = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      reference_ids: ['328885442'],
      page_size: 100
    })
  })

  const data2 = await resp2.json()
  console.log('By reference_id response:')
  const txs = data2.transactions || []
  console.log(`Got ${txs.length} transactions`)
  for (const tx of txs) {
    console.log(`  ${tx.transaction_id}: ${tx.transaction_fee}, taxes=${JSON.stringify(tx.taxes)}`)
  }
}

test().catch(console.error)
