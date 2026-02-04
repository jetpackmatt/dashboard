import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * POST /api/cron/calculate-benchmarks
 *
 * Daily cron job to calculate transit time benchmarks from historical shipment data.
 * Creates/updates entries in transit_benchmarks for both:
 * 1. Carrier services (e.g., "USPS Ground Advantage")
 * 2. Ship options (e.g., "146" for ShipBob Economy)
 *
 * Schedule: Daily at 4 AM UTC (0 4 * * *)
 */
export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const startTime = Date.now()

  console.log('[Benchmarks] Starting transit benchmark calculation...')

  try {
    // Get unique carriers and ship_options from delivered shipments in last 90 days
    const ninetyDaysAgo = new Date()
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90)

    // Step 1: Calculate benchmarks per carrier (carrier_service type)
    console.log('[Benchmarks] Calculating carrier service benchmarks...')

    const { data: carrierData, error: carrierError } = await supabase
      .rpc('calculate_carrier_benchmarks', {
        start_date: ninetyDaysAgo.toISOString()
      })

    if (carrierError) {
      // RPC might not exist yet, fall back to direct query
      console.log('[Benchmarks] RPC not available, using direct queries...')
      await calculateBenchmarksDirectly(supabase, ninetyDaysAgo)
    } else if (carrierData) {
      // Upsert carrier benchmarks
      for (const row of carrierData) {
        await upsertBenchmark(supabase, 'carrier_service', row.carrier, row.carrier, row)
      }
    }

    // Step 2: Calculate benchmarks per ship_option
    console.log('[Benchmarks] Calculating ship option benchmarks...')

    const { data: shipOptionData, error: shipOptionError } = await supabase
      .rpc('calculate_ship_option_benchmarks', {
        start_date: ninetyDaysAgo.toISOString()
      })

    if (shipOptionError) {
      console.log('[Benchmarks] Ship option RPC not available, using direct queries...')
      await calculateShipOptionBenchmarksDirectly(supabase, ninetyDaysAgo)
    } else if (shipOptionData) {
      // Upsert ship option benchmarks
      for (const row of shipOptionData) {
        await upsertBenchmark(
          supabase,
          'ship_option',
          String(row.ship_option),
          row.ship_option_name || `Ship Option ${row.ship_option}`,
          row
        )
      }
    }

    // Step 3: Calculate international route benchmarks (origin → destination country)
    console.log('[Benchmarks] Calculating international route benchmarks...')
    await calculateInternationalBenchmarks(supabase, ninetyDaysAgo)

    const duration = Date.now() - startTime
    console.log(`[Benchmarks] Calculation complete in ${duration}ms`)

    return NextResponse.json({
      success: true,
      duration,
      message: 'Transit benchmarks calculated successfully'
    })
  } catch (error) {
    console.error('[Benchmarks] Error:', error)
    return NextResponse.json(
      { error: 'Failed to calculate benchmarks' },
      { status: 500 }
    )
  }
}

// Fallback: Direct query calculation when RPC is not available
async function calculateBenchmarksDirectly(
  supabase: ReturnType<typeof createAdminClient>,
  startDate: Date
) {
  // Get distinct carriers
  const { data: carriers } = await supabase
    .from('shipments')
    .select('carrier')
    .not('carrier', 'is', null)
    .not('event_delivered', 'is', null)
    .gte('event_delivered', startDate.toISOString())
    .limit(100)

  if (!carriers) return

  const uniqueCarriers = [...new Set(carriers.map((c: { carrier: string }) => c.carrier))]

  for (const carrier of uniqueCarriers) {
    if (!carrier) continue

    // Calculate zone averages for this carrier
    const zoneAverages: Record<string, number | null> = {}
    const zoneCounts: Record<string, number> = {}

    for (let zone = 1; zone <= 10; zone++) {
      const { data: zoneData } = await supabase
        .from('shipments')
        .select('event_labeled, event_delivered')
        .eq('carrier', carrier)
        .eq('zone_used', zone)
        .not('event_delivered', 'is', null)
        .not('event_labeled', 'is', null)
        .gte('event_delivered', startDate.toISOString())
        .limit(1000)

      if (zoneData && zoneData.length > 0) {
        const transitTimes = zoneData.map((s: { event_labeled: string; event_delivered: string }) => {
          const labeled = new Date(s.event_labeled)
          const delivered = new Date(s.event_delivered)
          return (delivered.getTime() - labeled.getTime()) / (1000 * 60 * 60 * 24)
        }).filter((t: number) => t > 0 && t < 30) // Filter outliers

        if (transitTimes.length > 0) {
          const avg = transitTimes.reduce((a: number, b: number) => a + b, 0) / transitTimes.length
          zoneAverages[`zone_${zone}_avg`] = Math.round(avg * 10) / 10
          zoneCounts[`zone_${zone}_count`] = transitTimes.length
        }
      }
    }

    if (Object.keys(zoneAverages).length > 0) {
      await upsertBenchmark(supabase, 'carrier_service', carrier as string, carrier as string, {
        ...zoneAverages,
        ...zoneCounts
      })
    }
  }
}

