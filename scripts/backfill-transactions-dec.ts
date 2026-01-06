#!/usr/bin/env npx tsx
/**
 * Backfill missing transactions for December 2025
 * Fetches from ShipBob API and upserts to database
 */

import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || '',
  process.env.SUPABASE_SERVICE_ROLE_KEY || ''
)

async function batchUpsert(records: any[], batchSize = 500) {
  let upserted = 0
  let errors: string[] = []

  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize)
    const { error } = await supabase
      .from('transactions')
      .upsert(batch, { onConflict: 'transaction_id' })

    if (error) {
      errors.push(`Batch ${Math.floor(i / batchSize) + 1}: ${error.message}`)
    } else {
      upserted += batch.length
    }
  }

  return { upserted, errors }
}

async function main() {
  const parentToken = process.env.SHIPBOB_API_TOKEN
  if (!parentToken) {
    console.error('SHIPBOB_API_TOKEN not set')
    process.exit(1)
  }

  console.log('='.repeat(60))
  console.log('Backfilling December 2025 Transactions')
  console.log('='.repeat(60))

  // Build lookup tables for client attribution
  console.log('\nBuilding lookup tables...')

  // Shipment -> client lookup
  const { data: shipments } = await supabase
    .from('shipments')
    .select('shipment_id, client_id')
  const shipmentLookup: Record<string, string> = {}
  for (const s of shipments || []) {
    shipmentLookup[s.shipment_id] = s.client_id
  }
  console.log(`  Shipments: ${Object.keys(shipmentLookup).length}`)

  // Return -> client lookup
  const { data: returns } = await supabase
    .from('returns')
    .select('shipbob_return_id, client_id')
  const returnLookup: Record<string, string> = {}
  for (const r of returns || []) {
    if (r.shipbob_return_id) {
      returnLookup[String(r.shipbob_return_id)] = r.client_id
    }
  }
  console.log(`  Returns: ${Object.keys(returnLookup).length}`)

  // WRO -> client lookup
  const { data: wros } = await supabase
    .from('receiving_orders')
    .select('shipbob_receiving_id, client_id, merchant_id')
  const wroLookup: Record<string, { client_id: string; merchant_id: string | null }> = {}
  for (const w of wros || []) {
    if (w.shipbob_receiving_id) {
      wroLookup[String(w.shipbob_receiving_id)] = {
        client_id: w.client_id,
        merchant_id: w.merchant_id,
      }
    }
  }
  console.log(`  WROs: ${Object.keys(wroLookup).length}`)

  // Inventory -> client lookup (for FC/storage)
  const { data: products } = await supabase
    .from('products')
    .select('variants, client_id')
  const inventoryLookup: Record<string, string> = {}
  for (const p of products || []) {
    if (p.variants && Array.isArray(p.variants)) {
      for (const v of p.variants) {
        if (v.inventory?.inventory_id) {
          inventoryLookup[String(v.inventory.inventory_id)] = p.client_id
        }
      }
    }
  }
  console.log(`  Inventory items: ${Object.keys(inventoryLookup).length}`)

  // Client info lookup
  const { data: clients } = await supabase
    .from('clients')
    .select('id, merchant_id')
  const clientInfoLookup: Record<string, { merchant_id: string | null }> = {}
  for (const c of clients || []) {
    clientInfoLookup[c.id] = { merchant_id: c.merchant_id }
  }

  // Fetch all transactions for December
  console.log('\nFetching from ShipBob API (Dec 1-16)...')
  const startDate = new Date('2025-12-01T00:00:00Z')
  const endDate = new Date('2025-12-16T00:00:00Z')

  const apiTx: any[] = []
  let cursor: string | null = null
  let page = 0

  do {
    page++
    let url = `${SHIPBOB_API_BASE}/transactions:query`
    if (cursor) url += `?Cursor=${encodeURIComponent(cursor)}`

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${parentToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from_date: startDate.toISOString(),
        to_date: endDate.toISOString(),
        page_size: 1000,
      }),
    })

    if (!response.ok) {
      if (response.status === 429) {
        console.log('  Rate limited, waiting 60s...')
        await new Promise(r => setTimeout(r, 60000))
        continue
      }
      throw new Error(`API error: ${response.status} ${response.statusText}`)
    }

    const data = await response.json()
    apiTx.push(...(data.items || []))
    cursor = data.next

    if (page % 5 === 0) {
      console.log(`  Page ${page}: ${apiTx.length} total`)
    }
  } while (cursor)

  console.log(`\nTotal from API: ${apiTx.length}`)

  // Transform to DB records
  console.log('\nTransforming records...')
  const now = new Date().toISOString()
  let attributed = 0
  let unattributed = 0

  const records = apiTx.map(tx => {
    let clientId: string | null = null

    // Attribution logic
    if (tx.reference_type === 'Shipment') {
      clientId = shipmentLookup[tx.reference_id] || null
    } else if (tx.reference_type === 'FC') {
      // Parse InventoryId from reference_id: {FC_ID}-{InventoryId}-{LocationType}
      const parts = tx.reference_id?.split('-') || []
      let invId: string | null = null
      if (parts.length >= 2) {
        invId = parts[1]
      }
      if (!invId && tx.additional_details?.InventoryId) {
        invId = String(tx.additional_details.InventoryId)
      }
      if (invId) {
        clientId = inventoryLookup[invId] || null
      }
    } else if (tx.reference_type === 'Return') {
      clientId = returnLookup[tx.reference_id] || null
    } else if (tx.reference_type === 'WRO' || tx.reference_type === 'URO') {
      const info = wroLookup[tx.reference_id]
      if (info) {
        clientId = info.client_id
      }
    }

    if (clientId) attributed++
    else unattributed++

    // Get merchant_id
    let merchantId: string | null = null
    if (clientId) {
      merchantId = clientInfoLookup[clientId]?.merchant_id || null
    }

    // Build base record WITHOUT client_id/merchant_id
    // IMPORTANT: Only include these if NOT null to prevent overwriting existing attribution
    const record: Record<string, unknown> = {
      transaction_id: tx.transaction_id,
      reference_id: tx.reference_id,
      reference_type: tx.reference_type,
      transaction_type: tx.transaction_type || null,
      fee_type: tx.transaction_fee,
      cost: tx.amount,
      charge_date: tx.charge_date,
      invoice_date_sb: tx.invoice_date || null,
      invoiced_status_sb: tx.invoiced_status || false,
      invoice_id_sb: tx.invoice_id || null,
      fulfillment_center: tx.fulfillment_center || null,
      additional_details: tx.additional_details || null,
      tracking_id: tx.additional_details?.TrackingId || null,
      updated_at: now,
    }

    // Only include client_id/merchant_id if attribution succeeded
    if (clientId) {
      record.client_id = clientId
      record.merchant_id = merchantId
    }

    return record
  })

  console.log(`  Attributed: ${attributed}`)
  console.log(`  Unattributed: ${unattributed}`)

  // Upsert
  console.log('\nUpserting to database...')
  const result = await batchUpsert(records)

  console.log(`\n${'='.repeat(60)}`)
  console.log(`COMPLETE:`)
  console.log(`  Fetched: ${apiTx.length}`)
  console.log(`  Upserted: ${result.upserted}`)
  console.log(`  Errors: ${result.errors.length}`)
  if (result.errors.length > 0) {
    console.log(`  Error samples: ${result.errors.slice(0, 3).join('; ')}`)
  }

  // Verify
  console.log('\n=== Verifying Invoice Totals ===')
  const invoiceTargets = [
    { id: 8693044, type: 'Shipping', expected: 32472.38 },
    { id: 8693054, type: 'ReturnsFee', expected: 69.03 },
    { id: 8693051, type: 'AdditionalFee', expected: 2722.08 },
    { id: 8693047, type: 'WarehouseInboundFee', expected: 220 },
  ]

  for (const inv of invoiceTargets) {
    const { data: txs } = await supabase
      .from('transactions')
      .select('cost')
      .eq('invoice_id_sb', inv.id)

    const actual = (txs || []).reduce((sum, t) => sum + t.cost, 0)
    const diff = inv.expected - actual
    const status = Math.abs(diff) < 0.01 ? '✅' : '⚠️'
    console.log(`  ${status} Invoice ${inv.id} (${inv.type}): $${actual.toFixed(2)} / $${inv.expected.toFixed(2)} (${txs?.length || 0} tx)`)
  }
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
