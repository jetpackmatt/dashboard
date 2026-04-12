import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import crypto from 'crypto'

export const maxDuration = 300

/**
 * POST /api/cron/refresh-demo
 *
 * Daily cron that keeps the Paul's Boutique demo client "alive":
 *  1. Clones ~1 day of shipments from real source clients (w/ anonymization + date shift)
 *  2. Advances care-ticket lifecycles (Under Review → Credit Requested → Approved → Resolved)
 *  3. Creates new care tickets for 1% of today's new shipments
 *
 * Volume target follows the same monthly growth model as the backfill:
 *   baseline = 3000 US + 1000 CA per month, plus randomized 3–8% MoM growth
 * Daily counts: monthlyTarget / daysInMonth ± random_int(3, 77) per country.
 *
 * Schedule: nightly at 02:00 UTC (before the 04:00 benchmarks cron).
 */

const SOURCE_CLIENT_IDS = [
  '78854d47-a4eb-4bc1-af16-f2ac624cdc9d', // Arterra Pet
  'e6220921-695e-41f9-9f49-af3e0cdc828a', // Eli Health
  '6b94c274-0446-4167-9d02-b998f8be59ad', // Henson Shaving
  'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e', // Methyl-Life
]

const DEMO_PRODUCTS = [
  { id: 900001, sku: 'PB-ACS-LT', name: 'Acoustic Guitar Strings - Light Gauge',  price: 9.99,  cat: 'strings' },
  { id: 900002, sku: 'PB-ACS-MD', name: 'Acoustic Guitar Strings - Medium Gauge', price: 9.99,  cat: 'strings' },
  { id: 900003, sku: 'PB-ELE-09', name: 'Electric Guitar Strings - 9s',           price: 7.99,  cat: 'strings' },
  { id: 900004, sku: 'PB-ELE-10', name: 'Electric Guitar Strings - 10s',          price: 7.99,  cat: 'strings' },
  { id: 900005, sku: 'PB-ELE-11', name: 'Electric Guitar Strings - 11s',          price: 8.99,  cat: 'strings' },
  { id: 900006, sku: 'PB-CLS-NYL',name: 'Classical Guitar Nylon Strings',         price: 12.99, cat: 'strings' },
  { id: 900007, sku: 'PB-BAS-4',  name: 'Bass Guitar Strings - 4-String',         price: 22.99, cat: 'strings' },
  { id: 900008, sku: 'PB-BAS-5',  name: 'Bass Guitar Strings - 5-String',         price: 27.99, cat: 'strings' },
  { id: 900009, sku: 'PB-PIK-LT', name: 'Celluloid Picks - Light 12-Pack',        price: 4.99,  cat: 'picks' },
  { id: 900010, sku: 'PB-PIK-MD', name: 'Celluloid Picks - Medium 12-Pack',       price: 4.99,  cat: 'picks' },
  { id: 900011, sku: 'PB-PIK-HV', name: 'Celluloid Picks - Heavy 12-Pack',        price: 4.99,  cat: 'picks' },
  { id: 900012, sku: 'PB-PIK-VAR',name: 'Pick Variety Pack - 24 Assorted',        price: 9.99,  cat: 'picks' },
  { id: 900013, sku: 'PB-POL-OIL',name: 'Fretboard Conditioner Oil - 2oz',        price: 8.99,  cat: 'polish' },
  { id: 900014, sku: 'PB-POL-SPR',name: 'Guitar Polish Spray - 4oz',              price: 7.99,  cat: 'polish' },
  { id: 900015, sku: 'PB-POL-CLN',name: 'String Cleaner & Lubricant',             price: 6.99,  cat: 'polish' },
  { id: 900016, sku: 'PB-TOO-CAP',name: 'Trigger Capo - Black',                   price: 14.99, cat: 'tools' },
  { id: 900017, sku: 'PB-TOO-TUN',name: 'Clip-On Chromatic Tuner',                price: 11.99, cat: 'tools' },
  { id: 900018, sku: 'PB-TOO-WND',name: 'String Winder & Cutter Combo',           price: 5.99,  cat: 'tools' },
  { id: 900019, sku: 'PB-STR-BLK',name: 'Woven Guitar Strap - Black/Red',         price: 19.99, cat: 'straps' },
  { id: 900020, sku: 'PB-CAB-10F',name: 'Instrument Cable - 10ft 1/4"',           price: 15.99, cat: 'cables' },
] as const

