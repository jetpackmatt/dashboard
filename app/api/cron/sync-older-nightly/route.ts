import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * Nightly reconciliation for older shipments (14-45 days)
 *
 * Full sweep that catches shipments where:
 * - Fell out of the 14-day real-time sync window
 * - Had late-arriving timeline updates (carrier delays, exceptions resolved)
 * - Status changed (exception resolved, finally delivered)
 * - Tracking info updated
 *
 * Fetches BOTH timeline events AND full shipment details to ensure
 * all fields are up-to-date, not just timeline.
 *
 * Runs once per night (configured in vercel.json) with higher batch size
 * since we have the full rate limit budget during off-hours.
 *
 * This is a per-client sync to properly use each client's rate limit budget.
 */

const SHIPBOB_API_BASE = 'https://api.shipbob.com/2025-07'
const API_DELAY_MS = 400 // Slightly faster for nightly (more budget available)

// Map ShipBob timeline log_type_id to database column names
const TIMELINE_EVENT_MAP: Record<number, string> = {
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

interface TimelineEvent {
  log_type_id: number
  timestamp: string
  description?: string
}

interface ShipBobShipment {
  id: number
  status: string
  status_details?: string
  tracking?: {
    tracking_number?: string
    tracking_url?: string
    carrier?: string
    carrier_service?: string // Actual carrier service (e.g., "Ground Advantage")
  }
  ship_option?: string
  measurements?: {
    total_weight_oz?: number
    length_in?: number
    width_in?: number
    depth_in?: number
  }
  zone?: { id: number }
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  console.log('[Nightly Timeline] Starting nightly reconciliation...')
  const startTime = Date.now()
  const supabase = createAdminClient()

  const results = {
    totalShipments: 0,
    updated: 0,
    delivered: 0,
    errors: [] as string[],
  }

  try {
    // Get clients with tokens
    const { data: clients } = await supabase
      .from('clients')
      .select('id, company_name, client_api_credentials(api_token, provider)')
      .eq('is_active', true)

    if (!clients || clients.length === 0) {
      return NextResponse.json({ error: 'No clients found' }, { status: 500 })
    }

    // Process each client separately (each has own rate limit)
    for (const client of clients) {
      const creds = client.client_api_credentials as Array<{ api_token: string; provider: string }> | null
      const token = creds?.find((c) => c.provider === 'shipbob')?.api_token
      if (!token) continue

      console.log(`[Nightly Timeline] Processing ${client.company_name}...`)

      // Get older undelivered shipments (14-180 days old)
      // These fell out of the real-time sync window
      // Extended from 45 to 180 days to catch late carrier updates
      const now = new Date()
      const recentCutoff = new Date(now)
      recentCutoff.setDate(recentCutoff.getDate() - 14) // 14 days ago

      const oldCutoff = new Date(now)
      oldCutoff.setDate(oldCutoff.getDate() - 180) // 180 days ago (6 months)

      const { data: shipments, error } = await supabase
        .from('shipments')
        .select('id, shipment_id, status')
        .eq('client_id', client.id)
        .is('event_delivered', null)
        .is('deleted_at', null)
        .neq('status', 'Cancelled')
        .not('event_labeled', 'is', null) // Must have a ship date
        .lt('event_labeled', recentCutoff.toISOString()) // Shipped more than 14 days ago
        .gte('event_labeled', oldCutoff.toISOString()) // But not more than 180 days ago
        .order('event_labeled', { ascending: true })
        .limit(200) // Process up to 200 per client per night

      if (error) {
        results.errors.push(`${client.company_name}: ${error.message}`)
        continue
      }

      if (!shipments || shipments.length === 0) {
        console.log(`[Nightly Timeline] ${client.company_name}: No older shipments to check`)
        continue
      }

      console.log(`[Nightly Sync] ${client.company_name}: Full refresh on ${shipments.length} older shipments (14-180 days)`)
      results.totalShipments += shipments.length

      for (const ship of shipments) {
        try {
          const updateData: Record<string, unknown> = {
            timeline_checked_at: new Date().toISOString(),
          }

          // 1. Fetch full shipment details (status, tracking, measurements)
          const shipRes = await fetch(`https://api.shipbob.com/1.0/shipment/${ship.shipment_id}`, {
            headers: { Authorization: `Bearer ${token}` },
          })

          if (shipRes.status === 429) {
            console.log(`[Nightly] Rate limited on shipment fetch, stopping ${client.company_name}`)
            break
          }

          if (shipRes.ok) {
            const shipData: ShipBobShipment = await shipRes.json()

            // Update all shipment fields
            updateData.status = shipData.status
            updateData.status_details = shipData.status_details || null

            if (shipData.tracking) {
              updateData.tracking_id = shipData.tracking.tracking_number || null
              updateData.tracking_url = shipData.tracking.tracking_url || null
              updateData.carrier = shipData.tracking.carrier || null
              // carrier_service = actual carrier service (e.g., "Ground Advantage")
              if (shipData.tracking.carrier_service) {
                updateData.carrier_service = shipData.tracking.carrier_service
              }
            }

            // ship_option_name = ShipBob ship option (e.g., "ShipBob Economy")
            if (shipData.ship_option) {
              updateData.ship_option_name = shipData.ship_option
            }

            if (shipData.measurements) {
              if (shipData.measurements.total_weight_oz) {
                updateData.actual_weight_oz = shipData.measurements.total_weight_oz
              }
              if (shipData.measurements.length_in) updateData.length = shipData.measurements.length_in
              if (shipData.measurements.width_in) updateData.width = shipData.measurements.width_in
              if (shipData.measurements.depth_in) updateData.height = shipData.measurements.depth_in
            }

            if (shipData.zone?.id) {
              updateData.zone_used = shipData.zone.id
            }
          }

          await new Promise((r) => setTimeout(r, API_DELAY_MS))

          // 2. Fetch timeline events
          const timelineRes = await fetch(`${SHIPBOB_API_BASE}/shipment/${ship.shipment_id}/timeline`, {
            headers: { Authorization: `Bearer ${token}` },
          })

          if (timelineRes.status === 429) {
            console.log(`[Nightly] Rate limited on timeline fetch, stopping ${client.company_name}`)
            break
          }

          if (timelineRes.ok) {
            const timeline: TimelineEvent[] = await timelineRes.json()

            if (timeline && timeline.length > 0) {
              // Map events to columns
              for (const event of timeline) {
                const col = TIMELINE_EVENT_MAP[event.log_type_id]
                if (col && event.timestamp) {
                  updateData[col] = event.timestamp
                }
              }

              // Store full logs
              updateData.event_logs = timeline

              // Calculate transit time if we have both dates
              const intransitDate = updateData.event_intransit as string | undefined
              const deliveredDate = updateData.event_delivered as string | undefined
              if (intransitDate && deliveredDate) {
                const transitMs = new Date(deliveredDate).getTime() - new Date(intransitDate).getTime()
                const transitDays = Math.round((transitMs / (1000 * 60 * 60 * 24)) * 10) / 10
                if (transitDays >= 0) {
                  updateData.transit_time_days = transitDays
                }
              }
            }
          }

          // Update the shipment with all collected data
          const { error: updateError } = await supabase
            .from('shipments')
            .update(updateData)
            .eq('id', ship.id)

          if (updateError) {
            results.errors.push(`Update ${ship.shipment_id}: ${updateError.message}`)
          } else {
            results.updated++
            if (updateData.event_delivered) {
              results.delivered++
            }
          }

          await new Promise((r) => setTimeout(r, API_DELAY_MS))
        } catch (e) {
          results.errors.push(`${ship.shipment_id}: ${e instanceof Error ? e.message : 'Unknown'}`)
        }
      }
    }

    // Second pass: Check very old shipments (180+ days) with smaller batch
    // These are likely lost in transit but occasionally get late updates
    console.log('[Nightly Timeline] Starting second pass for very old shipments (180+ days)...')

    for (const client of clients) {
      const creds = client.client_api_credentials as Array<{ api_token: string; provider: string }> | null
      const token = creds?.find((c) => c.provider === 'shipbob')?.api_token
      if (!token) continue

      const now = new Date()
      const veryOldCutoff = new Date(now)
      veryOldCutoff.setDate(veryOldCutoff.getDate() - 180) // 180 days ago

      // Get very old undelivered shipments (180+ days)
      const { data: veryOldShipments, error: veryOldError } = await supabase
        .from('shipments')
        .select('id, shipment_id, status')
        .eq('client_id', client.id)
        .is('event_delivered', null)
        .is('deleted_at', null)
        .neq('status', 'Cancelled')
        .not('event_labeled', 'is', null)
        .lt('event_labeled', veryOldCutoff.toISOString()) // Shipped more than 180 days ago
        .order('timeline_checked_at', { ascending: true, nullsFirst: true }) // Check least recently checked first
        .limit(50) // Smaller batch for very old shipments

      if (veryOldError || !veryOldShipments || veryOldShipments.length === 0) {
        continue
      }

      console.log(`[Nightly Sync] ${client.company_name}: Checking ${veryOldShipments.length} very old shipments (180+ days)`)
      results.totalShipments += veryOldShipments.length

      for (const ship of veryOldShipments) {
        try {
          const updateData: Record<string, unknown> = {
            timeline_checked_at: new Date().toISOString(),
          }

          // Fetch timeline events
          const timelineRes = await fetch(`${SHIPBOB_API_BASE}/shipment/${ship.shipment_id}/timeline`, {
            headers: { Authorization: `Bearer ${token}` },
          })

          if (timelineRes.status === 429) {
            console.log(`[Nightly] Rate limited on very old shipments, stopping ${client.company_name}`)
            break
          }

          if (timelineRes.ok) {
            const timeline: TimelineEvent[] = await timelineRes.json()

            if (timeline && timeline.length > 0) {
              for (const event of timeline) {
                const col = TIMELINE_EVENT_MAP[event.log_type_id]
                if (col && event.timestamp) {
                  updateData[col] = event.timestamp
                }
              }
              updateData.event_logs = timeline

              const intransitDate = updateData.event_intransit as string | undefined
              const deliveredDate = updateData.event_delivered as string | undefined
              if (intransitDate && deliveredDate) {
                const transitMs = new Date(deliveredDate).getTime() - new Date(intransitDate).getTime()
                const transitDays = Math.round((transitMs / (1000 * 60 * 60 * 24)) * 10) / 10
                if (transitDays >= 0) {
                  updateData.transit_time_days = transitDays
                }
              }
            }
          }

          const { error: updateError } = await supabase
            .from('shipments')
            .update(updateData)
            .eq('id', ship.id)

          if (!updateError) {
            results.updated++
            if (updateData.event_delivered) {
              results.delivered++
              console.log(`[Nightly] Very old shipment ${ship.shipment_id} now delivered!`)
            }
          }

          await new Promise((r) => setTimeout(r, API_DELAY_MS))
        } catch (e) {
          results.errors.push(`${ship.shipment_id}: ${e instanceof Error ? e.message : 'Unknown'}`)
        }
      }
    }

    const duration = Date.now() - startTime
    console.log(`[Nightly Timeline] Completed in ${duration}ms: ${results.updated} updated, ${results.delivered} now delivered`)

    return NextResponse.json({
      success: true,
      duration: `${duration}ms`,
      summary: results,
    })
  } catch (e) {
    console.error('[Nightly Timeline] Fatal error:', e)
    return NextResponse.json(
      { success: false, error: e instanceof Error ? e.message : 'Unknown' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  return GET(request)
}
