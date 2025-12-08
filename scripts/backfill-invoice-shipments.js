/**
 * Backfill event_labeled for shipments in a specific invoice period
 *
 * Usage: node scripts/backfill-invoice-shipments.js
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// Invoice IDs for JPHS-0037 (Nov 24 - Nov 30 week)
const INVOICE_IDS = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]
const HENSON_CLIENT_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function main() {
  console.log('='.repeat(70))
  console.log('BACKFILL event_labeled FOR INVOICE SHIPMENTS')
  console.log('='.repeat(70))

  // Get Henson's token
  const { data: creds } = await supabase
    .from('client_api_credentials')
    .select('api_token')
    .eq('client_id', HENSON_CLIENT_ID)
    .eq('provider', 'shipbob')
    .single()

  const token = creds?.api_token
  if (!token) {
    console.log('No token found for Henson')
    return
  }

  // Get shipment IDs from transactions (with pagination to avoid 1000-row limit)
  console.log('\nFetching shipments from transactions...')
  const allShipmentIds = new Set()

  for (const invoiceId of INVOICE_IDS) {
    let page = 0
    const pageSize = 1000

    while (true) {
      const { data: transactions, error } = await supabase
        .from('transactions')
        .select('reference_id')
        .eq('client_id', HENSON_CLIENT_ID)
        .eq('invoice_id_sb', invoiceId)
        .eq('reference_type', 'Shipment')
        .eq('transaction_fee', 'Shipping')
        .range(page * pageSize, (page + 1) * pageSize - 1)

      if (error) {
        console.log(`Error fetching page ${page} for invoice ${invoiceId}:`, error.message)
        break
      }

      for (const tx of transactions || []) {
        if (tx.reference_id) allShipmentIds.add(tx.reference_id)
      }

      // If we got fewer than pageSize, we've reached the end
      if (!transactions || transactions.length < pageSize) break
      page++
    }
  }

  const shipmentIds = [...allShipmentIds]
  console.log(`Found ${shipmentIds.length} unique shipments`)

  // Check how many need backfilling
  const { data: needsBackfill } = await supabase
    .from('shipments')
    .select('shipment_id')
    .in('shipment_id', shipmentIds)
    .is('event_labeled', null)

  console.log(`${needsBackfill?.length || 0} need event_labeled backfill`)

  if (!needsBackfill || needsBackfill.length === 0) {
    console.log('\nAll shipments already have event_labeled!')
    return
  }

  // Backfill each shipment
  let updated = 0
  let errors = 0
  const startTime = Date.now()

  for (let i = 0; i < needsBackfill.length; i++) {
    const shipmentId = needsBackfill[i].shipment_id

    try {
      // Fetch timeline from ShipBob API
      const response = await fetch(`https://api.shipbob.com/2025-07/shipment/${shipmentId}/timeline`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (!response.ok) {
        if (response.status === 429) {
          console.log('\n  Rate limited - waiting 60s...')
          await new Promise(r => setTimeout(r, 60000))
          i-- // Retry this one
          continue
        }
        console.log(`\n  Error ${response.status} for ${shipmentId}`)
        errors++
        continue
      }

      const timeline = await response.json()

      // Find the Labeled event (log_type_id 604)
      const labeledEvent = timeline.find(e => e.log_type_id === 604)

      if (labeledEvent?.timestamp) {
        const { error } = await supabase
          .from('shipments')
          .update({ event_labeled: labeledEvent.timestamp })
          .eq('shipment_id', shipmentId)

        if (error) {
          console.log(`\n  DB error for ${shipmentId}: ${error.message}`)
          errors++
        } else {
          updated++
        }
      } else {
        console.log(`\n  No labeled event for ${shipmentId}`)
      }

      process.stdout.write(`\r  Progress: ${i + 1}/${needsBackfill.length} | Updated: ${updated} | Errors: ${errors}`)

      // Rate limit: 1 request per second
      await new Promise(r => setTimeout(r, 1000))
    } catch (err) {
      console.log(`\n  Error for ${shipmentId}: ${err.message}`)
      errors++
    }
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n\n${'='.repeat(70)}`)
  console.log('COMPLETE')
  console.log('='.repeat(70))
  console.log(`Duration: ${duration}s`)
  console.log(`Updated: ${updated}`)
  console.log(`Errors: ${errors}`)

  // Verify
  const { data: stillNull } = await supabase
    .from('shipments')
    .select('shipment_id')
    .in('shipment_id', shipmentIds)
    .is('event_labeled', null)

  console.log(`\nRemaining without event_labeled: ${stillNull?.length || 0}`)
}

main().catch(console.error)
