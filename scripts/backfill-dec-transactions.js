#!/usr/bin/env node
/**
 * Backfill missing transactions for Dec 5-7, 2025
 *
 * Our sync broke around Dec 5 and missed Dec 6-7 entirely.
 */

require('dotenv').config({ path: '.env.local' })

const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API_TOKEN = process.env.SHIPBOB_API_TOKEN
const BASE_URL = 'https://api.shipbob.com'

// Our client merchant IDs
const MERCHANT_IDS = {
  'Henson Shaving': '386350',
  'Methyl-Life': '392333'
}

async function fetchTransactions(startDate, endDate) {
  const allTransactions = []
  let cursor
  const seenIds = new Set()

  console.log(`Fetching transactions from ${startDate} to ${endDate}...`)

  do {
    const body = {
      start_date: startDate,
      end_date: endDate,
      page_size: 1000
    }
    if (cursor) body.cursor = cursor

    const url = `${BASE_URL}/2025-07/transactions:query`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${SHIPBOB_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body)
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`API error ${response.status}: ${text}`)
    }

    const data = await response.json()
    const items = Array.isArray(data) ? data : (data.items || [])

    let newCount = 0
    for (const tx of items) {
      if (!seenIds.has(tx.transaction_id)) {
        seenIds.add(tx.transaction_id)
        allTransactions.push(tx)
        newCount++
      }
    }

    console.log(`  Fetched ${items.length}, new: ${newCount} (total: ${allTransactions.length})`)

    if (newCount === 0) break
    cursor = Array.isArray(data) ? undefined : data.next
  } while (cursor)

  return allTransactions
}

async function main() {
  console.log('Backfilling transactions for Dec 5-7, 2025...\n')

  // Fetch transactions for Dec 5-7
  const transactions = await fetchTransactions('2025-12-05', '2025-12-07')
  console.log(`\nTotal fetched: ${transactions.length}`)

  // Get client mapping
  const { data: clients } = await supabase
    .from('clients')
    .select('id, merchant_id, company_name')

  const clientByMerchant = {}
  for (const c of clients || []) {
    if (c.merchant_id) clientByMerchant[c.merchant_id] = c
  }

  // Transform and filter to our clients
  const records = []
  const skipped = { noClient: 0, noRef: 0 }

  for (const tx of transactions) {
    // Extract merchant ID from reference or additional_details
    let merchantId = null

    // Try to get from the API response - ShipBob doesn't include merchant_id directly
    // We need to attribute based on reference_id patterns or look up shipments/orders

    // For now, we'll insert all and let the attribution happen via shipment/order lookup
    // The sync normally does this attribution

    const record = {
      transaction_id: tx.transaction_id,
      amount: tx.amount,
      currency_code: tx.currency_code,
      charge_date: tx.charge_date,
      invoiced_status: tx.invoiced_status,
      invoice_date: tx.invoice_date,
      invoice_id_sb: tx.invoice_id,
      invoice_type_sb: tx.invoice_type,
      invoiced_status_sb: tx.invoiced_status,
      invoice_date_sb: tx.invoice_date,
      transaction_fee: tx.transaction_fee,
      reference_id: tx.reference_id,
      reference_type: tx.reference_type,
      transaction_type: tx.transaction_type,
      fulfillment_center: tx.fulfillment_center,
      taxes: tx.taxes || [],
      additional_details: tx.additional_details || {},
    }

    records.push(record)
  }

  console.log(`\nPrepared ${records.length} records for upsert`)

  // Upsert in batches
  const BATCH_SIZE = 500
  let upserted = 0
  let errors = 0

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)

    const { data, error } = await supabase
      .from('transactions')
      .upsert(batch, { onConflict: 'transaction_id' })
      .select('id')

    if (error) {
      console.error(`  Error upserting batch ${Math.floor(i / BATCH_SIZE) + 1}:`, error)
      errors++
    } else {
      upserted += data?.length || 0
      console.log(`  Upserted batch ${Math.floor(i / BATCH_SIZE) + 1}: ${data?.length || 0}`)
    }
  }

  console.log('\n========================================')
  console.log('BACKFILL SUMMARY')
  console.log('========================================')
  console.log(`Fetched from API: ${transactions.length}`)
  console.log(`Upserted to DB: ${upserted}`)
  console.log(`Batch errors: ${errors}`)

  // Now verify counts by date
  const { data: counts } = await supabase
    .from('transactions')
    .select('charge_date')
    .gte('charge_date', '2025-12-05')
    .lte('charge_date', '2025-12-07')

  console.log(`\nDB count for Dec 5-7 after backfill: ${counts?.length || 0}`)
}

main().catch(console.error)