// Calculate ship option benchmarks directly
async function calculateShipOptionBenchmarksDirectly(
  supabase: ReturnType<typeof createAdminClient>,
  startDate: Date
) {
  // Get distinct ship_options
  const { data: shipOptions } = await supabase
    .from('shipments')
    .select('ship_option')
    .not('ship_option', 'is', null)
    .not('event_delivered', 'is', null)
    .gte('event_delivered', startDate.toISOString())
    .limit(100)

  if (!shipOptions) return

  const uniqueOptions = [...new Set(shipOptions.map((s: { ship_option: number }) => s.ship_option))]

  for (const shipOption of uniqueOptions) {
    if (!shipOption) continue

    const zoneAverages: Record<string, number | null> = {}
    const zoneCounts: Record<string, number> = {}

    for (let zone = 1; zone <= 10; zone++) {
      const { data: zoneData } = await supabase
        .from('shipments')
        .select('event_labeled, event_delivered')
        .eq('ship_option', shipOption)
        .eq('zone_used', zone)
        .not('event_delivered', 'is', null)
        .not('event_labeled', 'is', null)
        .gte('event_delivered', startDate.toISOString())
        .limit(1000)

      if (zoneData && zoneData.length > 0) {
        const transitTimes = zoneData.map((s: { event_labeled: string; event_delivered: string }) => {
          const labeled = new Date(s.event_labeled)
          const delivered = new Date(s.event_delivered)
          return (delivered.getTime() - labeled.getTime()) / (1000 * 60 * 60 * 24)
        }).filter((t: number) => t > 0 && t < 30)

        if (transitTimes.length > 0) {
          const avg = transitTimes.reduce((a: number, b: number) => a + b, 0) / transitTimes.length
          zoneAverages[`zone_${zone}_avg`] = Math.round(avg * 10) / 10
          zoneCounts[`zone_${zone}_count`] = transitTimes.length
        }
      }
    }

    if (Object.keys(zoneAverages).length > 0) {
      await upsertBenchmark(
        supabase,
        'ship_option',
        String(shipOption),
        `Ship Option ${shipOption}`,
        { ...zoneAverages, ...zoneCounts }
      )
    }
  }
}