const CATEGORY_WEIGHTS: Record<string, number> = { strings: 40, picks: 25, polish: 15, tools: 12, straps: 4, cables: 4 }
const WEIGHTED_PRODUCTS: typeof DEMO_PRODUCTS[number][] = []
for (const p of DEMO_PRODUCTS) {
  const w = CATEGORY_WEIGHTS[p.cat] || 5
  for (let i = 0; i < w; i++) WEIGHTED_PRODUCTS.push(p)
}

const FIRST_NAMES = ['James','Emma','Liam','Olivia','Noah','Ava','Lucas','Mia','Ethan','Isabella','Mason','Sophia','Logan','Charlotte','Alexander','Amelia','Benjamin','Harper','Jackson','Evelyn','Owen','Abigail','Daniel','Emily','Sebastian','Elizabeth','Henry','Sofia','Carter','Avery','Elijah','Ella','Michael','Scarlett','Gabriel','Grace','William','Chloe','David','Victoria']
const LAST_NAMES = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Kim','Nguyen','Patel','Chen','Singh']
const STREETS = ['Main St','Oak Ave','Maple Dr','Pine Rd','Cedar Ln','Elm St','Washington Ave','Park Blvd','Broadway','Highland Ave','Market St','Lincoln St','Jefferson Rd','Madison Ave']

function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min }
function randomChoice<T>(arr: readonly T[]): T { return arr[Math.floor(Math.random() * arr.length)] }
// 9-digit numeric IDs in reserved demo range. Counter starts from max+1 of
// existing demo data so concurrent/sequential cron runs never collide.
// Shipment IDs: 700M base | Order IDs: 800M base.
function demoTxId() { return `DEMO-TX-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}` }
async function nextIdAllocators(supabase: ReturnType<typeof createAdminClient>, demoClientId: string) {
  const { data: maxS } = await supabase.from('shipments').select('shipment_id').eq('client_id', demoClientId).gte('shipment_id', '700000000').lte('shipment_id', '799999999').order('shipment_id', { ascending: false }).limit(1).maybeSingle()
  const { data: maxO } = await supabase.from('orders').select('shipbob_order_id').eq('client_id', demoClientId).gte('shipbob_order_id', '800000000').lte('shipbob_order_id', '899999999').order('shipbob_order_id', { ascending: false }).limit(1).maybeSingle()
  let shipCounter = Math.max(700_000_000, Number(maxS?.shipment_id || '699999999') + 1)
  let ordCounter = Math.max(800_000_000, Number(maxO?.shipbob_order_id || '799999999') + 1)
  return {
    nextShipmentId: () => String(shipCounter++),
    nextOrderId: () => String(ordCounter++),
  }
}

function anonymizeName() { return `${randomChoice(FIRST_NAMES)} ${randomChoice(LAST_NAMES)}` }
function anonymizeEmail(name: string) { const [f, l] = name.toLowerCase().split(' '); return `${f}.${l}${randInt(10,999)}@example.com` }
function anonymizeAddress() { return `${randInt(10,9999)} ${randomChoice(STREETS)}` }
function anonymizePhone(country: string) {
  return country === 'CA'
    ? `${randomChoice(['416','437','647','450','514'])}-${randInt(100,999)}-${randInt(1000,9999)}`
    : `555-${randInt(100,999)}-${randInt(1000,9999)}`
}

// Volume: baseline 3000 US + 1000 CA this month, compounding +3-8% MoM.
// Since cron is continuous, apply a gentle daily drift so numbers grow
// indefinitely. Target daily: (baseline / daysInMonth) ± random(3, 77).
function dailyTargets(now: Date): { us: number; ca: number } {
  // Month-index since April 2026 baseline (arbitrary anchor)
  const anchor = new Date(Date.UTC(2026, 3, 1))
  const monthsSinceAnchor = (now.getUTCFullYear() - anchor.getUTCFullYear()) * 12 + (now.getUTCMonth() - anchor.getUTCMonth())
  // Use deterministic-ish growth: +5% average per month
  const growthFactor = Math.pow(1.05, Math.max(0, monthsSinceAnchor))
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const monthlyUs = Math.round(3000 * growthFactor)
  const monthlyCa = Math.round(1000 * growthFactor)
  const baseUs = monthlyUs / daysInMonth
  const baseCa = monthlyCa / daysInMonth
  const noise = () => (Math.random() < 0.5 ? -1 : 1) * randInt(3, 77)
  let us = Math.max(1, Math.round(baseUs + noise()))
  let ca = Math.max(1, Math.round(baseCa + noise()))
  // Prefer non-round numbers
  if (us % 10 === 0) us += randInt(1, 3) * (Math.random() < 0.5 ? -1 : 1)
  if (ca % 10 === 0) ca += randInt(1, 3) * (Math.random() < 0.5 ? -1 : 1)
  return { us, ca }
}

