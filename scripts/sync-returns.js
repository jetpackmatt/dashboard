/**
 * Sync returns from ShipBob API
 *
 * Strategy: Find return IDs from transactions table that are missing from returns table,
 * then fetch each from the API.
 *
 * Usage:
 *   node scripts/sync-returns.js           # Sync missing returns only
 *   node scripts/sync-returns.js --all     # Full resync all returns from transactions
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BATCH_SIZE = 50
const DELAY_MS = 100

async function fetchReturnFromApi(returnId, token) {
  const res = await fetch(`https://api.shipbob.com/1.0/return/${returnId}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (!res.ok) return null
  return res.json()
}

function mapReturnToDbRecord(returnData, clientId, merchantId) {
  return {
    client_id: clientId,
    merchant_id: merchantId,
    shipbob_return_id: returnData.id,
    reference_id: returnData.reference_id || null,
    status: returnData.status || null,
    return_type: returnData.return_type || null,
    tracking_number: returnData.tracking_number || null,
    shipment_tracking_number: returnData.tracking_number || null,
    original_shipment_id: returnData.original_shipment_id || null,
    store_order_id: returnData.store_order_id || null,
    customer_name: returnData.customer_name || null,
    invoice_amount: returnData.invoice_amount || null,
    invoice_currency: 'USD',
    fc_id: returnData.fulfillment_center?.id || null,
    fc_name: returnData.fulfillment_center?.name || null,
    channel_id: returnData.channel?.id || null,
    channel_name: returnData.channel?.name || null,
    insert_date: returnData.insert_date || null,
    awaiting_arrival_date: returnData.status === 'AwaitingArrival' ? returnData.insert_date : null,
    arrived_date: returnData.arrived_date || null,
    processing_date: returnData.processing_date || null,
    completed_date: returnData.completed_date || null,
    cancelled_date: returnData.cancelled_date || null,
    status_history: returnData.status_history || null,
    inventory: returnData.inventory || null,
    synced_at: new Date().toISOString(),
  }
}

async function main() {
  const fullResync = process.argv.includes('--all')

  console.log('='.repeat(70))
  console.log('RETURNS SYNC')
  console.log('='.repeat(70))
  console.log('Mode:', fullResync ? 'Full resync' : 'Missing only')

  // Get all clients with their tokens and merchant_ids
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id, client_api_credentials(api_token, provider)')
    .eq('is_active', true)

  const clientLookup = {}
  for (const c of clients || []) {
    const token = c.client_api_credentials?.find(cred => cred.provider === 'shipbob')?.api_token
    if (token) {
      clientLookup[c.id] = { token, merchantId: c.merchant_id, name: c.company_name }
    }
  }

  // Get return IDs from transactions
  const { data: returnTxs } = await supabase
    .from('transactions')
    .select('reference_id, client_id')
    .eq('reference_type', 'Return')

  // Group by client
  const returnsByClient = {}
  for (const tx of returnTxs || []) {
    const clientId = tx.client_id
    if (!clientId || !clientLookup[clientId]) continue
    if (!returnsByClient[clientId]) returnsByClient[clientId] = new Set()
    returnsByClient[clientId].add(Number(tx.reference_id))
  }

  console.log('Return IDs found in transactions:', returnTxs?.length || 0)

  let totalSynced = 0
  let totalSkipped = 0
  let totalErrors = 0

  for (const [clientId, returnIds] of Object.entries(returnsByClient)) {
    const client = clientLookup[clientId]
    const returnIdArray = Array.from(returnIds).filter(id => id > 0)

    console.log(`\n[${client.name}] ${returnIdArray.length} return IDs to check`)

    // Get existing returns if not full resync
    let existingIds = new Set()
    if (!fullResync) {
      const { data: existing } = await supabase
        .from('returns')
        .select('shipbob_return_id')
        .eq('client_id', clientId)
        .in('shipbob_return_id', returnIdArray)

      existingIds = new Set(existing?.map(r => r.shipbob_return_id) || [])
    }

    // Filter to only missing
    const toSync = fullResync
      ? returnIdArray
      : returnIdArray.filter(id => !existingIds.has(id))

    console.log(`  To sync: ${toSync.length} (existing: ${existingIds.size})`)

    // Fetch and upsert in batches
    for (let i = 0; i < toSync.length; i += BATCH_SIZE) {
      const batch = toSync.slice(i, i + BATCH_SIZE)
      const records = []

      for (const returnId of batch) {
        const returnData = await fetchReturnFromApi(returnId, client.token)
        if (returnData) {
          records.push(mapReturnToDbRecord(returnData, clientId, client.merchantId))
        } else {
          totalErrors++
        }
        await new Promise(r => setTimeout(r, DELAY_MS))
      }

      if (records.length > 0) {
        const { error } = await supabase
          .from('returns')
          .upsert(records, { onConflict: 'shipbob_return_id' })

        if (error) {
          console.error('  Upsert error:', error.message)
          totalErrors += records.length
        } else {
          totalSynced += records.length
          console.log(`  Synced batch: ${records.length} returns`)
        }
      }
    }

    totalSkipped += existingIds.size
  }

  console.log('\n' + '='.repeat(70))
  console.log('COMPLETE')
  console.log('='.repeat(70))
  console.log('Synced:', totalSynced)
  console.log('Skipped (existing):', totalSkipped)
  console.log('Errors:', totalErrors)
}

main().catch(console.error)