// Calculate international route benchmarks by carrier (carrier + origin country → destination country)
async function calculateInternationalBenchmarks(
  supabase: ReturnType<typeof createAdminClient>,
  startDate: Date
) {
  // Get distinct international routes with carrier (where origin != destination)
  const { data: routes } = await supabase
    .from('shipments')
    .select('carrier, origin_country, destination_country')
    .not('carrier', 'is', null)
    .not('origin_country', 'is', null)
    .not('destination_country', 'is', null)
    .not('event_delivered', 'is', null)
    .gte('event_delivered', startDate.toISOString())
    .limit(10000)

  if (!routes) return

  // Build unique carrier+route combinations
  const routeSet = new Set<string>()
  for (const r of routes) {
    if (r.carrier && r.origin_country && r.destination_country && r.origin_country !== r.destination_country) {
      routeSet.add(`${r.carrier}:${r.origin_country}:${r.destination_country}`)
    }
  }

  const uniqueRoutes = Array.from(routeSet)
  console.log(`[Benchmarks] Found ${uniqueRoutes.length} international carrier+route combinations`)

  for (const routeKey of uniqueRoutes) {
    const [carrier, origin, destination] = routeKey.split(':')

    const { data: routeData } = await supabase
      .from('shipments')
      .select('event_labeled, event_delivered')
      .eq('carrier', carrier)
      .eq('origin_country', origin)
      .eq('destination_country', destination)
      .not('event_delivered', 'is', null)
      .not('event_labeled', 'is', null)
      .gte('event_delivered', startDate.toISOString())
      .limit(1000)

    if (routeData && routeData.length >= 3) { // Require at least 3 samples (fewer for carrier-specific)
      const transitTimes = routeData.map((s: { event_labeled: string; event_delivered: string }) => {
        const labeled = new Date(s.event_labeled)
        const delivered = new Date(s.event_delivered)
        return (delivered.getTime() - labeled.getTime()) / (1000 * 60 * 60 * 24)
      }).filter((t: number) => t > 0 && t < 60) // Filter outliers (up to 60 days for international)

      if (transitTimes.length >= 3) {
        const avg = transitTimes.reduce((a: number, b: number) => a + b, 0) / transitTimes.length
        const roundedAvg = Math.round(avg * 10) / 10

        // Store with carrier in the key: "carrier:origin:destination"
        // benchmark_type='international_route' for easy lookup
        await upsertBenchmark(
          supabase,
          'international_route',
          routeKey, // e.g., "DHL Express:US:MX"
          `${carrier}: ${origin} → ${destination}`,
          { zone_1_avg: roundedAvg, zone_1_count: transitTimes.length }
        )

        console.log(`[Benchmarks] ${carrier}: ${origin} → ${destination}: ${roundedAvg} days (${transitTimes.length} samples)`)
      }
    }
  }
}

// Upsert a benchmark row
async function upsertBenchmark(
  supabase: ReturnType<typeof createAdminClient>,
  benchmarkType: string,
  benchmarkKey: string,
  displayName: string,
  data: Record<string, number | null>
) {
  const { error } = await supabase
    .from('transit_benchmarks')
    .upsert({
      benchmark_type: benchmarkType,
      benchmark_key: benchmarkKey,
      display_name: displayName,
      zone_1_avg: data.zone_1_avg ?? null,
      zone_2_avg: data.zone_2_avg ?? null,
      zone_3_avg: data.zone_3_avg ?? null,
      zone_4_avg: data.zone_4_avg ?? null,
      zone_5_avg: data.zone_5_avg ?? null,
      zone_6_avg: data.zone_6_avg ?? null,
      zone_7_avg: data.zone_7_avg ?? null,
      zone_8_avg: data.zone_8_avg ?? null,
      zone_9_avg: data.zone_9_avg ?? null,
      zone_10_avg: data.zone_10_avg ?? null,
      zone_1_count: data.zone_1_count ?? 0,
      zone_2_count: data.zone_2_count ?? 0,
      zone_3_count: data.zone_3_count ?? 0,
      zone_4_count: data.zone_4_count ?? 0,
      zone_5_count: data.zone_5_count ?? 0,
      zone_6_count: data.zone_6_count ?? 0,
      zone_7_count: data.zone_7_count ?? 0,
      zone_8_count: data.zone_8_count ?? 0,
      zone_9_count: data.zone_9_count ?? 0,
      zone_10_count: data.zone_10_count ?? 0,
      last_calculated_at: new Date().toISOString(),
    }, {
      onConflict: 'benchmark_type,benchmark_key'
    })

  if (error) {
    console.error(`[Benchmarks] Error upserting ${benchmarkType}/${benchmarkKey}:`, error)
  }
}

// Also support GET for manual triggering
export async function GET(request: NextRequest) {
  return POST(request)
}