function pickProductsForOrder() {
  const n = randomChoice([1, 1, 1, 2, 2, 3])
  const byId = new Map<number, { sku: string; name: string; price: number; qty: number }>()
  for (let i = 0; i < n; i++) {
    const p = randomChoice(WEIGHTED_PRODUCTS)
    const qty = Math.random() < 0.85 ? 1 : (Math.random() < 0.7 ? 2 : 3)
    const existing = byId.get(p.id)
    if (existing) existing.qty += qty
    else byId.set(p.id, { sku: p.sku, name: p.name, price: p.price, qty })
  }
  return [...byId.entries()].map(([id, v]) => ({ id, ...v }))
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminClient()
  const startTime = Date.now()

  // Resolve demo client
  const { data: demoClient } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')
    .eq('is_demo', true)
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  if (!demoClient) {
    return NextResponse.json({ success: true, note: 'No active demo client — skipping' })
  }

  const DEMO_CLIENT_ID = demoClient.id
  const DEMO_MERCHANT = demoClient.merchant_id
  const { nextShipmentId, nextOrderId } = await nextIdAllocators(supabase, DEMO_CLIENT_ID)

  const now = new Date()
  const { us: targetUs, ca: targetCa } = dailyTargets(now)
  console.log(`[refresh-demo] daily target: ${targetUs} US + ${targetCa} CA`)

  // Pull pool of source shipments from the last ~3 days, per country
  const threeDaysAgo = new Date(now.getTime() - 3 * 86400_000).toISOString()
  let totalShipments = 0
  let totalTx = 0
  let totalCare = 0

  for (const country of ['US', 'CA']) {
    const need = country === 'US' ? targetUs : targetCa
    const pool: any[] = []
    for (const cid of SOURCE_CLIENT_IDS) {
      let lastId: string | null = null
      let pages = 0
      while (pool.length < need * 3 && pages < 10) {
        let q = supabase
          .from('shipments')
          .select('id, shipment_id, order_id, tracking_id, tracking_url, carrier, carrier_service, ship_option_id, ship_option_name, zone_used, fc_name, actual_weight_oz, dim_weight_oz, billable_weight_oz, length, width, height, origin_country, destination_country, status, transit_time_days, event_created, event_picked, event_packed, event_labeled, event_labelvalidated, event_intransit, event_outfordelivery, event_delivered, created_at, updated_at, estimated_fulfillment_date, estimated_delivery_date, insurance_value, last_update_at')
          .eq('client_id', cid)
          .eq('destination_country', country)
          .gte('created_at', threeDaysAgo)
          .order('id', { ascending: true })
          .limit(500)
        if (lastId) q = q.gt('id', lastId)
        const { data, error } = await q
        if (error || !data || data.length === 0) break
        pool.push(...data)
        lastId = data[data.length - 1].id
        if (data.length < 500) break
        pages++
      }
    }

    if (pool.length === 0) {
      console.log(`[refresh-demo] no source ${country} shipments in last 3 days, skipping`)
      continue
    }

    // Sample with replacement to hit need
    const selected = []
    for (let i = 0; i < need; i++) selected.push(pool[Math.floor(Math.random() * pool.length)])

    // Fetch source orders. Chunk size kept small (100) — PostgREST silently
    // drops .in() queries when URL exceeds ~16KB (500 UUIDs).
    const orderIds = [...new Set(selected.map(s => s.order_id).filter(Boolean))]
    const orderMap = new Map<string, any>()
    const CHUNK = 100
    for (let i = 0; i < orderIds.length; i += CHUNK) {
      const { data, error } = await supabase.from('orders').select('id, city, state, zip_code, country, channel_name, channel_id, shipping_method, order_type, application_name').in('id', orderIds.slice(i, i + CHUNK))
      if (error) { console.warn('[refresh-demo] orderMap chunk error:', error.message); continue }
      for (const r of data || []) orderMap.set(r.id, r)
    }

    const orderRows: any[] = []
    const orderItemRows: any[] = []
    const shipmentRows: any[] = []
    const shipmentItemRows: any[] = []
    const txRows: any[] = []

    for (const src of selected) {
      const o = orderMap.get(src.order_id)
      const name = anonymizeName()
      const email = anonymizeEmail(name)
      const addr = anonymizeAddress()
      const phone = anonymizePhone(country)
      const orderUuid = crypto.randomUUID()
      const shipbobOrderId = nextOrderId()
      const shipmentId = nextShipmentId()

      // Shift timestamps so today's shipments look like today
      const origCreated = new Date(src.created_at)
      const shifted = new Date(now)
      shifted.setUTCHours(origCreated.getUTCHours(), origCreated.getUTCMinutes(), 0, 0)
      const deltaMs = shifted.getTime() - origCreated.getTime()
      const shift = (iso: string | null) => iso ? new Date(new Date(iso).getTime() + deltaMs).toISOString() : null

      const products = pickProductsForOrder()
      let orderTotal = 0
      products.forEach((p, idx) => {
        orderTotal += p.price * p.qty
        orderItemRows.push({
          id: crypto.randomUUID(), client_id: DEMO_CLIENT_ID, order_id: orderUuid, merchant_id: DEMO_MERCHANT,
          shipbob_product_id: p.id, sku: p.sku, quantity: p.qty, unit_price: p.price,
          external_line_id: idx + 1, created_at: shift(src.created_at),
        })
        shipmentItemRows.push({
          id: crypto.randomUUID(), client_id: DEMO_CLIENT_ID, merchant_id: DEMO_MERCHANT, shipment_id: shipmentId,
          shipbob_product_id: p.id, sku: p.sku, name: p.name, quantity: p.qty, is_dangerous_goods: false, serial_numbers: [],
          created_at: shift(src.created_at),
        })
      })

      orderRows.push({
        id: orderUuid, client_id: DEMO_CLIENT_ID, merchant_id: DEMO_MERCHANT, shipbob_order_id: shipbobOrderId,
        store_order_id: `PB-${randInt(100000, 999999)}`,
        customer_name: name, customer_email: email, customer_phone: phone,
        order_import_date: shift(src.created_at), purchase_date: shift(src.created_at),
        status: src.status || 'Completed',
        city: o?.city, state: o?.state, zip_code: o?.zip_code, country,
        address1: addr, total_price: orderTotal, total_shipments: 1,
        channel_name: o?.channel_name || 'Shopify', channel_id: o?.channel_id,
        shipping_method: o?.shipping_method || src.ship_option_name,
        order_type: o?.order_type || 'DTC', application_name: o?.application_name || 'Shopify',
        tags: [], shopify_tags: [],
        created_at: shift(src.created_at), updated_at: shift(src.updated_at || src.created_at),
      })

      shipmentRows.push({
        id: crypto.randomUUID(), client_id: DEMO_CLIENT_ID, merchant_id: DEMO_MERCHANT, order_id: orderUuid,
        shipment_id: shipmentId, shipbob_order_id: shipbobOrderId, tracking_id: src.tracking_id,
        tracking_url: src.tracking_url, status: src.status || 'Completed',
        transit_time_days: src.transit_time_days, carrier: src.carrier, carrier_service: src.carrier_service,
        ship_option_id: src.ship_option_id, ship_option_name: src.ship_option_name, zone_used: src.zone_used,
        fc_name: src.fc_name, actual_weight_oz: src.actual_weight_oz, dim_weight_oz: src.dim_weight_oz,
        billable_weight_oz: src.billable_weight_oz, length: src.length, width: src.width, height: src.height,
        origin_country: src.origin_country, destination_country: src.destination_country,
        recipient_name: name, recipient_email: email, recipient_phone: phone,
        insurance_value: src.insurance_value,
        estimated_fulfillment_date: shift(src.estimated_fulfillment_date),
        estimated_delivery_date: shift(src.estimated_delivery_date),
        event_created: shift(src.event_created), event_picked: shift(src.event_picked),
        event_packed: shift(src.event_packed), event_labeled: shift(src.event_labeled),
        event_labelvalidated: shift(src.event_labelvalidated), event_intransit: shift(src.event_intransit),
        event_outfordelivery: shift(src.event_outfordelivery), event_delivered: shift(src.event_delivered),
        last_update_at: shift(src.last_update_at || src.updated_at),
        order_type: o?.order_type || 'DTC', channel_name: o?.channel_name || 'Shopify',
        application_name: o?.application_name || 'Shopify', tags: [],
        created_at: shift(src.created_at), updated_at: shift(src.updated_at || src.created_at),
      })

      // Synthesize transactions
      const baseCost = 3 + Math.random() * 6 + (src.billable_weight_oz || 8) * 0.05
      const surcharge = Math.random() < 0.25 ? Math.random() * 2 : 0
      const markupPct = 15
      const baseCharge = +(baseCost * (1 + markupPct / 100)).toFixed(2)
      const totalCharge = +(baseCharge + surcharge).toFixed(2)
      txRows.push({
        id: crypto.randomUUID(), client_id: DEMO_CLIENT_ID, merchant_id: DEMO_MERCHANT,
        transaction_id: demoTxId(), reference_id: shipmentId, reference_type: 'Shipment',
        cost: +baseCost.toFixed(2), base_cost: +baseCost.toFixed(2), surcharge: +surcharge.toFixed(2),
        base_charge: baseCharge, total_charge: totalCharge, billed_amount: totalCharge,
        markup_applied: +(totalCharge - baseCost - surcharge).toFixed(2), markup_percentage: markupPct,
        markup_is_preview: false, is_voided: false, currency_code: 'USD',
        charge_date: (shift(src.event_labeled || src.created_at) as string).split('T')[0],
        fee_type: 'Shipping', transaction_type: 'Charge', fulfillment_center: src.fc_name,
        tracking_id: src.tracking_id, invoiced_status_sb: true, invoiced_status_jp: false,
        created_at: shift(src.created_at), updated_at: shift(src.updated_at || src.created_at),
      })
    }

    // Insert batches
    const BATCH = 500
    for (let i = 0; i < orderRows.length; i += BATCH) await supabase.from('orders').insert(orderRows.slice(i, i + BATCH))
    for (let i = 0; i < shipmentRows.length; i += BATCH) await supabase.from('shipments').insert(shipmentRows.slice(i, i + BATCH))
    for (let i = 0; i < orderItemRows.length; i += BATCH) await supabase.from('order_items').insert(orderItemRows.slice(i, i + BATCH))
    for (let i = 0; i < shipmentItemRows.length; i += BATCH) await supabase.from('shipment_items').insert(shipmentItemRows.slice(i, i + BATCH))
    for (let i = 0; i < txRows.length; i += BATCH) await supabase.from('transactions').insert(txRows.slice(i, i + BATCH))
    totalShipments += shipmentRows.length
    totalTx += txRows.length
  }

  // === Care ticket lifecycle ===
  totalCare = await advanceCareLifecycle(supabase, DEMO_CLIENT_ID)

  const duration = Date.now() - startTime
  console.log(`[refresh-demo] done in ${duration}ms: +${totalShipments} shipments, +${totalTx} tx, ${totalCare} care changes`)
  return NextResponse.json({ success: true, duration, shipments: totalShipments, transactions: totalTx, care: totalCare })
}

