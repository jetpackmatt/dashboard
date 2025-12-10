#!/usr/bin/env node
/**
 * Backfill all historical Warehouse Receiving Orders (WROs)
 *
 * Fetches ALL WROs from the ShipBob API (not just recent ones)
 * and upserts them to the receiving_orders table with status_history.
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'

async function main() {
  console.log('=== WRO Backfill ===')

  // Get all clients with their tokens
  const { data: clients, error } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id, client_api_credentials(api_token, provider)')
    .eq('is_active', true)

  if (error || !clients) {
    console.error('Failed to fetch clients:', error)
    return
  }

  let totalFetched = 0
  let totalUpserted = 0

  for (const client of clients) {
    const creds = client.client_api_credentials?.find(c => c.provider === 'shipbob')
    if (!creds?.api_token) {
      console.log(`Skipping ${client.company_name}: no token`)
      continue
    }

    console.log(`\nProcessing ${client.company_name}...`)

    try {
      // Fetch ALL WROs (no date filter, just paginate through everything)
      let page = 1
      let allWros = []

      while (true) {
        const params = new URLSearchParams({
          Page: page.toString(),
          Limit: '100',
        })

        const res = await fetch(`${SHIPBOB_API_BASE}/receiving?${params}`, {
          headers: { Authorization: `Bearer ${creds.api_token}` },
        })

        if (!res.ok) {
          console.error(`  API error: ${res.status}`)
          break
        }

        const wros = await res.json()
        if (!wros || wros.length === 0) break

        allWros.push(...wros)
        console.log(`  Page ${page}: ${wros.length} WROs`)

        if (wros.length < 100) break // Last page
        page++

        // Rate limit protection
        await new Promise(r => setTimeout(r, 100))
      }

      if (allWros.length === 0) {
        console.log('  No WROs found')
        continue
      }

      totalFetched += allWros.length
      console.log(`  Total: ${allWros.length} WROs`)

      // Map to database records
      const now = new Date().toISOString()
      const records = allWros.map(wro => ({
        client_id: client.id,
        merchant_id: client.merchant_id || null,
        shipbob_receiving_id: wro.id,
        purchase_order_number: wro.purchase_order_number || null,
        status: wro.status || null,
        package_type: wro.package_type || null,
        box_packaging_type: wro.box_packaging_type || null,
        box_labels_uri: wro.box_labels_uri || null,
        expected_arrival_date: wro.expected_arrival_date || null,
        insert_date: wro.insert_date || null,
        last_updated_date: wro.last_updated_date || null,
        fc_id: wro.fulfillment_center?.id || null,
        fc_name: wro.fulfillment_center?.name || null,
        fc_timezone: wro.fulfillment_center?.timezone || null,
        fc_address: wro.fulfillment_center?.address?.address1 || null,
        fc_city: wro.fulfillment_center?.address?.city || null,
        fc_state: wro.fulfillment_center?.address?.state || null,
        fc_country: wro.fulfillment_center?.address?.country || null,
        fc_zip: wro.fulfillment_center?.address?.zip_code || null,
        status_history: wro.status_history || null,
        inventory_quantities: wro.inventory_quantities || null,
        synced_at: now,
      }))

      // Upsert in batches
      for (let i = 0; i < records.length; i += 100) {
        const batch = records.slice(i, i + 100)
        const { error: upsertError } = await supabase
          .from('receiving_orders')
          .upsert(batch, { onConflict: 'shipbob_receiving_id' })

        if (upsertError) {
          console.error(`  Upsert error:`, upsertError.message)
        } else {
          totalUpserted += batch.length
        }
      }

      console.log(`  Upserted ${records.length} records`)
    } catch (e) {
      console.error(`  Error:`, e.message)
    }
  }

  console.log('\n=== Results ===')
  console.log('Total fetched:', totalFetched)
  console.log('Total upserted:', totalUpserted)

  // Show final counts
  const { count } = await supabase
    .from('receiving_orders')
    .select('*', { count: 'exact', head: true })

  console.log('Total in database:', count)
}

main().catch(console.error)
