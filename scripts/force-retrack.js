#!/usr/bin/env node
/**
 * Force re-track: Delete trackings from TrackingMore and re-create with correct carrier codes.
 *
 * This handles the case where trackings were originally registered with wrong carrier codes
 * and are stuck in "pending" state. Deleting and re-creating forces a fresh fetch.
 *
 * Usage: node scripts/force-retrack.js [--limit N] [--dry-run] [--carrier CARRIER]
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

// Must match lib/trackingmore/client.ts
function getCarrierCode(carrier) {
  const c = (carrier || '').toLowerCase()
  // Specific before generic
  if (c.includes('upsmi') || c.includes('mailinnovation') || c.includes('mail innovations')) return 'ups-mi'
  if (c.includes('smartpost')) return 'fedex'
  if (c.includes('usps')) return 'usps'
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
  if (c.includes('shipbob')) return 'shipbob'
  if (c.includes('prepaid') || c.includes('kitting')) return null
  return null
}

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

const RTS_PATTERNS = [
  /returned to sender/i, /returned to shipper/i, /returned to seller/i,
  /return to sender/i, /return in progress/i, /return initiated/i,
  /returninitiated/i, /to original sender/i, /being returned/i,
  /was returned/i, /return to shipper/i,
]

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

async function main() {
  const args = process.argv.slice(2)
  const dryRun = args.includes('--dry-run')
  const limitIdx = args.indexOf('--limit')
  const limit = limitIdx !== -1 ? parseInt(args[limitIdx + 1]) : 200
  const carrierIdx = args.indexOf('--carrier')
  const carrierFilter = carrierIdx !== -1 ? args[carrierIdx + 1] : null

  console.log(`[Force Retrack] Starting... limit=${limit} dryRun=${dryRun} carrier=${carrierFilter || 'all'}`)

  // Get entries still pending (have TM ID but no scan data)
  let query = supabase
    .from('lost_in_transit_checks')
    .select('id, shipment_id, tracking_number, carrier, claim_eligibility_status, is_international, trackingmore_tracking_id')
    .is('last_scan_date', null)
    .not('tracking_number', 'is', null)
    .not('claim_eligibility_status', 'in', '("missed_window","returned_to_sender")')
    .limit(limit)

  if (carrierFilter) {
    query = query.ilike('carrier', `%${carrierFilter}%`)
  }

  const { data: entries, error } = await query
  if (error) { console.error('Failed to fetch:', error); process.exit(1) }
  console.log(`[Force Retrack] Found ${entries.length} stuck entries`)

  const results = { deleted: 0, recreated: 0, gotData: 0, delivered: 0, rts: 0, updated: 0, failed: 0, skipped: 0 }

  for (const entry of entries) {
    const carrierCode = getCarrierCode(entry.carrier)
    if (!carrierCode) {
      console.log(`  SKIP ${entry.tracking_number} - unknown carrier: ${entry.carrier}`)
      results.skipped++
      continue
    }

    console.log(`  ${entry.tracking_number} (${entry.carrier} → ${carrierCode})`)

    try {
      // Step 1: DELETE from TrackingMore (try common carrier codes since we don't know what it was registered as)
      const codesToTry = [carrierCode]
      // Add alternative codes to try deleting (in case registered with wrong code)
      if (carrierCode === 'dhl') codesToTry.push('dhlglobalmail', 'dhl-unified-api')
      if (carrierCode === 'dhlglobalmail') codesToTry.push('dhl')
      if (carrierCode === 'ups-mi') codesToTry.push('ups', 'usps')
      if (carrierCode === 'ups') codesToTry.push('ups-mi')

      let deleted = false
      for (const code of codesToTry) {
        const delRes = await apiCall('DELETE', '/trackings/delete', {
          tracking_number: entry.tracking_number,
          courier_code: code,
        })
        if (delRes?.meta?.code === 200) {
          console.log(`    Deleted (was registered as ${code})`)
          results.deleted++
          deleted = true
          break
        }
        await delay(100)
      }

      if (!deleted) {
        console.log(`    Could not find/delete existing tracking, creating fresh`)
      }

      await delay(300) // Give TM a moment after delete

      // Step 2: Re-CREATE with correct carrier code
      const createRes = await apiCall('POST', '/trackings/create', {
        tracking_number: entry.tracking_number,
        courier_code: carrierCode,
      })

      let trackingData = null
      if (createRes?.meta?.code === 200 || createRes?.meta?.code === 201) {
        trackingData = createRes.data
        results.recreated++
        console.log(`    Re-created, status=${trackingData?.delivery_status || 'pending'}`)
      } else if (createRes?.meta?.code === 4101 || createRes?.meta?.code === 4016) {
        // Already exists again somehow - try GET
        console.log(`    Already exists after delete, fetching...`)
        const getRes = await apiCall('GET', `/trackings/get?tracking_numbers=${entry.tracking_number}&courier_code=${carrierCode}`)
        if (getRes?.meta?.code === 200 && getRes?.data?.length > 0) {
          trackingData = getRes.data[0]
        }
      } else {
        console.log(`    CREATE failed: code=${createRes?.meta?.code} msg=${createRes?.meta?.message}`)
        results.failed++
        await delay(200)
        continue
      }

      if (!trackingData) {
        console.log(`    No data returned`)
        results.failed++
        await delay(200)
        continue
      }

      // Update the TM tracking ID
      if (!dryRun) {
        await supabase.from('lost_in_transit_checks').update({
          trackingmore_tracking_id: trackingData.id,
        }).eq('id', entry.id)
      }

      // Check for checkpoints
      const checkpoints = [
        ...(trackingData.origin_info?.trackinfo || []),
        ...(trackingData.destination_info?.trackinfo || []),
      ]

      if (checkpoints.length === 0) {
        console.log(`    Re-registered but still pending (async). TM will process.`)
        await delay(200)
        continue
      }

      results.gotData++
      console.log(`    GOT ${checkpoints.length} checkpoints!`)

      // Sort newest first
      checkpoints.sort((a, b) => new Date(b.checkpoint_date) - new Date(a.checkpoint_date))
      const latest = checkpoints[0]
      const latestDate = latest.checkpoint_date
      const latestDesc = latest.tracking_detail || ''
      const latestLocation = latest.location || [latest.city, latest.state].filter(Boolean).join(', ') || null

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
      const isRTS = RTS_PATTERNS.some(p => p.test(latestDesc)) && !/reminder to schedule redelivery/i.test(latestDesc)
      const isDelivered = !isRTS && (
        trackingData.delivery_status === 'delivered' ||
        (/^delivered/i.test(latestDesc) && !/delivery attempt/i.test(latestDesc) && !/undelivered/i.test(latestDesc))
      )
      const daysSince = Math.floor((Date.now() - new Date(latestDate).getTime()) / (1000 * 60 * 60 * 24))
      const eligibilityThreshold = entry.is_international ? 20 : 15
      let newStatus = entry.claim_eligibility_status

      if (isDelivered) {
        if (!dryRun) await supabase.from('lost_in_transit_checks').delete().eq('id', entry.id)
        results.delivered++
        console.log(`    DELIVERED on ${latestDate} - removed`)
        await delay(200)
        continue
      } else if (isRTS) {
        newStatus = 'returned_to_sender'
        results.rts++
        console.log(`    RTS: "${latestDesc}"`)
      } else if (daysSince >= eligibilityThreshold && entry.claim_eligibility_status === 'at_risk') {
        newStatus = 'eligible'
      }

      if (!dryRun) {
        const { error: updateErr } = await supabase
          .from('lost_in_transit_checks')
          .update({
            last_scan_date: latestDate,
            last_scan_description: `${latestDesc},${latestLocation || ''},${latestDate}`,
            trackingmore_tracking_id: trackingData.id,
            claim_eligibility_status: newStatus,
            last_recheck_at: new Date().toISOString(),
            days_in_transit: daysSince,
          })
          .eq('id', entry.id)

        if (updateErr) {
          console.log(`    UPDATE ERROR: ${updateErr.message}`)
          results.failed++
        } else {
          results.updated++
          console.log(`    Updated: ${checkpoints.length} cps, lastScan=${latestDate}, status=${newStatus}, days=${daysSince}`)
        }
      }
    } catch (err) {
      console.log(`    ERROR: ${err.message}`)
      results.failed++
    }

    await delay(300)
  }

  console.log('\n[Force Retrack] Results:')
  console.log(`  Deleted from TM: ${results.deleted}`)
  console.log(`  Re-created: ${results.recreated}`)
  console.log(`  Got checkpoint data: ${results.gotData}`)
  console.log(`  Delivered (removed): ${results.delivered}`)
  console.log(`  RTS detected: ${results.rts}`)
  console.log(`  Updated: ${results.updated}`)
  console.log(`  Failed: ${results.failed}`)
  console.log(`  Skipped: ${results.skipped}`)
}

main().catch(err => { console.error('Fatal:', err); process.exit(1) })
