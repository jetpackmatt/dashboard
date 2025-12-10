#!/usr/bin/env node
/**
 * Backfill transit_time_days for all shipments with timeline events
 *
 * Calculates: (event_delivered - event_intransit) in days
 * Only updates shipments where both timestamps exist
 *
 * Usage:
 *   node scripts/backfill-transit-time.js           # Run backfill
 *   node scripts/backfill-transit-time.js --dry-run # Preview only
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const BATCH_SIZE = 500
const dryRun = process.argv.includes('--dry-run')

async function main() {
  console.log('=== Transit Time Backfill ===\n')
  if (dryRun) console.log('[DRY RUN MODE]\n')

  // Count shipments that need transit_time_days calculated
  const { count: needsCalcCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('event_intransit', 'is', null)
    .not('event_delivered', 'is', null)
    .is('deleted_at', null)

  console.log(`Found ${needsCalcCount} shipments with both event_intransit and event_delivered`)

  // Also count how many already have transit_time_days
  const { count: hasTransitCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .not('transit_time_days', 'is', null)
    .is('deleted_at', null)

  console.log(`Already have transit_time_days: ${hasTransitCount}`)
  console.log(`Will recalculate all ${needsCalcCount} for accuracy\n`)

  let processed = 0
  let updated = 0
  let skipped = 0
  let errors = 0
  let offset = 0

  while (true) {
    // Fetch batch of shipments with both timestamps
    const { data: shipments, error } = await supabase
      .from('shipments')
      .select('id, shipment_id, event_intransit, event_delivered, transit_time_days')
      .not('event_intransit', 'is', null)
      .not('event_delivered', 'is', null)
      .is('deleted_at', null)
      .order('id')
      .range(offset, offset + BATCH_SIZE - 1)

    if (error) {
      console.error('Query error:', error.message)
      break
    }

    if (!shipments || shipments.length === 0) {
      console.log('\nNo more shipments to process')
      break
    }

    console.log(`Processing batch at offset ${offset}: ${shipments.length} shipments...`)

    for (const ship of shipments) {
      processed++

      const intransit = new Date(ship.event_intransit).getTime()
      const delivered = new Date(ship.event_delivered).getTime()
      const transitMs = delivered - intransit
      const transitDays = Math.round((transitMs / (1000 * 60 * 60 * 24)) * 10) / 10

      // Skip if negative (bad data)
      if (transitDays < 0) {
        skipped++
        continue
      }

      // Skip if already correct
      if (ship.transit_time_days === transitDays) {
        skipped++
        continue
      }

      if (dryRun) {
        if (processed <= 10) {
          console.log(`  [DRY] ${ship.shipment_id}: ${ship.transit_time_days || 'null'} -> ${transitDays} days`)
        }
        updated++
      } else {
        const { error: updateErr } = await supabase
          .from('shipments')
          .update({ transit_time_days: transitDays })
          .eq('id', ship.id)

        if (updateErr) {
          errors++
        } else {
          updated++
        }
      }
    }

    offset += BATCH_SIZE

    // Progress update every 5 batches
    if (offset % (BATCH_SIZE * 5) === 0) {
      console.log(`  Progress: ${processed} processed, ${updated} updated, ${skipped} skipped, ${errors} errors`)
    }
  }

  console.log('\n=== Results ===')
  console.log(`Processed: ${processed}`)
  console.log(`Updated: ${updated}`)
  console.log(`Skipped (already correct or negative): ${skipped}`)
  console.log(`Errors: ${errors}`)

  if (dryRun) {
    console.log('\n[DRY RUN] No changes made. Run without --dry-run to apply.')
  }
}

main().catch(console.error)
