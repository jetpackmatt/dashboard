#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })

async function explore() {
  const token = process.env.SHIPBOB_API_TOKEN

  // Query transactions by reference_ids for Brampton shipments
  const bramptonShipmentIds = [
    '328769550', '328795211', '328843654', '328846109', '328879083',
    '328879181', '328879229', '328885284', '328885305', '328885442'
  ]

  console.log('Querying transactions for Brampton shipments...')

  const resp = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      reference_ids: bramptonShipmentIds,
      page_size: 100
    })
  })

  const data = await resp.json()
  const transactions = data.transactions || data.items || []

  console.log('Total transactions returned:', transactions.length)

  // Check for taxes field
  const withTaxes = transactions.filter(t => t.taxes && t.taxes.length > 0)
  console.log('With taxes populated:', withTaxes.length)

  // Show first transaction in full detail
  if (transactions.length > 0) {
    console.log('\nFull transaction structure:')
    console.log(JSON.stringify(transactions[0], null, 2))

    // Check all keys on the transaction object
    console.log('\nAll keys on transaction:', Object.keys(transactions[0]))
  }

  // Check if taxes is even a field
  if (transactions.length > 0) {
    console.log('\nTaxes field value:', transactions[0].taxes)
    console.log('Has taxes key?', 'taxes' in transactions[0])
  }

  // Show a few more to see if any have taxes
  console.log('\nTaxes field on first 5 transactions:')
  for (const tx of transactions.slice(0, 5)) {
    console.log(`  ${tx.transaction_id}: taxes=${JSON.stringify(tx.taxes)}`)
  }
}

explore().catch(console.error)
