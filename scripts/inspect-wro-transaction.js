require('dotenv').config({ path: '.env.local' })

// Fetch one of the problematic WRO transactions from the API to see full response
async function main() {
  const token = process.env.SHIPBOB_API_TOKEN

  // These are the WRO IDs from our unattributed transactions
  const wroIds = ['871028', '870085', '871098', '875259', '873893', '874413', '875181']

  // First, let's fetch a single transaction and inspect all fields
  // Query transactions for a specific date range where we know these WROs exist
  console.log('Fetching transactions to inspect WRO data...\n')

  const url = 'https://api.shipbob.com/2025-07/transactions:query'
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from_date: '2025-12-01T00:00:00Z',
      to_date: '2025-12-10T00:00:00Z',
      page_size: 100
    })
  })

  if (!response.ok) {
    console.log('API Error:', response.status, response.statusText)
    return
  }

  const data = await response.json()
  console.log('Total transactions in response:', data.items?.length)

  // Find WRO transactions
  const wroTransactions = (data.items || []).filter(tx =>
    tx.reference_type === 'WRO' || wroIds.includes(tx.reference_id)
  )

  console.log('\nWRO Transactions found:', wroTransactions.length)

  if (wroTransactions.length > 0) {
    console.log('\n=== Full API Response for first WRO transaction ===')
    console.log(JSON.stringify(wroTransactions[0], null, 2))

    console.log('\n=== All keys in response ===')
    console.log(Object.keys(wroTransactions[0]).join(', '))

    // Check if there's a merchant_id or similar field
    const tx = wroTransactions[0]
    console.log('\n=== Potential merchant fields ===')
    for (const key of Object.keys(tx)) {
      if (key.toLowerCase().includes('merchant') ||
          key.toLowerCase().includes('client') ||
          key.toLowerCase().includes('channel') ||
          key.toLowerCase().includes('account')) {
        console.log(`${key}:`, tx[key])
      }
    }

    // Check additional_details
    if (tx.additional_details) {
      console.log('\n=== Additional Details ===')
      console.log(JSON.stringify(tx.additional_details, null, 2))
    }
  } else {
    console.log('No WRO transactions found in response')

    // Show a few transactions to understand structure
    console.log('\n=== Sample transaction (first in list) ===')
    if (data.items?.length > 0) {
      console.log(JSON.stringify(data.items[0], null, 2))
    }
  }
}

main().catch(console.error)
