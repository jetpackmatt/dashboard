#!/usr/bin/env node
/**
 * Backfill TrackingMore data for monitored shipments missing tracking data.
 *
 * Registers trackings with TrackingMore (if not already registered) and fetches
 * checkpoint data. Updates lost_in_transit_checks with last_scan info and stores
 * checkpoints in tracking_checkpoints table.
 *
 * Usage: node scripts/backfill-tracking-data.js [--limit N] [--dry-run]
 */

const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')
require('dotenv').config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const TRACKINGMORE_API_KEY = process.env.TRACKINGMORE_API_KEY
const API_BASE = 'https://api.trackingmore.com/v4'

// Carrier code mapping (must match lib/trackingmore/client.ts)
function getCarrierCode(carrier) {
  const c = (carrier || '').toLowerCase()
  if (c.includes('usps')) return 'usps'
  // UPS Mail Innovations must be before generic UPS
  if (c.includes('upsmi') || c.includes('mailinnovation') || c.includes('mail innovations')) return 'ups-mi'
  if (c.includes('ups')) return 'ups'
  if (c.includes('fedex')) return 'fedex'
  if (c.includes('dhl')) {
    if (c.includes('ecs') || c.includes('ecommerce')) return 'dhlglobalmail'
    if (c.includes('express')) return 'dhl'
    return 'dhl'
  }
  if (c.includes('ontrac')) return 'ontrac'
  if (c.includes('amazon')) return 'amazon-us'
  if (c.includes('veho')) return 'veho'
  if (c.includes('lasership')) return 'lasership'
  if (c.includes('spee-dee') || c.includes('speedee')) return 'speedee'
  if (c.includes('cirro') || c.includes('gofo')) return 'gofoexpress'
  if (c.includes('bettertrucks') || c.includes('better trucks')) return 'bettertrucks'
  if (c.includes('osm')) return 'osmworldwide'
  if (c.includes('uniuni')) return 'uni'
  if (c.includes('passport')) return 'passport-shipping'
  if (c.includes('apc')) return 'apc'
  if (c.includes('smartpost')) return 'fedex'
  return null
}

// Calculate checkpoint content hash (must match checkpoint-storage.ts)
function calculateCheckpointHash(carrier, checkpointDate, description, location) {
  const dateOnly = checkpointDate.split('T')[0]
  const normalizedDesc = description.trim().toLowerCase().replace(/\s+/g, ' ')
  const normalizedLocation = (location || '').trim().toLowerCase()
  const content = [carrier.toLowerCase().trim(), dateOnly, normalizedDesc, normalizedLocation].join('|')
  return crypto.createHash('sha256').update(content).digest('hex')
}

async function apiCall(method, path, body) {
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Tracking-Api-Key': TRACKINGMORE_API_KEY,
    },
  }
  if (body) opts.body = JSON.stringify(body)

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30000)
  opts.signal = controller.signal

  try {
    const res = await fetch(`${API_BASE}${path}`, opts)
    const data = await res.json()
    return data
  } finally {
    clearTimeout(timeout)
  }
}

