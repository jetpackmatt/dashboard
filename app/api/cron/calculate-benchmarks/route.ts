import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { excludeDemoClients } from '@/lib/demo/exclusion'

export const maxDuration = 300

/**
 * POST /api/cron/calculate-benchmarks
 *
 * Daily cron job to calculate transit time benchmarks from historical shipment data.
 * Stores monthly snapshots so benchmarks are time-matched to the client's date range.
 *
 * Normal run: recomputes current month + previous month (for late-arriving data).
 * Backfill:   ?backfill=true computes all months with delivered shipments.
 *
 * Schedule: Daily at 4 AM UTC (0 4 * * *)
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const startTime = Date.now()
  const isBackfill = request.nextUrl.searchParams.get('backfill') === 'true'

  console.log(`[Benchmarks] Starting ${isBackfill ? 'BACKFILL' : 'daily'} benchmark calculation...`)

  try {
    // Determine which months to compute
    const months = await getMonthsToCompute(supabase, isBackfill)
    console.log(`[Benchmarks] Computing ${months.length} months: ${months.map(m => m.label).join(', ')}`)

    let totalUpserts = 0

    for (const month of months) {
      // Guard: don't exceed Vercel function timeout (leave 15s buffer)
      if (Date.now() - startTime > (maxDuration - 15) * 1000) {
        console.log(`[Benchmarks] Approaching timeout after ${totalUpserts} upserts, stopping`)
        break
      }

      const monthUpserts = await computeMonthBenchmarks(supabase, month.start, month.end, month.benchmarkMonth)
      totalUpserts += monthUpserts
      console.log(`[Benchmarks] ${month.label}: ${monthUpserts} benchmark rows upserted`)
    }

    const duration = Date.now() - startTime
    console.log(`[Benchmarks] Done in ${duration}ms: ${totalUpserts} total upserts across ${months.length} months`)

    return NextResponse.json({
      success: true,
      duration,
      months: months.length,
      upserts: totalUpserts,
    })
  } catch (error) {
    console.error('[Benchmarks] Error:', error)
    return NextResponse.json(
      { error: 'Failed to calculate benchmarks' },
      { status: 500 }
    )
  }
}

// Determine which months to compute benchmarks for
async function getMonthsToCompute(
  supabase: ReturnType<typeof createAdminClient>,
  backfill: boolean
): Promise<{ start: string; end: string; benchmarkMonth: string; label: string }[]> {
  if (backfill) {
    // Get all months with delivered shipments
    const { data } = await supabase.rpc('get_benchmark_months' as never)

    // Fallback if RPC doesn't exist: compute last 14 months
    if (!data) {
      const months = []
      const now = new Date()
      for (let i = 0; i < 14; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        months.push(makeMonth(d))
      }
      return months
    }
  }

  // Daily run: current month + previous month
  const now = new Date()
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1)

  return [makeMonth(previousMonth), makeMonth(currentMonth)]
}

function makeMonth(d: Date) {
  const year = d.getFullYear()
  const month = d.getMonth()
  const start = new Date(year, month, 1)
  const end = new Date(year, month + 1, 1) // first day of next month
  const label = `${year}-${String(month + 1).padStart(2, '0')}`
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    benchmarkMonth: `${label}-01`, // date string for DB: "2025-03-01"
    label,
  }
}

// Compute all benchmark types for a single month
async function computeMonthBenchmarks(
  supabase: ReturnType<typeof createAdminClient>,
  monthStart: string,
  monthEnd: string,
  benchmarkMonth: string
): Promise<number> {
  let upserts = 0

  // Step 1: Carrier service benchmarks
  upserts += await computeCarrierBenchmarks(supabase, monthStart, monthEnd, benchmarkMonth)

  // Step 2: International route benchmarks
  upserts += await computeInternationalBenchmarks(supabase, monthStart, monthEnd, benchmarkMonth)

  return upserts
}

// Calculate P80 percentile from sorted array
function calculateP80(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const index = Math.ceil(0.8 * sorted.length) - 1
  return Math.round(sorted[Math.max(0, index)] * 10) / 10
}

// Compute carrier service benchmarks for a single month
async function computeCarrierBenchmarks(
  supabase: ReturnType<typeof createAdminClient>,
  monthStart: string,
  monthEnd: string,
  benchmarkMonth: string
): Promise<number> {
  // Get all delivered shipments for this month with transit data
  // Paginate with cursor to handle >1000 rows
  const allRows: { carrier: string; zone_used: number; transit_time_days: number }[] = []
  const pageSize = 1000
  let lastId: string | null = null

  while (true) {
    let query = supabase
      .from('shipments')
      .select('id, carrier, zone_used, transit_time_days')
      .not('carrier', 'is', null)
      .not('zone_used', 'is', null)
      .not('transit_time_days', 'is', null)
      .not('event_delivered', 'is', null)
      .gte('event_delivered', monthStart)
      .lt('event_delivered', monthEnd)
      .order('id', { ascending: true })
      .limit(pageSize)

    if (lastId) {
      query = query.gt('id', lastId)
    }

    query = await excludeDemoClients(supabase, query)

    const { data, error } = await query
    if (error || !data || data.length === 0) break

    for (const row of data) {
      const transit = Number(row.transit_time_days)
      if (transit > 0 && transit < 30 && row.zone_used >= 1 && row.zone_used <= 10) {
        allRows.push({
          carrier: row.carrier,
          zone_used: row.zone_used,
          transit_time_days: transit,
        })
      }
    }

    lastId = data[data.length - 1].id
    if (data.length < pageSize) break
  }

  // Group by carrier + zone
  const grouped = new Map<string, number[]>()
  for (const row of allRows) {
    const key = `${row.carrier}:${row.zone_used}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(row.transit_time_days)
  }

  // Build per-carrier zone data and upsert
  const carrierZones = new Map<string, Record<string, number | null>>()
  for (const [key, times] of grouped) {
    const [carrier, zoneStr] = key.split(':')
    const zone = parseInt(zoneStr)
    if (!carrierZones.has(carrier)) carrierZones.set(carrier, {})
    const zd = carrierZones.get(carrier)!

    const avg = times.reduce((a, b) => a + b, 0) / times.length
    zd[`zone_${zone}_avg`] = Math.round(avg * 10) / 10
    zd[`zone_${zone}_p80`] = calculateP80(times)
    zd[`zone_${zone}_count`] = times.length
  }

  let upserts = 0
  for (const [carrier, zoneData] of carrierZones) {
    await upsertBenchmark(supabase, 'carrier_service', carrier, carrier, zoneData, benchmarkMonth)
    upserts++
  }

  return upserts
}

// Compute international route benchmarks for a single month
async function computeInternationalBenchmarks(
  supabase: ReturnType<typeof createAdminClient>,
  monthStart: string,
  monthEnd: string,
  benchmarkMonth: string
): Promise<number> {
  // Get international delivered shipments for this month
  const allRows: { carrier: string; origin_country: string; destination_country: string; transit_time_days: number }[] = []
  const pageSize = 1000
  let lastId: string | null = null

  while (true) {
    let query = supabase
      .from('shipments')
      .select('id, carrier, origin_country, destination_country, transit_time_days')
      .not('carrier', 'is', null)
      .not('origin_country', 'is', null)
      .not('destination_country', 'is', null)
      .not('transit_time_days', 'is', null)
      .not('event_delivered', 'is', null)
      .gte('event_delivered', monthStart)
      .lt('event_delivered', monthEnd)
      .order('id', { ascending: true })
      .limit(pageSize)

    if (lastId) {
      query = query.gt('id', lastId)
    }

    query = await excludeDemoClients(supabase, query)

    const { data, error } = await query
    if (error || !data || data.length === 0) break

    for (const row of data) {
      const transit = Number(row.transit_time_days)
      if (transit > 0 && transit < 60 && row.origin_country !== row.destination_country) {
        allRows.push({
          carrier: row.carrier,
          origin_country: row.origin_country,
          destination_country: row.destination_country,
          transit_time_days: transit,
        })
      }
    }

    lastId = data[data.length - 1].id
    if (data.length < pageSize) break
  }

  // Group by carrier:origin:destination
  const grouped = new Map<string, number[]>()
  for (const row of allRows) {
    const key = `${row.carrier}:${row.origin_country}:${row.destination_country}`
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(row.transit_time_days)
  }

  let upserts = 0
  for (const [routeKey, times] of grouped) {
    if (times.length < 3) continue // Need at least 3 samples

    const [carrier, origin, destination] = routeKey.split(':')
    const avg = times.reduce((a, b) => a + b, 0) / times.length
    const roundedAvg = Math.round(avg * 10) / 10
    const p80 = calculateP80(times)

    await upsertBenchmark(
      supabase,
      'international_route',
      routeKey,
      `${carrier}: ${origin} → ${destination}`,
      { zone_1_avg: roundedAvg, zone_1_p80: p80, zone_1_count: times.length },
      benchmarkMonth
    )
    upserts++
  }

  return upserts
}

// Upsert a benchmark row with month
async function upsertBenchmark(
  supabase: ReturnType<typeof createAdminClient>,
  benchmarkType: string,
  benchmarkKey: string,
  displayName: string,
  data: Record<string, number | null>,
  benchmarkMonth: string
) {
  const { error } = await supabase
    .from('transit_benchmarks')
    .upsert({
      benchmark_type: benchmarkType,
      benchmark_key: benchmarkKey,
      benchmark_month: benchmarkMonth,
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
      zone_1_p80: data.zone_1_p80 ?? null,
      zone_2_p80: data.zone_2_p80 ?? null,
      zone_3_p80: data.zone_3_p80 ?? null,
      zone_4_p80: data.zone_4_p80 ?? null,
      zone_5_p80: data.zone_5_p80 ?? null,
      zone_6_p80: data.zone_6_p80 ?? null,
      zone_7_p80: data.zone_7_p80 ?? null,
      zone_8_p80: data.zone_8_p80 ?? null,
      zone_9_p80: data.zone_9_p80 ?? null,
      zone_10_p80: data.zone_10_p80 ?? null,
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
      onConflict: 'benchmark_type,benchmark_key,benchmark_month'
    })

  if (error) {
    console.error(`[Benchmarks] Error upserting ${benchmarkType}/${benchmarkKey}/${benchmarkMonth}:`, error)
  }
}

// Also support GET for manual triggering
export async function GET(request: NextRequest) {
  return POST(request)
}
