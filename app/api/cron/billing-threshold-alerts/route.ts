import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { sendSlackAlert } from '@/lib/slack'

/**
 * GET /api/cron/billing-threshold-alerts
 *
 * Vercel Cron: every 15 min.
 *
 * What: Sums non-demo, non-voided ShipBob transaction COST (not billed_amount)
 * since the most recent Monday 00:00 America/Toronto. Posts a Slack alert to
 * #mgmt every time the running total crosses a new $1,000 threshold.
 *
 * State: weekly_billing_alerts table keyed on week_start. last_threshold is
 * the most recent $1K mark we've already announced for the week, so we don't
 * re-alert on the same level.
 *
 * Reset: a new Monday means a new week_start row → counter starts at 0.
 *
 * Cost basis: this is what ShipBob charges Jetpack, NOT what we bill clients.
 */
export const runtime = 'nodejs'
export const maxDuration = 60

const TZ = 'America/Toronto'
const MAX_ALERTS_PER_RUN = 10

/** Get the Monday-of-current-week date string (YYYY-MM-DD) in America/Toronto. */
function getWeekStartLocal(): string {
  const now = new Date()
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value || ''
  const weekday = get('weekday')
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`

  const dayMap: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 }
  const offset = dayMap[weekday] ?? 0

  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - offset)
  return d.toISOString().slice(0, 10)
}

function addDaysISO(dateStr: string, days: number): string {
  const d = new Date(`${dateStr}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

export async function GET(request: Request) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const weekStart = getWeekStartLocal()
  const weekEnd = addDaysISO(weekStart, 7)

  const { data: sumRows, error: sumErr } = await supabase.rpc('get_weekly_shipbob_cost', {
    start_date: weekStart,
    end_date: weekEnd,
  })
  if (sumErr) {
    return NextResponse.json({ error: 'Sum query failed', details: sumErr.message }, { status: 500 })
  }

  const totalCost = Number(sumRows ?? 0)
  const currentThreshold = Math.floor(totalCost / 1000) * 1000

  const { data: existing, error: stateErr } = await supabase
    .from('weekly_billing_alerts')
    .select('week_start, last_threshold, total_cost')
    .eq('week_start', weekStart)
    .maybeSingle()
  if (stateErr) {
    return NextResponse.json({ error: 'State read failed', details: stateErr.message }, { status: 500 })
  }

  const lastThreshold = existing?.last_threshold ?? 0
  const alertsSent: number[] = []

  if (currentThreshold > lastThreshold) {
    const thresholds: number[] = []
    for (let t = lastThreshold + 1000; t <= currentThreshold; t += 1000) {
      thresholds.push(t)
      if (thresholds.length >= MAX_ALERTS_PER_RUN) break
    }

    for (const t of thresholds) {
      const formatted = t.toLocaleString('en-US')
      sendSlackAlert(`ShipBob billings just crossed $${formatted}`, { channel: '#mgmt' })
      alertsSent.push(t)
    }
  }

  const newLastThreshold = alertsSent.length > 0 ? alertsSent[alertsSent.length - 1] : lastThreshold
  const { error: upsertErr } = await supabase
    .from('weekly_billing_alerts')
    .upsert(
      {
        week_start: weekStart,
        last_threshold: newLastThreshold,
        total_cost: totalCost,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'week_start' },
    )
  if (upsertErr) {
    console.error('[BillingThresholdAlerts] State write failed:', upsertErr.message)
  }

  return NextResponse.json({
    success: true,
    weekStart,
    weekEnd,
    totalCost: Math.round(totalCost * 100) / 100,
    currentThreshold,
    lastThreshold,
    newLastThreshold,
    alertsSent,
  })
}
