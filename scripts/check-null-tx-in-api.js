#!/usr/bin/env node
/**
 * Check if the 220 NULL invoice transactions exist in ShipBob's invoice API
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function fetchAllInvoiceTransactions(invoiceId) {
  const token = process.env.SHIPBOB_API_TOKEN
  const allTx = []
  let cursor = null

  do {
    let url = `https://api.shipbob.com/2025-07/invoices/${invoiceId}/transactions?PageSize=1000`
    if (cursor) url += `&Cursor=${cursor}`

    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    })

    if (response.status !== 200) {
      console.log('API error:', response.status)
      break
    }

    const data = await response.json()
    const items = Array.isArray(data) ? data : (data.items || [])
    if (items.length > 0) {
      allTx.push(...items)
    }

    cursor = data.next || null
    console.log(`  Fetched ${items.length} transactions (total: ${allTx.length})`)
  } while (cursor)

  return allTx
}

async function main() {
  const hensonId = '6b94c274-0446-4167-9d02-b998f8be59ad'

  // Get the 220 NULL invoice transaction IDs
  console.log('=== Getting NULL invoice transactions from DB ===\n')

  const { data: nullTx } = await supabase
    .from('transactions')
    .select('transaction_id, reference_id')
    .eq('client_id', hensonId)
    .eq('fee_type', 'Shipping')
    .eq('reference_type', 'Shipment')
    .is('invoice_id_sb', null)
    .gte('charge_date', '2025-12-15')
    .lte('charge_date', '2025-12-21T23:59:59Z')
    .is('dispute_status', null)

  console.log('NULL invoice transaction count:', nullTx?.length)
  const nullTxIds = new Set((nullTx || []).map(t => t.transaction_id))
  const nullRefIds = new Set((nullTx || []).map(t => t.reference_id))

  // Fetch all transactions from ShipBob API for invoice 8730385
  console.log('\n=== Fetching ALL transactions from ShipBob API for invoice 8730385 ===\n')
  const apiTx = await fetchAllInvoiceTransactions(8730385)
  console.log('\nTotal API transactions:', apiTx.length)

  // Check how many of our NULL tx are in the API response
  const apiTxIds = new Set(apiTx.map(t => t.transaction_id))
  const apiRefIds = new Set(apiTx.map(t => t.reference_id))

  let foundByTxId = 0
  let foundByRefId = 0
  const notFoundTxIds = []
  const notFoundRefIds = []

  for (const txId of nullTxIds) {
    if (apiTxIds.has(txId)) {
      foundByTxId++
    } else {
      notFoundTxIds.push(txId)
    }
  }

  for (const refId of nullRefIds) {
    if (apiRefIds.has(refId)) {
      foundByRefId++
    } else {
      notFoundRefIds.push(refId)
    }
  }

  console.log('\n=== COMPARISON ===')
  console.log('NULL tx found in API by transaction_id:', foundByTxId, 'of', nullTxIds.size)
  console.log('NULL tx found in API by reference_id (shipment_id):', foundByRefId, 'of', nullRefIds.size)
  console.log('NOT found by transaction_id:', notFoundTxIds.length)
  console.log('NOT found by reference_id:', notFoundRefIds.length)

  if (notFoundTxIds.length > 0) {
    console.log('\nSample NOT FOUND transaction IDs:')
    for (const id of notFoundTxIds.slice(0, 10)) {
      console.log('  ', id)
    }
  }

  // Check: if they're in the API, why aren't they linked?
  if (foundByTxId > 0) {
    console.log('\n>>> ISSUE: Transactions ARE in API but NOT linked in DB!')
    console.log('>>> This means sync-invoices is not working correctly for these.')

    // Get a sample that WAS found
    const foundTx = [...nullTxIds].filter(id => apiTxIds.has(id))
    console.log('\nSample tx that ARE in API but NULL in DB:')
    for (const txId of foundTx.slice(0, 5)) {
      const apiData = apiTx.find(t => t.transaction_id === txId)
      console.log('  ', txId, 'ref:', apiData?.reference_id, 'invoice_id:', apiData?.invoice_id)
    }
  } else {
    console.log('\n>>> CONCLUSION: These transactions are NOT in ShipBob invoice API!')
    console.log('>>> They may need to be linked via a different method.')

    // Check if these shipments exist in the API by querying shipments directly
    console.log('\n=== Checking if shipments exist but have different transactions ===')

    // Sample 5 missing shipment IDs and check if they have ANY transaction in the API
    const sampleMissing = notFoundRefIds.slice(0, 10)
    console.log('Checking shipment IDs:', sampleMissing)

    for (const refId of sampleMissing) {
      const found = apiTx.filter(t => t.reference_id === refId)
      if (found.length > 0) {
        console.log('  ', refId, 'has', found.length, 'tx in API:', found.map(t => t.transaction_id))
      } else {
        console.log('  ', refId, '- NOT in API at all')
      }
    }
  }

  // Final check: what invoice_id do these transactions have in ShipBob?
  // Query the transactions API directly with our transaction IDs
  console.log('\n=== Checking transaction invoice_id via direct API query ===')

  const token = process.env.SHIPBOB_API_TOKEN
  const sampleNullTx = (nullTx || []).slice(0, 5)

  for (const tx of sampleNullTx) {
    // Query by transaction ID
    const url = `https://api.shipbob.com/2025-07/billing/transactions?TransactionIds=${tx.transaction_id}`
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    })

    if (response.status === 200) {
      const data = await response.json()
      const items = data.items || data
      if (items.length > 0) {
        console.log('  ', tx.transaction_id, '→ invoice_id:', items[0].invoice_id, 'type:', items[0].invoice_type)
      } else {
        console.log('  ', tx.transaction_id, '→ NOT FOUND in API')
      }
    } else {
      console.log('  ', tx.transaction_id, '→ API error:', response.status)
    }
  }
}

main().catch(console.error)
