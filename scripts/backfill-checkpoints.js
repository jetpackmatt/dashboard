/**
 * Backfill script: Store checkpoints from existing TrackingMore trackings
 *
 * This script:
 * 1. Gets all shipments from lost_in_transit_checks (these already have TrackingMore trackings)
 * 2. Fetches tracking data for each (FREE - existing trackings)
 * 3. Stores all checkpoints permanently in tracking_checkpoints
 *
 * Run with: node scripts/backfill-checkpoints.js
 */

require('dotenv').config({ path: '.env.local' })

const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

// Initialize Supabase
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

// TrackingMore API
const TRACKINGMORE_API_KEY = process.env.TRACKINGMORE_API_KEY
const TRACKINGMORE_BASE_URL = 'https://api.trackingmore.com/v4'

// Carrier code mapping (from client.ts)
const CARRIER_CODES = {
  'USPS': 'usps',
  'FedEx': 'fedex',
  'UPS': 'ups',
  'DHL': 'dhl',
  'DHLExpress': 'dhl',
  'OnTrac': 'ontrac',
  'Amazon': 'amazon',
  'Amazon Shipping': 'amazon',
  'Veho': 'veho',
  'BetterTrucks': 'bettertrucks',
  'CirroECommerce': 'cirro-ecommerce',
  'OSMWorldwide': 'osm-worldwide',
  'UniUni': 'uniuni',
  'LSO': 'lso',
  'Spee-Dee': 'spee-dee',
  'TForce': 'tforce-logistics',
  'AxleHire': 'axlehire',
  'ShipBob': 'shipbob',
}

function getCarrierCode(carrier) {
  if (!carrier) return null
  // Try exact match first
  if (CARRIER_CODES[carrier]) return CARRIER_CODES[carrier]
  // Try case-insensitive match
  const upperCarrier = carrier.toUpperCase()
  for (const [key, code] of Object.entries(CARRIER_CODES)) {
    if (key.toUpperCase() === upperCarrier) return code
  }
  // Try partial match
  for (const [key, code] of Object.entries(CARRIER_CODES)) {
    if (carrier.toLowerCase().includes(key.toLowerCase())) return code
  }
  return null
}

// Fetch tracking from TrackingMore
async function getTracking(trackingNumber, carrier) {
  const carrierCode = getCarrierCode(carrier)
  if (!carrierCode) {
    return { success: false, error: `Unknown carrier: ${carrier}` }
  }

  try {
    const response = await fetch(
      `${TRACKINGMORE_BASE_URL}/trackings/get?tracking_numbers=${trackingNumber}&courier_code=${carrierCode}`,
      {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Tracking-Api-Key': TRACKINGMORE_API_KEY,
        },
      }
    )

    const data = await response.json()

    if (data.meta?.code === 200 && data.data?.length > 0) {
      return { success: true, tracking: data.data[0] }
    }

    return { success: false, error: data.meta?.message || 'No tracking found' }
  } catch (error) {
    return { success: false, error: error.message }
  }
}

// Calculate content hash for deduplication
function calculateHash(carrier, checkpointDate, description, location) {
  const content = [
    carrier || '',
    checkpointDate || '',
    description || '',
    location || ''
  ].join('|')
  return crypto.createHash('sha256').update(content).digest('hex')
}

// Store checkpoints for a shipment
async function storeCheckpoints(shipmentId, tracking, carrier) {
  const checkpoints = []

  // Collect from origin_info
  if (tracking.origin_info?.trackinfo) {
    for (const cp of tracking.origin_info.trackinfo) {
      checkpoints.push({
        ...cp,
        info_type: 'origin'
      })
    }
  }

  // Collect from destination_info
  if (tracking.destination_info?.trackinfo) {
    for (const cp of tracking.destination_info.trackinfo) {
      checkpoints.push({
        ...cp,
        info_type: 'destination'
      })
    }
  }

  if (checkpoints.length === 0) {
    return { stored: 0, skipped: 0, total: 0 }
  }

  // Build records for upsert
  const records = checkpoints.map(cp => {
    const location = cp.location || [cp.city, cp.state, cp.country].filter(Boolean).join(', ') || null

    return {
      shipment_id: shipmentId,
      tracking_number: tracking.tracking_number,
      carrier: carrier,
      carrier_code: tracking.courier_code,
      checkpoint_date: cp.checkpoint_date,
      raw_description: cp.tracking_detail || cp.checkpoint_delivery_status || '',
      raw_location: location,
      raw_status: cp.checkpoint_delivery_status || null,
      raw_substatus: cp.checkpoint_delivery_substatus || null,
      content_hash: calculateHash(
        carrier,
        cp.checkpoint_date,
        cp.tracking_detail || '',
        location
      ),
      source: 'trackingmore',
      fetched_at: new Date().toISOString(),
    }
  })

  // Upsert with content_hash as unique key
  const { data, error } = await supabase
    .from('tracking_checkpoints')
    .upsert(records, {
      onConflict: 'content_hash',
      ignoreDuplicates: true,
    })
    .select('id')

  if (error) {
    console.error(`Error storing checkpoints for ${shipmentId}:`, error.message)
    return { stored: 0, skipped: checkpoints.length, total: checkpoints.length, error: error.message }
  }

  const stored = data?.length || 0
  return {
    stored,
    skipped: checkpoints.length - stored,
    total: checkpoints.length
  }
}

// Main backfill function
async function backfillCheckpoints() {
  console.log('Starting checkpoint backfill...\n')

  // Get all shipments from lost_in_transit_checks
  const { data: checks, error: fetchError } = await supabase
    .from('lost_in_transit_checks')
    .select('shipment_id, tracking_number, carrier')
    .not('tracking_number', 'is', null)
    .order('checked_at', { ascending: false })

  if (fetchError) {
    console.error('Error fetching checks:', fetchError)
    return
  }

  console.log(`Found ${checks.length} shipments to process\n`)

  let totalProcessed = 0
  let totalStored = 0
  let totalSkipped = 0
  let errors = 0

  const API_DELAY_MS = 300 // Be polite to the API

  for (const check of checks) {
    process.stdout.write(`Processing ${check.shipment_id} (${check.carrier})... `)

    try {
      const trackingResult = await getTracking(check.tracking_number, check.carrier)

      if (!trackingResult.success || !trackingResult.tracking) {
        console.log(`SKIP (${trackingResult.error || 'no tracking'})`)
        errors++
        await new Promise(r => setTimeout(r, API_DELAY_MS))
        continue
      }

      const result = await storeCheckpoints(
        check.shipment_id,
        trackingResult.tracking,
        check.carrier
      )

      totalProcessed++
      totalStored += result.stored
      totalSkipped += result.skipped

      console.log(`OK (${result.stored} stored, ${result.skipped} skipped of ${result.total})`)

    } catch (e) {
      console.log(`ERROR: ${e.message}`)
      errors++
    }

    await new Promise(r => setTimeout(r, API_DELAY_MS))
  }

  console.log('\n--- BACKFILL COMPLETE ---')
  console.log(`Processed: ${totalProcessed}`)
  console.log(`Total checkpoints stored: ${totalStored}`)
  console.log(`Duplicates skipped: ${totalSkipped}`)
  console.log(`Errors: ${errors}`)

  // Get final count
  const { count } = await supabase
    .from('tracking_checkpoints')
    .select('*', { count: 'exact', head: true })

  console.log(`\nTotal checkpoints in database: ${count}`)
}

// Run
backfillCheckpoints().catch(console.error)