async function advanceCareLifecycle(supabase: ReturnType<typeof createAdminClient>, demoClientId: string): Promise<number> {
  let changes = 0

  // Advance Under Review → Credit Requested (10%)
  const { data: ur } = await supabase.from('care_tickets').select('id, events, credit_amount').eq('client_id', demoClientId).eq('status', 'Under Review').limit(200)
  for (const t of ur || []) {
    if (Math.random() > 0.10) continue
    const events = [{
      note: 'Credit request has been sent to the warehouse team for review.',
      status: 'Credit Requested', createdAt: new Date().toISOString(), createdBy: 'System',
    }, ...(t.events || [])]
    await supabase.from('care_tickets').update({ status: 'Credit Requested', events, updated_at: new Date().toISOString() }).eq('id', t.id)
    changes++
  }

  // Credit Requested → Credit Approved (20%)
  const { data: cr } = await supabase.from('care_tickets').select('id, events, credit_amount').eq('client_id', demoClientId).eq('status', 'Credit Requested').limit(200)
  for (const t of cr || []) {
    if (Math.random() > 0.20) continue
    const amount = t.credit_amount || +(Math.random() * 40 + 10).toFixed(2)
    const events = [{
      note: `A credit of $${amount.toFixed(2)} has been approved and will appear on your next invoice.`,
      status: 'Credit Approved', createdAt: new Date().toISOString(), createdBy: 'System',
    }, ...(t.events || [])]
    await supabase.from('care_tickets').update({ status: 'Credit Approved', credit_amount: amount, events, updated_at: new Date().toISOString() }).eq('id', t.id)
    changes++
  }

  // Credit Approved → Resolved (15%)
  const { data: ca } = await supabase.from('care_tickets').select('id, events, credit_amount').eq('client_id', demoClientId).eq('status', 'Credit Approved').limit(200)
  for (const t of ca || []) {
    if (Math.random() > 0.15) continue
    const amount = t.credit_amount || 20
    const events = [{
      note: `Your credit of $${amount.toFixed(2)} has been applied to your next invoice.`,
      status: 'Resolved', createdAt: new Date().toISOString(), createdBy: 'System',
    }, ...(t.events || [])]
    await supabase.from('care_tickets').update({ status: 'Resolved', events, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', t.id)
    changes++
  }

  return changes
}

export async function GET(request: NextRequest) { return POST(request) }
