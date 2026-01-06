#!/usr/bin/env node
/**
 * Backfill taxes (GST/HST) for Eli Health transactions from ShipBob API
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API_TOKEN = process.env.SHIPBOB_API_TOKEN
const ELI_HEALTH_CLIENT_ID = 'e6220921-695e-41f9-9f49-af3e0cdc828a'

async function queryShipBobTransactions(referenceIds) {
  const resp = await fetch('https://api.shipbob.com/2025-07/transactions:query', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SHIPBOB_API_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      reference_ids: referenceIds,
      page_size: 1000
    })
  })

  const data = await resp.json()
  return data.transactions || []
}

async function backfill() {
  console.log('Backfilling taxes for Eli Health transactions...')

  // Get all Eli Health Shipment transactions
  let lastId = null
  let totalProcessed = 0
  let totalUpdated = 0
  const PAGE_SIZE = 500

  while (true) {
    let query = supabase
      .from('transactions')
      .select('id, transaction_id, reference_id')
      .eq('client_id', ELI_HEALTH_CLIENT_ID)
      .eq('reference_type', 'Shipment')
      .is('taxes', null)
      .order('id', { ascending: true })
      .limit(PAGE_SIZE)

    if (lastId) {
      query = query.gt('id', lastId)
    }

    const { data: transactions, error } = await query

    if (error) {
      console.error('Error fetching transactions:', error.message)
      break
    }

    if (!transactions || transactions.length === 0) {
      break
    }

    console.log(`Processing batch of ${transactions.length} transactions...`)

    // Get unique reference_ids
    const referenceIds = [...new Set(transactions.map(t => t.reference_id))]

    // Query ShipBob API for these transactions
    const apiTransactions = await queryShipBobTransactions(referenceIds)
    console.log(`  API returned ${apiTransactions.length} transactions`)

    // Build lookup: transaction_id -> taxes
    const taxLookup = new Map()
    for (const tx of apiTransactions) {
      if (tx.taxes && tx.taxes.length > 0) {
        taxLookup.set(tx.transaction_id, tx.taxes)
      }
    }

    console.log(`  Found ${taxLookup.size} transactions with taxes`)

    // Update transactions with taxes
    for (const tx of transactions) {
      const taxes = taxLookup.get(tx.transaction_id)
      if (taxes) {
        const { error: updateError } = await supabase
          .from('transactions')
          .update({ taxes })
          .eq('id', tx.id)

        if (!updateError) {
          totalUpdated++
        }
      }
      lastId = tx.id
    }

    totalProcessed += transactions.length
    console.log(`  Progress: ${totalProcessed} processed, ${totalUpdated} updated`)

    if (transactions.length < PAGE_SIZE) break

    // Rate limit
    await new Promise(r => setTimeout(r, 500))
  }

  console.log(`\nDone! Total: ${totalProcessed} processed, ${totalUpdated} updated with taxes`)
}

backfill().catch(console.error)
