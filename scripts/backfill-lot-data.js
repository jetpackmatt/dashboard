#!/usr/bin/env node
/**
 * Backfill Lot Number and Expiration Date data from ShipBob Shipment API
 *
 * The Order API doesn't return lot/expiration data, but the Shipment API does.
 * This script fetches shipment details for completed shipments and updates
 * the shipment_items table with lot and expiration_date values.
 *
 * Usage:
 *   node scripts/backfill-lot-data.js [--dry-run] [--limit N] [--client CLIENT_NAME]
 *
 * Options:
 *   --dry-run   Show what would be updated without making changes
 *   --limit N   Process only N shipments (default: all)
 *   --client X  Only process shipments for client matching name (partial match)
 */

import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseKey)

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'
const RATE_LIMIT_DELAY_MS = 350 // ~170 requests/min to stay under 200/min limit
const BATCH_SIZE = 100

// Parse command line arguments
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const limitIdx = args.indexOf('--limit')
const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : null
const clientIdx = args.indexOf('--client')
const clientFilter = clientIdx !== -1 ? args[clientIdx + 1] : null

async function main() {
  console.log('='.repeat(60))
  console.log('Backfill Lot Number and Expiration Date Data')
  console.log('='.repeat(60))
  console.log(`Mode: ${dryRun ? 'DRY RUN' : 'LIVE'}`)
  if (limit) console.log(`Limit: ${limit} shipments`)
  if (clientFilter) console.log(`Client filter: ${clientFilter}`)
  console.log('')

  // Get all client credentials
  const { data: credentials, error: credError } = await supabase
    .from('client_api_credentials')
    .select('client_id, api_token')
    .eq('provider', 'shipbob')

  if (credError || !credentials) {
    console.error('Failed to fetch credentials:', credError?.message)
    return
  }

  // Get client names
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name')

  const clientNames = {}
  for (const c of clients || []) {
    clientNames[c.id] = c.company_name
  }

  // Build token map
  const tokenByClientId = {}
  for (const cred of credentials) {
    tokenByClientId[cred.client_id] = cred.api_token
  }

  // Find client_id if filter specified
  let filterClientId = null
  if (clientFilter) {
    const matchingClient = (clients || []).find(c =>
      c.company_name.toLowerCase().includes(clientFilter.toLowerCase())
    )
    if (matchingClient) {
      filterClientId = matchingClient.id
      console.log(`Found client: ${matchingClient.company_name} (${filterClientId})`)
    } else {
      console.error(`No client found matching "${clientFilter}"`)
      return
    }
  }

  // Find shipments that need lot data backfilled
  // Focus on completed shipments where shipment_items have null lot values
  // IMPORTANT: Use pagination because Supabase has a 1000 row limit
  const PAGE_SIZE = 1000
  let allShipments = []
  let offset = 0

  console.log('Fetching all completed shipments (with pagination)...')

  while (true) {
    let query = supabase
      .from('shipments')
      .select('shipment_id, client_id, status')
      .in('status', ['Completed', 'Delivered'])
      .not('client_id', 'is', null)
      .order('created_at', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    // Apply client filter in query if specified
    if (filterClientId) {
      query = query.eq('client_id', filterClientId)
    }

    const { data: batch, error: shipError } = await query

    if (shipError) {
      console.error('Failed to fetch shipments:', shipError.message)
      return
    }

    if (!batch || batch.length === 0) break

    allShipments.push(...batch)
    console.log(`  Fetched ${allShipments.length} shipments so far...`)

    // If we have a limit and reached it, stop
    if (limit && allShipments.length >= limit) {
      allShipments = allShipments.slice(0, limit)
      break
    }

    // If we got less than PAGE_SIZE, we've reached the end
    if (batch.length < PAGE_SIZE) break

    offset += PAGE_SIZE
  }

  console.log(`Found ${allShipments.length} completed shipments to check`)

  let shipmentsToProcess = allShipments

  // Filter to shipments that have items with null lot values
  // Need to paginate this check too for large datasets
  console.log('Checking which shipments have items needing lot data...')
  const shipmentIdsNeedingLot = new Set()
  const shipmentIds = shipmentsToProcess.map(s => s.shipment_id)

  // Check in batches of 500 (IN clause has practical limits)
  for (let i = 0; i < shipmentIds.length; i += 500) {
    const batchIds = shipmentIds.slice(i, i + 500)
    const { data: itemsNeedingLot } = await supabase
      .from('shipment_items')
      .select('shipment_id')
      .in('shipment_id', batchIds)
      .is('lot', null)

    for (const item of itemsNeedingLot || []) {
      shipmentIdsNeedingLot.add(item.shipment_id)
    }
  }

  shipmentsToProcess = shipmentsToProcess.filter(s => shipmentIdsNeedingLot.has(s.shipment_id))

  console.log(`${shipmentsToProcess.length} shipments have items needing lot data`)
  console.log('')

  if (shipmentsToProcess.length === 0) {
    console.log('No shipments need lot data backfill!')
    return
  }

  let processedCount = 0
  let updatedCount = 0
  let errorCount = 0
  let itemsUpdated = 0

  for (const shipment of shipmentsToProcess) {
    const token = tokenByClientId[shipment.client_id]
    if (!token) {
      console.log(`  Skipping ${shipment.shipment_id}: No token for client ${shipment.client_id}`)
      continue
    }

    processedCount++
    const clientName = clientNames[shipment.client_id] || 'Unknown'

    try {
      // Fetch full shipment details from Shipment API
      const res = await fetch(`${SHIPBOB_API_BASE}/shipment/${shipment.shipment_id}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!res.ok) {
        if (res.status === 404) {
          console.log(`  [${processedCount}/${shipmentsToProcess.length}] ${shipment.shipment_id} - Not found in API`)
        } else {
          console.log(`  [${processedCount}/${shipmentsToProcess.length}] ${shipment.shipment_id} - API error: ${res.status}`)
          errorCount++
        }
        await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS))
        continue
      }

      const shipData = await res.json()

      // Extract lot data from products.inventory_items
      const lotUpdates = []
      for (const product of shipData.products || []) {
        const inventoryItems = product.inventory_items || []
        for (const inv of inventoryItems) {
          if (inv.lot || inv.expiration_date) {
            lotUpdates.push({
              shipment_id: shipment.shipment_id,
              shipbob_product_id: product.id,
              sku: product.sku || product.reference_id,
              lot: inv.lot || null,
              expiration_date: inv.expiration_date || null,
              inventory_id: inv.id || null,
            })
          }
        }
      }

      if (lotUpdates.length > 0) {
        console.log(`  [${processedCount}/${shipmentsToProcess.length}] ${shipment.shipment_id} (${clientName}) - Found ${lotUpdates.length} items with lot data`)

        for (const update of lotUpdates) {
          console.log(`    - ${update.sku}: Lot=${update.lot || 'N/A'}, Exp=${update.expiration_date?.split('T')[0] || 'N/A'}`)

          if (!dryRun) {
            // Update shipment_items where shipment_id and product match
            const { error: updateError, count } = await supabase
              .from('shipment_items')
              .update({
                lot: update.lot,
                expiration_date: update.expiration_date
              })
              .eq('shipment_id', update.shipment_id)
              .eq('shipbob_product_id', update.shipbob_product_id)
              .select()

            if (updateError) {
              console.log(`      ERROR: ${updateError.message}`)
            } else {
              itemsUpdated++
            }
          }
        }
        updatedCount++
      } else {
        // No lot data available from API (product doesn't have lot tracking)
        if (processedCount % 50 === 0) {
          console.log(`  [${processedCount}/${shipmentsToProcess.length}] ${shipment.shipment_id} - No lot data in API`)
        }
      }

      // Rate limiting
      await new Promise(r => setTimeout(r, RATE_LIMIT_DELAY_MS))

    } catch (err) {
      console.log(`  [${processedCount}/${shipmentsToProcess.length}] ${shipment.shipment_id} - Error: ${err.message}`)
      errorCount++
    }
  }

  console.log('')
  console.log('='.repeat(60))
  console.log('Summary')
  console.log('='.repeat(60))
  console.log(`Shipments processed: ${processedCount}`)
  console.log(`Shipments with lot data: ${updatedCount}`)
  console.log(`Items updated: ${itemsUpdated}`)
  console.log(`Errors: ${errorCount}`)
  if (dryRun) {
    console.log('')
    console.log('(DRY RUN - no changes were made)')
  }
}

main().catch(console.error)
