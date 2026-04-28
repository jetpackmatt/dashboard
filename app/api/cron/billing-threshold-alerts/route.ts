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

// Excitement scales with $. Tier picked by threshold; pick within tier is random.
// Tiers cap at $30K and saturate above.
const EXCLAMATION_TIERS: string[][] = [
  // Tier 1: $1K-$5K (mild)
  ['Nice.', 'Cool beans.', 'Tidy.', 'Cha-ching.', 'Ka-ching.', 'Sweet.', 'Lovely.', 'Not bad.', 'Look at us go.', 'Off to the races.'],
  // Tier 2: $5K-$10K (building)
  ['Woohoo!', 'Yeehaw!', 'Heck yes!', 'Hot dog!', 'Right on!', 'Boom.', 'Yes please!', 'Kapow!', 'Shazam!', 'Bingo!'],
  // Tier 3: $10K-$15K (excited)
  ['Hokie Dinah!', 'Holy moly!', 'Hot diggity!', 'Hubba hubba!', 'Mama mia!', 'Whoa Nelly!', 'Yowza!', 'Holy smokes!', 'Sweet mercy!', 'Cowabunga!'],
  // Tier 4: $15K-$22K (hyped)
  ['Hoochie Mama!', 'Holy cannoli!', 'Great Scott!', "Sufferin' succotash!", "Jumpin' Jehoshaphat!", 'By Jove!', 'Stop the presses!', 'Ring the bell!', 'Champagne on ice!', "Pinch me, I'm dreaming!"],
  // Tier 5: $22K+ (bonkers)
  ['HOLY GUACAMOLE!', 'SWEET MOTHER OF PEARL!', 'ABSOLUTE UNIT!', 'WE ARE SO BACK!', 'THE LADS HAVE DONE IT!', 'CALL YOUR MOTHER!', 'WAKE THE NEIGHBORS!', 'STOP THE WORLD!', 'ABSOLUTE PANDEMONIUM!', 'SOMEONE GET MARC ON THE PHONE!'],
]

// Spicy variants reserved for tier 4+ and rolled at increasing probability with
// dollar amount. Targets ~5% overall fire rate when alerts are spread across tiers.
const SPICY_TIERS: string[][] = [
  // Spicy tier 4 (~$15K-$22K): rolled 10% of the time at this tier
  ['Holy shit!', 'Fuck yeah!', 'What the fuck.', 'Holy fuckballs!', 'No fucking way.'],
  // Spicy tier 5 ($22K+): rolled 20% of the time at this tier
  ['ABSO-FUCKING-LUTELY!', 'HOLY FUCKING SHIT!', 'FUCK ME RUNNING!', 'JESUS TAP-DANCING CHRIST!', 'HOLY MOTHERFUCKING SHITBALLS!', 'WHAT THE ACTUAL FUCK!'],
]

// Day-of-week bonus commentary, appended when the threshold beats expectations
// for that day. Mondays are usually slow, so $6K is impressive. Tuesday should
// hit $10K. Thresholds are weekly cumulative cost, not daily.
const DAY_BONUS: Record<string, { minDollars: number; phrases: string[] }> = {
  Mon: {
    minDollars: 6000,
    phrases: [
      'Not bad for a fucking Monday.',
      'On a goddamn Monday, no less.',
      'Hell of a way to start the week.',
      "Monday isn't usually this generous.",
      'Take that, Monday.',
      'Monday came out swinging.',
    ],
  },
  Tue: {
    minDollars: 10000,
    phrases: [
      "And it's only Tuesday.",
      'Tuesday is showing up.',
      'Hell of a Tuesday.',
      'Five figures on a Tuesday — sheesh.',
      'Tuesday flexing, apparently.',
    ],
  },
}

function pickDayBonus(thresholdDollars: number): string | null {
  const weekday = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' }).format(new Date())
  const bonus = DAY_BONUS[weekday]
  if (!bonus || thresholdDollars < bonus.minDollars) return null
  return bonus.phrases[Math.floor(Math.random() * bonus.phrases.length)]
}

function pickExclamation(thresholdDollars: number): string {
  let tierIdx: number
  if (thresholdDollars < 5000) tierIdx = 0
  else if (thresholdDollars < 10000) tierIdx = 1
  else if (thresholdDollars < 15000) tierIdx = 2
  else if (thresholdDollars < 22000) tierIdx = 3
  else tierIdx = 4

  // Roll spicy at higher tiers only
  const spicyChance = tierIdx === 3 ? 0.10 : tierIdx === 4 ? 0.20 : 0
  if (spicyChance > 0 && Math.random() < spicyChance) {
    const pool = SPICY_TIERS[tierIdx - 3]
    return pool[Math.floor(Math.random() * pool.length)]
  }

  const pool = EXCLAMATION_TIERS[tierIdx]
  return pool[Math.floor(Math.random() * pool.length)]
}

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

    // #mgmt is private — the default SLACK_WEBHOOK_URL's bot can't reach it.
    // Requires a dedicated webhook stored in SLACK_WEBHOOK_URL_MGMT. If not
    // set we no-op (logged) rather than leak the alert to whatever channel
    // the default webhook is bound to.
    const mgmtWebhookUrl = process.env.SLACK_WEBHOOK_URL_MGMT
    if (!mgmtWebhookUrl) {
      console.warn('[BillingThresholdAlerts] SLACK_WEBHOOK_URL_MGMT not set — would have alerted at:', thresholds)
    } else {
      for (const t of thresholds) {
        const formatted = t.toLocaleString('en-US')
        const exclamation = pickExclamation(t)
        const dayBonus = pickDayBonus(t)
        const message = dayBonus
          ? `ShipBob billings just crossed $${formatted}. ${exclamation} ${dayBonus}`
          : `ShipBob billings just crossed $${formatted}. ${exclamation}`
        sendSlackAlert(message, {
          channel: '#mgmt',
          webhookUrl: mgmtWebhookUrl,
        })
        alertsSent.push(t)
      }
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
