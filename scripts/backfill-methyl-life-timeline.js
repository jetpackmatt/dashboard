/**
 * Backfill timeline for Methyl-Life shipments in Dec 1 invoices
 *
 * Usage: node scripts/backfill-methyl-life-timeline.js
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const METHYL_LIFE_ID = 'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e'
const DEC1_INVOICE_IDS = [8633612, 8633618, 8633632, 8633634, 8633637, 8633641]
const DELAY_MS = 200  // 5 req/sec

const EVENT_MAP = {
  601: 'event_created',
  602: 'event_picked',
  603: 'event_packed',
  604: 'event_labeled',
  605: 'event_labelvalidated',
  607: 'event_intransit',
  608: 'event_outfordelivery',
  609: 'event_delivered',
  611: 'event_deliveryattemptfailed',
}

async function fetchTimeline(shipmentId, token) {
  const res = await fetch(`https://api.shipbob.com/2025-07/shipment/${shipmentId}/timeline`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  if (res.status === 429) return { rateLimited: true }
  if (res.status === 404) return { notFound: true }
  if (!res.ok) return null
  return res.json()
}

async function main() {
  console.log('='.repeat(60))
  console.log('BACKFILL: Methyl-Life Dec 1 Timeline Data')
  console.log('='.repeat(60))

  // Get Methyl-Life client with token
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .eq('id', METHYL_LIFE_ID)

  const client = clients?.[0]
  const token = client?.client_api_credentials?.find(c => c.provider === 'shipbob')?.api_token

  if (!token) {
    console.error('No Methyl-Life API token found')
    process.exit(1)
  }

  console.log('Client:', client.company_name)

  // Get ALL shipment IDs from Dec 1 invoice transactions
  console.log('Fetching Dec 1 invoice transactions...')
  const allIds = []
  let offset = 0
  while (true) {
    const { data: batch } = await supabase.from('transactions')
      .select('reference_id')
      .eq('client_id', METHYL_LIFE_ID)
      .eq('transaction_fee', 'Shipping')
      .eq('reference_type', 'Shipment')
      .in('invoice_id_sb', DEC1_INVOICE_IDS)
      .range(offset, offset + 999)

    if (!batch || batch.length === 0) break
    allIds.push(...batch.map(t => t.reference_id))
    offset += 1000
    if (batch.length < 1000) break
  }

  const uniqueIds = [...new Set(allIds)].filter(Boolean)
  console.log('Unique shipment IDs from transactions:', uniqueIds.length)

  // Find which ones are missing event_labeled
  console.log('Checking which need backfill (missing event_labeled)...')
  const needsBackfill = []
  for (let i = 0; i < uniqueIds.length; i += 1000) {
    const batch = uniqueIds.slice(i, i + 1000)
    const { data: ships } = await supabase.from('shipments')
      .select('id, shipment_id, event_labeled')
      .in('shipment_id', batch)

    for (const s of ships || []) {
      if (!s.event_labeled) {
        needsBackfill.push({ id: s.id, shipment_id: s.shipment_id })
      }
    }
  }

  console.log('Need backfill:', needsBackfill.length)

  if (needsBackfill.length === 0) {
    console.log('All Dec 1 Methyl-Life shipments already have event_labeled!')
    return
  }

  const startTime = Date.now()
  let processed = 0
  let updated = 0
  let notFound = 0
  let rateLimitWaits = 0

  for (const ship of needsBackfill) {
    const timeline = await fetchTimeline(ship.shipment_id, token)

    if (timeline?.rateLimited) {
      rateLimitWaits++
      const wait = Math.min(5000 * rateLimitWaits, 30000)
      console.log(`\nRate limited, waiting ${wait/1000}s...`)
      await new Promise(r => setTimeout(r, wait))
      continue  // Retry
    }

    if (timeline?.notFound) {
      // Shipment doesn't exist in API - mark as checked
      await supabase.from('shipments').update({ event_logs: {} }).eq('id', ship.id)
      notFound++
    } else if (timeline && timeline.length > 0) {
      const update = {}
      for (const event of timeline) {
        const col = EVENT_MAP[event.log_type_id]
        if (col && event.timestamp) {
          update[col] = event.timestamp
        }
      }
      if (Object.keys(update).length > 0) {
        await supabase.from('shipments').update(update).eq('id', ship.id)
        updated++
      }
    } else {
      // Empty timeline - mark as checked
      await supabase.from('shipments').update({ event_logs: {} }).eq('id', ship.id)
    }

    rateLimitWaits = Math.max(0, rateLimitWaits - 1)
    processed++

    const elapsed = (Date.now() - startTime) / 1000
    const rate = processed / elapsed
    const eta = (needsBackfill.length - processed) / rate

    process.stdout.write(`\r[${Math.round(processed/needsBackfill.length*100)}%] ${processed}/${needsBackfill.length} | ${rate.toFixed(1)}/sec | ETA: ${Math.round(eta)}s | updated: ${updated} | notFound: ${notFound}`)

    await new Promise(r => setTimeout(r, DELAY_MS))
  }

  const duration = Math.round((Date.now() - startTime) / 1000)
  console.log(`\n\n${'='.repeat(60)}`)
  console.log('COMPLETE')
  console.log('='.repeat(60))
  console.log('Duration:', duration, 'seconds')
  console.log('Processed:', processed)
  console.log('Updated with timeline:', updated)
  console.log('Not found in API:', notFound)
}

main().catch(console.error)