// RTS patterns
const RTS_PATTERNS = [
  /returned to sender/i, /returned to shipper/i, /returned to seller/i,
  /return to sender/i, /return in progress/i, /return initiated/i,
  /returninitiated/i, /to original sender/i, /being returned/i,
  /was returned/i, /return to shipper/i,
]

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const limitIdx = args.indexOf('--limit')
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 200

  console.log(`[Backfill] Starting... limit=${limit} dryRun=${dryRun}`)

  // Get monitored shipments with no tracking data
  const { data: entries, error } = await supabase
    .from('lost_in_transit_checks')
    .select('id, shipment_id, tracking_number, carrier, claim_eligibility_status, is_international')
    .is('last_scan_date', null)
    .not('tracking_number', 'is', null)
    .limit(limit)

  if (error) { console.error('Failed to fetch entries:', error); process.exit(1) }
  console.log(`[Backfill] Found ${entries.length} entries without tracking data`)

  const results = { registered: 0, fetched: 0, delivered: 0, rts: 0, updated: 0, failed: 0, skipped: 0 }

  for (const entry of entries) {
    const carrierCode = getCarrierCode(entry.carrier)
    if (!carrierCode) {
      console.log(`  SKIP ${entry.tracking_number} - unknown carrier: ${entry.carrier}`)
      results.skipped++
      continue
    }

    console.log(`  Processing ${entry.tracking_number} (${entry.carrier} → ${carrierCode})...`)

    try {
      // Step 1: Try GET first (free, tracking may already exist)
      let trackingData = null
      const getRes = await apiCall('GET', `/trackings/get?tracking_numbers=${entry.tracking_number}&courier_code=${carrierCode}`)

      if (getRes?.meta?.code === 200 && getRes?.data?.length > 0) {
        trackingData = getRes.data[0]
        console.log(`    GET: found existing tracking, status=${trackingData.delivery_status}`)
      } else {
        // Step 2: Create tracking ($0.04)
        const createRes = await apiCall('POST', '/trackings/create', {
          tracking_number: entry.tracking_number,
          courier_code: carrierCode,
        })

        if (createRes?.meta?.code === 200 || createRes?.meta?.code === 201) {
          trackingData = createRes.data
          results.registered++
          console.log(`    CREATE: registered, status=${trackingData?.delivery_status || 'pending'}`)
        } else if (createRes?.meta?.code === 4101 || createRes?.meta?.code === 4016) {
          // Already exists - fetch by GET again (may have been wrong carrier before)
          console.log(`    CREATE: already exists, re-fetching...`)
          const retry = await apiCall('GET', `/trackings/get?tracking_numbers=${entry.tracking_number}&courier_code=${carrierCode}`)
          if (retry?.meta?.code === 200 && retry?.data?.length > 0) {
            trackingData = retry.data[0]
          }
        } else {
          console.log(`    CREATE failed: code=${createRes?.meta?.code} msg=${createRes?.meta?.message}`)
          results.failed++
          await delay(200)
          continue
        }
      }

      if (!trackingData) {
        console.log(`    No tracking data returned`)
        results.failed++
        await delay(200)
        continue
      }

      // Extract checkpoints
      const checkpoints = [
        ...(trackingData.origin_info?.trackinfo || []),
        ...(trackingData.destination_info?.trackinfo || []),
      ]

      if (checkpoints.length === 0) {
        console.log(`    No checkpoints yet (pending async fetch)`)
        // Still update the trackingmore ID so crons can fetch later
        if (!dryRun) {
          await supabase.from('lost_in_transit_checks').update({
            trackingmore_tracking_id: trackingData.id,
          }).eq('id', entry.id)
        }
        await delay(200)
        continue
      }

      results.fetched++

      // Sort checkpoints newest first
      checkpoints.sort((a, b) => new Date(b.checkpoint_date) - new Date(a.checkpoint_date))
      const latest = checkpoints[0]
      const latestDate = latest.checkpoint_date
      const latestDesc = latest.tracking_detail || ''
      const latestLocation = latest.location || [latest.city, latest.state].filter(Boolean).join(', ') || null

      // Build location string helper
      function buildLocation(cp) {
        if (cp.location) return cp.location
        const parts = []
        if (cp.city) parts.push(cp.city)
        if (cp.state) parts.push(cp.state)
        if (cp.country_iso2) parts.push(cp.country_iso2)
        return parts.length > 0 ? parts.join(', ') : null
      }

      // Store checkpoints
      if (!dryRun) {
        const records = checkpoints.map(cp => {
          const location = buildLocation(cp)
          return {
            shipment_id: entry.shipment_id,
            tracking_number: entry.tracking_number,
            carrier: entry.carrier,
            carrier_code: carrierCode,
            checkpoint_date: cp.checkpoint_date,
            raw_description: cp.tracking_detail,
            raw_location: location,
            raw_status: cp.checkpoint_delivery_status || null,
            raw_substatus: cp.checkpoint_delivery_substatus || null,
            content_hash: calculateCheckpointHash(entry.carrier, cp.checkpoint_date, cp.tracking_detail, location),
            source: 'trackingmore',
            fetched_at: new Date().toISOString(),
          }
        })

        const { error: storeErr } = await supabase
          .from('tracking_checkpoints')
          .upsert(records, { onConflict: 'content_hash', ignoreDuplicates: true })

        if (storeErr) console.log(`    WARNING: checkpoint store error: ${storeErr.message}`)
      }

      // Check RTS BEFORE delivered — "delivered back to sender" is RTS, not delivered
      const isRTS = RTS_PATTERNS.some(p => p.test(latestDesc)) &&
        !/reminder to schedule redelivery/i.test(latestDesc)

      // Check if delivered (only if NOT RTS — avoid false positives like "delivery attempted")
      const isDelivered = !isRTS && (
        trackingData.delivery_status === 'delivered' ||
        (/^delivered/i.test(latestDesc) && !/delivery attempt/i.test(latestDesc) && !/undelivered/i.test(latestDesc))
      )

      // Calculate days since last scan
      const lastScanDate = new Date(latestDate)
      const daysSince = Math.floor((Date.now() - lastScanDate.getTime()) / (1000 * 60 * 60 * 24))

      // Determine eligibility
      const eligibilityThreshold = entry.is_international ? 20 : 15
      let newStatus = entry.claim_eligibility_status

      if (isDelivered) {
        // Remove from monitoring — it was delivered
        if (!dryRun) {
          await supabase.from('lost_in_transit_checks').delete().eq('id', entry.id)
        }
        results.delivered++
        console.log(`    DELIVERED on ${latestDate} - removed from monitoring`)
        await delay(200)
        continue
      } else if (isRTS) {
        newStatus = 'returned_to_sender'
        results.rts++
        console.log(`    RTS detected: "${latestDesc}"`)
      } else if (daysSince >= eligibilityThreshold && entry.claim_eligibility_status === 'at_risk') {
        newStatus = 'eligible'
      } else if (daysSince < eligibilityThreshold && entry.claim_eligibility_status === 'eligible') {
        newStatus = 'at_risk'
      }

      // Update monitoring entry
      if (!dryRun) {
        const { error: updateErr } = await supabase
          .from('lost_in_transit_checks')
          .update({
            last_scan_date: latestDate,
            last_scan_description: `${latestDesc},${latestLocation || ''},${latestDate}`,
            trackingmore_tracking_id: trackingData.id,
            claim_eligibility_status: newStatus,
            last_recheck_at: new Date().toISOString(),
            days_in_transit: Math.floor((Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24)),
          })
          .eq('id', entry.id)

        if (updateErr) {
          console.log(`    UPDATE ERROR: ${updateErr.message}`)
          results.failed++
        } else {
          results.updated++
          console.log(`    Updated: ${checkpoints.length} checkpoints, lastScan=${latestDate}, status=${newStatus}, daysSince=${daysSince}`)
        }
      } else {
        results.updated++
        console.log(`    [DRY RUN] Would update: ${checkpoints.length} checkpoints, lastScan=${latestDate}, status=${newStatus}`)
      }
    } catch (err) {
      console.log(`    ERROR: ${err.message}`)
      results.failed++
    }

    await delay(200) // Rate limit
  }

  console.log('\n[Backfill] Results:')
  console.log(`  Registered (new): ${results.registered}`)
  console.log(`  Fetched (had data): ${results.fetched}`)
  console.log(`  Delivered (removed): ${results.delivered}`)
  console.log(`  RTS detected: ${results.rts}`)
  console.log(`  Updated: ${results.updated}`)
  console.log(`  Failed: ${results.failed}`)
  console.log(`  Skipped: ${results.skipped}`)
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
