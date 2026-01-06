#!/usr/bin/env node
/**
 * Backfill taxes (GST/HST) for Eli Health Brampton transactions from ShipBob API
 * V2: Query by reference_id (shipment_id) in smaller batches
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API_TOKEN = process.env.SHIPBOB_API_TOKEN
const ELI_HEALTH_CLIENT_ID = 'e6220921-695e-41f9-9f49-af3e0cdc828a'

async function queryShipBobTransactionsByRefIds(referenceIds) {
  const resp = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      reference_ids: referenceIds,
      page_size: 250
    })
  })

  const data = await resp.json()
  // API returns 'items' for 2025-07 version
  return data.items || data.transactions || []
}

async function backfill() {
  console.log('Backfilling taxes for Eli Health Brampton transactions...')

  // Get all Eli Health Brampton transactions without taxes
  const { data: transactions, error } = await supabase
    .from('transactions')
    .select('id, transaction_id, reference_id, fulfillment_center')
    .eq('client_id', ELI_HEALTH_CLIENT_ID)
    .ilike('fulfillment_center', '%Brampton%')
    .is('taxes', null)
    .order('id', { ascending: true })

  if (error) {
    console.error('Error fetching transactions:', error.message)
    return
  }

  console.log(`Found ${transactions.length} Brampton transactions without taxes`)

  if (transactions.length === 0) {
    console.log('Nothing to backfill!')
    return
  }

  // Get unique reference_ids (shipment IDs)
  const uniqueRefIds = [...new Set(transactions.map(t => t.reference_id))]
  console.log(`Unique shipment IDs: ${uniqueRefIds.length}`)

  // Process in batches of 20 reference_ids (each can return multiple transactions)
  const BATCH_SIZE = 20
  let totalUpdated = 0

  // Build lookup from our DB: transaction_id -> db record
  const dbLookup = new Map()
  for (const tx of transactions) {
    dbLookup.set(tx.transaction_id, tx)
  }

  for (let i = 0; i < uniqueRefIds.length; i += BATCH_SIZE) {
    const batchRefIds = uniqueRefIds.slice(i, i + BATCH_SIZE)

    console.log(`\nBatch ${Math.floor(i / BATCH_SIZE) + 1}: Querying ${batchRefIds.length} reference_ids...`)

    const apiTransactions = await queryShipBobTransactionsByRefIds(batchRefIds)
    console.log(`  API returned ${apiTransactions.length} transactions`)

    // Update our DB transactions that have taxes
    let batchUpdated = 0
    for (const apiTx of apiTransactions) {
      if (apiTx.taxes && apiTx.taxes.length > 0) {
        const dbTx = dbLookup.get(apiTx.transaction_id)
        if (dbTx) {
          const { error: updateError } = await supabase
            .from('transactions')
            .update({ taxes: apiTx.taxes })
            .eq('id', dbTx.id)

          if (!updateError) {
            batchUpdated++
            totalUpdated++
          } else {
            console.error(`  Error updating ${apiTx.transaction_id}:`, updateError.message)
          }
        }
      }
    }

    console.log(`  Updated ${batchUpdated} in this batch, ${totalUpdated} total`)

    // Rate limit
    await new Promise(r => setTimeout(r, 300))
  }

  console.log(`\nDone! Total updated: ${totalUpdated}`)
}

backfill().catch(console.error)
