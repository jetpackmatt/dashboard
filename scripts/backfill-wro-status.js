/**
 * Backfill WRO statuses from ShipBob API
 *
 * The sync was using InsertStartDate which only caught new WROs.
 * This script updates all existing WROs with their current status from the API.
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API = 'https://api.shipbob.com/2025-07'

async function backfillWroStatuses() {
  console.log('=== WRO Status Backfill ===\n')

  // Get all clients with tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .eq('is_active', true)

  let totalUpdated = 0

  for (const client of clients || []) {
    const token = client.client_api_credentials?.find(c => c.provider === 'shipbob')?.api_token
    if (!token) continue

    // Get this client's WROs from our database
    const { data: wros } = await supabase
      .from('receiving_orders')
      .select('shipbob_receiving_id, status')
      .eq('client_id', client.id)

    if (!wros || wros.length === 0) continue

    console.log(`${client.company_name}: checking ${wros.length} WROs...`)

    // Fetch current status from API for each WRO
    const updates = []
    for (const wro of wros) {
      try {
        const res = await fetch(`${SHIPBOB_API}/receiving/${wro.shipbob_receiving_id}`, {
          headers: { Authorization: `Bearer ${token}` }
        })

        if (res.ok) {
          const apiData = await res.json()
          if (apiData.status !== wro.status) {
            updates.push({
              shipbob_receiving_id: wro.shipbob_receiving_id,
              status: apiData.status,
              last_updated_date: apiData.last_updated_date,
              synced_at: new Date().toISOString(),
              oldStatus: wro.status
            })
          }
        }

        // Small delay to avoid rate limits
        await new Promise(r => setTimeout(r, 100))
      } catch (e) {
        console.log(`  Error fetching WRO ${wro.shipbob_receiving_id}`)
      }
    }

    if (updates.length > 0) {
      console.log(`  Updating ${updates.length} WROs with new statuses`)
      for (const update of updates) {
        console.log(`    ${update.shipbob_receiving_id}: ${update.oldStatus} -> ${update.status}`)

        const { error } = await supabase
          .from('receiving_orders')
          .update({
            status: update.status,
            last_updated_date: update.last_updated_date,
            synced_at: update.synced_at
          })
          .eq('shipbob_receiving_id', update.shipbob_receiving_id)

        if (error) console.log(`    ERROR: ${error.message}`)
        else totalUpdated++
      }
    } else {
      console.log('  All statuses up to date')
    }
  }

  console.log('\n=== Backfill Complete ===')
  console.log('Total WROs updated:', totalUpdated)
}

backfillWroStatuses().catch(console.error)
