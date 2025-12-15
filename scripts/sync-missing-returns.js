/**
 * Sync missing returns from ShipBob API
 * Finds return IDs in transactions that aren't in the returns table
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function syncMissingReturns() {
  console.log('Finding missing returns...')

  // Get all clients with their tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id, client_api_credentials(api_token, provider)')
    .eq('is_active', true)

  const clientLookup = {}
  for (const c of clients || []) {
    const creds = c.client_api_credentials
    const token = creds?.find(cred => cred.provider === 'shipbob')?.api_token
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
    const returnId = Number(tx.reference_id)
    if (returnId > 0) returnsByClient[clientId].add(returnId)
  }

  // Process each client
  let totalSynced = 0
  for (const [clientId, returnIds] of Object.entries(returnsByClient)) {
    const client = clientLookup[clientId]
    const returnIdArray = Array.from(returnIds)

    // Get existing returns
    const { data: existing } = await supabase
      .from('returns')
      .select('shipbob_return_id')
      .eq('client_id', clientId)
      .in('shipbob_return_id', returnIdArray.slice(0, 1000))

    const existingIds = new Set(existing?.map(r => r.shipbob_return_id) || [])

    // Filter to only missing
    const toSync = returnIdArray.filter(id => !existingIds.has(id))

    if (toSync.length === 0) {
      console.log(`${client.name}: No missing returns`)
      continue
    }

    console.log(`${client.name}: syncing ${toSync.length} missing returns`)

    // Fetch and upsert each missing return
    const records = []
    for (const returnId of toSync) {
      try {
        const res = await fetch(`https://api.shipbob.com/1.0/return/${returnId}`, {
          headers: { Authorization: `Bearer ${client.token}` }
        })
        if (!res.ok) {
          console.log(`  Failed to fetch return ${returnId}: ${res.status}`)
          continue
        }
        const returnData = await res.json()
        records.push({
          client_id: clientId,
          merchant_id: client.merchantId,
          shipbob_return_id: returnData.id,
          reference_id: returnData.reference_id || null,
          status: returnData.status || null,
          return_type: returnData.return_type || null,
          tracking_number: returnData.tracking_number || null,
          shipment_tracking_number: returnData.tracking_number || null,
          original_shipment_id: returnData.original_shipment_id || null,
          store_order_id: returnData.store_order_id || null,
          invoice_amount: returnData.invoice_amount || null,
          invoice_currency: 'USD',
          fc_id: returnData.fulfillment_center?.id || null,
          fc_name: returnData.fulfillment_center?.name || null,
          channel_id: returnData.channel?.id || null,
          channel_name: returnData.channel?.name || null,
          insert_date: returnData.insert_date || null,
          awaiting_arrival_date: null,
          arrived_date: returnData.arrived_date || null,
          processing_date: returnData.processing_date || null,
          completed_date: returnData.completed_date || null,
          cancelled_date: returnData.cancelled_date || null,
          status_history: returnData.status_history || null,
          inventory: returnData.inventory || null,
          synced_at: new Date().toISOString(),
        })
        console.log(`  Fetched return ${returnId}: ${returnData.status}`)
      } catch (e) {
        console.log(`  Error fetching return ${returnId}: ${e.message}`)
      }

      // Small delay
      await new Promise(r => setTimeout(r, 100))
    }

    // Upsert all records
    if (records.length > 0) {
      const { error } = await supabase
        .from('returns')
        .upsert(records, { onConflict: 'shipbob_return_id' })

      if (error) {
        console.log(`  Upsert error: ${error.message}`)
      } else {
        console.log(`  Successfully synced ${records.length} returns`)
        totalSynced += records.length
      }
    }
  }

  console.log(`\nTotal synced: ${totalSynced}`)
}

syncMissingReturns().catch(console.error)
