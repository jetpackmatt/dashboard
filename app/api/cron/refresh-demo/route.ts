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
  const monthlyUs = Math.round(7000 * growthFactor)
  const monthlyCa = Math.round(2000 * growthFactor)
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
        estimated_fulfillment_date_status: Math.random() < 0.90 ? 'FulfilledOnTime' : (Math.random() < 0.80 ? 'FulfilledLate' : 'AwaitingInventoryAllocation'),
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

  // === Advance demo shipment event timestamps (labeled → intransit → delivered) ===
  const progressed = await progressShipmentEvents(supabase, DEMO_CLIENT_ID)

  // === Synthetic Delivery IQ churn (new entries + status evolution) ===
  const diqChanges = await advanceDeliveryIQ(supabase, DEMO_CLIENT_ID)

  // === Care ticket lifecycle (+ credit transactions for newly-Approved tickets) ===
  const { changes: totalCareChanges, credits: creditsCreated } = await advanceCareLifecycle(supabase, DEMO_CLIENT_ID, DEMO_MERCHANT)
  totalCare = totalCareChanges

  // === Weekly invoice (only on Mondays) ===
  let invoiceCreated = false
  if (now.getUTCDay() === 1) {
    invoiceCreated = await generateWeeklyInvoice(supabase, DEMO_CLIENT_ID)
  }

  const duration = Date.now() - startTime
  console.log(`[refresh-demo] done in ${duration}ms: +${totalShipments} ships, +${totalTx} tx, ${progressed.delivered} delivered, ${progressed.inTransit} in-transit, ${diqChanges.added} DIQ+, ${diqChanges.updated} DIQ~, ${totalCare} care, ${creditsCreated} credits, invoice=${invoiceCreated}`)
  return NextResponse.json({
    success: true, duration,
    shipments: totalShipments, transactions: totalTx,
    shipmentsProgressed: progressed,
    diqChanges, care: totalCare, credits: creditsCreated,
    invoiceGenerated: invoiceCreated,
  })
}

// ========== Shipment event progression ==========
// Walk stationary demo shipments forward through event stages based on elapsed
// time since event_labeled. No external calls — pure time-based simulation.
async function progressShipmentEvents(
  supabase: ReturnType<typeof createAdminClient>,
  demoClientId: string
): Promise<{ inTransit: number; outForDelivery: number; delivered: number }> {
  const result = { inTransit: 0, outForDelivery: 0, delivered: 0 }
  const nowIso = new Date().toISOString()

  // Fetch shipments still in-progress (labeled, not delivered)
  const { data: ships, error } = await supabase
    .from('shipments')
    .select('id, shipment_id, event_labeled, event_intransit, event_outfordelivery, event_delivered, destination_country')
    .eq('client_id', demoClientId)
    .not('event_labeled', 'is', null)
    .is('event_delivered', null)
    .limit(2000)
  if (error) { console.warn('[progress] fetch error:', error.message); return result }

  const updates: { id: string; patch: any }[] = []
  for (const s of ships || []) {
    const labeledAt = new Date(s.event_labeled).getTime()
    const hoursSinceLabeled = (Date.now() - labeledAt) / 3600_000
    const daysSinceLabeled = hoursSinceLabeled / 24
    const isIntl = s.destination_country === 'CA'
    const intransitAfterH = 12 + Math.random() * 36  // 12-48h
    const outForDeliveryAfterD = isIntl ? (4 + Math.random() * 3) : (2 + Math.random() * 2)  // 2-4d US, 4-7d CA
    const deliveredAfterD = isIntl ? (5 + Math.random() * 3) : (3 + Math.random() * 2)       // 3-5d US, 5-8d CA

    // Never emit future timestamps — cap at now.
    const nowMs = Date.now()
    const patch: any = {}
    if (!s.event_intransit && hoursSinceLabeled >= intransitAfterH) {
      patch.event_intransit = new Date(Math.min(labeledAt + intransitAfterH * 3600_000, nowMs)).toISOString()
      result.inTransit++
    }
    if (!s.event_outfordelivery && daysSinceLabeled >= outForDeliveryAfterD) {
      patch.event_outfordelivery = new Date(Math.min(labeledAt + outForDeliveryAfterD * 86400_000, nowMs)).toISOString()
      result.outForDelivery++
    }
    if (!s.event_delivered && daysSinceLabeled >= deliveredAfterD) {
      // Leave a small slice (~2%) of shipments persistently undelivered (lost / stuck)
      // so Delivery IQ has a steady pipeline of at_risk candidates.
      if (Math.random() < 0.02) continue
      const deliveredAtMs = Math.min(labeledAt + deliveredAfterD * 86400_000, nowMs)
      const deliveredAt = new Date(deliveredAtMs)
      patch.event_delivered = deliveredAt.toISOString()
      patch.transit_time_days = +((deliveredAtMs - labeledAt) / 86400_000).toFixed(1)
      patch.last_update_at = deliveredAt.toISOString()
      result.delivered++
    }
    if (Object.keys(patch).length > 0) updates.push({ id: s.id, patch: { ...patch, updated_at: nowIso } })
  }

  // Apply in chunks
  for (let i = 0; i < updates.length; i += 100) {
    const chunk = updates.slice(i, i + 100)
    await Promise.all(chunk.map(u => supabase.from('shipments').update(u.patch).eq('id', u.id)))
  }
  return result
}

// ========== Delivery IQ churn ==========
// Add new DIQ rows for aged demo shipments AND evolve existing DIQ statuses.
async function advanceDeliveryIQ(
  supabase: ReturnType<typeof createAdminClient>,
  demoClientId: string
): Promise<{ added: number; updated: number; removed: number }> {
  const result = { added: 0, updated: 0, removed: 0 }

  // --- Add new DIQ entries for shipments labeled 15+ days ago and still undelivered ---
  const cutoff = new Date(Date.now() - 15 * 86400_000).toISOString()
  const { data: candidates } = await supabase
    .from('shipments')
    .select('shipment_id, tracking_id, carrier, destination_country, event_labeled')
    .eq('client_id', demoClientId)
    .is('event_delivered', null)
    .not('event_labeled', 'is', null)
    .lt('event_labeled', cutoff)
    .not('tracking_id', 'is', null)
    .limit(500)
  const shipmentIds = (candidates || []).map((c: any) => c.shipment_id)
  const { data: existing } = await supabase
    .from('lost_in_transit_checks')
    .select('shipment_id')
    .in('shipment_id', shipmentIds.length > 0 ? shipmentIds : ['__none__'])
  const existingSet = new Set((existing || []).map((e: any) => e.shipment_id))
  const diqRows = []
  for (const s of candidates || []) {
    if (existingSet.has(s.shipment_id)) continue
    if (Math.random() > 0.3) continue  // only some candidates get a DIQ entry
    const labeledAt = new Date(s.event_labeled!).getTime()
    const daysInTransit = Math.floor((Date.now() - labeledAt) / 86400_000)
    diqRows.push({
      shipment_id: s.shipment_id, tracking_number: s.tracking_id, carrier: s.carrier,
      client_id: demoClientId,
      checked_at: new Date().toISOString(),
      first_checked_at: new Date(labeledAt + 3 * 86400_000).toISOString(),
      last_recheck_at: new Date().toISOString(),
      eligible_after: new Date(labeledAt + 15 * 86400_000).toISOString().split('T')[0],
      is_international: s.destination_country === 'CA',
      claim_eligibility_status: daysInTransit >= 20 ? 'eligible' : 'at_risk',
      ai_status_badge: ['STUCK', 'STALLED', 'NORMAL'][Math.floor(Math.random() * 3)],
      watch_reason: ['STALLED', 'NO SCAN', 'NEEDS ACTION'][Math.floor(Math.random() * 3)],
      ai_reshipment_urgency: randInt(20, 95),
      ai_customer_anxiety: randInt(10, 90),
      ai_risk_level: ['LOW', 'MEDIUM', 'HIGH'][Math.floor(Math.random() * 3)],
      ai_predicted_outcome: ['delivered', 'lost', 'returned_to_sender'][Math.floor(Math.random() * 3)],
      days_in_transit: daysInTransit,
      stuck_duration_days: randInt(0, 10),
      last_scan_date: new Date(Date.now() - randInt(1, 10) * 86400_000).toISOString(),
      last_scan_description: ['In transit', 'Arrived at facility', 'Out for delivery attempt'][Math.floor(Math.random() * 3)],
      last_scan_location: ['Louisville KY', 'Atlanta GA', 'Memphis TN', 'Chicago IL'][Math.floor(Math.random() * 4)],
    })
  }
  if (diqRows.length > 0) {
    const { error } = await supabase.from('lost_in_transit_checks').insert(diqRows)
    if (!error) result.added = diqRows.length
    else console.warn('[diq-add]', error.message)
  }

  // --- Evolve existing DIQ statuses + remove delivered ones ---
  const { data: existing_diq } = await supabase
    .from('lost_in_transit_checks')
    .select('id, shipment_id, claim_eligibility_status, days_in_transit')
    .eq('client_id', demoClientId)
    .limit(500)
  for (const d of existing_diq || []) {
    // Check if corresponding shipment got delivered (via progressShipmentEvents above)
    const { data: ship } = await supabase
      .from('shipments')
      .select('event_delivered')
      .eq('client_id', demoClientId)
      .eq('shipment_id', d.shipment_id)
      .maybeSingle()
    if (ship?.event_delivered) {
      await supabase.from('lost_in_transit_checks').delete().eq('id', d.id)
      result.removed++
      continue
    }
    // Evolve at_risk → eligible (~15%), eligible → claim_filed (~10%), claim_filed → approved/denied (~20%)
    const cur = d.claim_eligibility_status
    let next: string | null = null
    if (cur === 'at_risk' && Math.random() < 0.15) next = 'eligible'
    else if (cur === 'eligible' && Math.random() < 0.10) next = 'claim_filed'
    else if (cur === 'claim_filed' && Math.random() < 0.20) next = Math.random() < 0.8 ? 'approved' : 'denied'
    if (next) {
      await supabase.from('lost_in_transit_checks').update({
        claim_eligibility_status: next,
        last_recheck_at: new Date().toISOString(),
        days_in_transit: (d.days_in_transit || 0) + 1,
      }).eq('id', d.id)
      result.updated++
    }
  }
  return result
}

// ========== Weekly invoice (Mondays) ==========
async function generateWeeklyInvoice(
  supabase: ReturnType<typeof createAdminClient>,
  demoClientId: string
): Promise<boolean> {
  // Period = previous Monday..Sunday
  const today = new Date()
  const periodEnd = new Date(today)
  periodEnd.setUTCDate(today.getUTCDate() - 1)  // yesterday (Sunday)
  periodEnd.setUTCHours(23, 59, 59, 999)
  const periodStart = new Date(periodEnd)
  periodStart.setUTCDate(periodStart.getUTCDate() - 6)
  periodStart.setUTCHours(0, 0, 0, 0)

  // Find un-invoiced demo transactions in that period
  const { data: txs } = await supabase
    .from('transactions')
    .select('id, transaction_id, cost, billed_amount, markup_applied, markup_percentage, fee_type, fulfillment_center, charge_date, reference_id')
    .eq('client_id', demoClientId)
    .is('invoice_id_jp', null)
    .gte('charge_date', periodStart.toISOString().split('T')[0])
    .lte('charge_date', periodEnd.toISOString().split('T')[0])
  if (!txs || txs.length === 0) return false

  const subtotal = txs.reduce((s: number, t: any) => s + Number(t.cost || 0), 0)
  const total = txs.reduce((s: number, t: any) => s + Number(t.billed_amount || 0), 0)
  const markup = total - subtotal

  // Build UI-compatible line items: one row per transaction with lineCategory
  const lineCategoryFor = (ft: string | null) => {
    if (ft === 'Shipping') return 'Shipping'
    if (ft === 'Pick') return 'Pick Fees'
    if (ft === 'Return') return 'Returns'
    if (ft === 'Receiving') return 'Receiving'
    if (ft === 'Storage') return 'Storage'
    if (ft === 'Credit') return 'Credits'
    return 'Additional Services'
  }
  const perTxItems = txs.map((t: any) => ({
    id: t.transaction_id,
    billingRecordId: t.transaction_id,
    feeType: t.fee_type,
    description: t.fee_type,
    baseAmount: Number(t.cost || 0),
    billedAmount: Number(t.billed_amount || 0),
    markupApplied: Number(t.markup_applied || 0),
    markupPercentage: Number(t.markup_percentage || 0),
    fcName: t.fulfillment_center,
    originCountry: 'US',
    transactionDate: t.charge_date,
    lineCategory: lineCategoryFor(t.fee_type),
    orderNumber: t.reference_id,
  }))
  const invoiceDate = new Date(today)
  const mm = String(invoiceDate.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(invoiceDate.getUTCDate()).padStart(2, '0')
  const yy = String(invoiceDate.getUTCFullYear()).slice(-2)
  const { data: lastInv } = await supabase.from('invoices_jetpack').select('invoice_number').eq('client_id', demoClientId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  const seq = lastInv ? (parseInt((lastInv.invoice_number || '').split('-')[1] || '0', 10) + 1) : 1
  const invoiceNumber = `JPPB-${String(seq).padStart(4, '0')}-${mm}${dd}${yy}`

  const { data: inserted, error } = await supabase.from('invoices_jetpack').insert({
    client_id: demoClientId, invoice_number: invoiceNumber,
    invoice_date: invoiceDate.toISOString().split('T')[0],
    period_start: periodStart.toISOString().split('T')[0],
    period_end: periodEnd.toISOString().split('T')[0],
    subtotal: +subtotal.toFixed(2), total_markup: +markup.toFixed(2), total_amount: +total.toFixed(2),
    status: 'sent', paid_status: 'unpaid',
    generated_at: invoiceDate.toISOString(), approved_at: invoiceDate.toISOString(),
    line_items_json: perTxItems, shipbob_invoice_ids: [], version: 1,
    created_at: invoiceDate.toISOString(), updated_at: invoiceDate.toISOString(),
  }).select('invoice_number').single()
  if (error) { console.warn('[weekly invoice]', error.message); return false }

  // Link transactions
  const ids = txs.map((t: any) => t.id)
  for (let i = 0; i < ids.length; i += 500) {
    await supabase.from('transactions').update({
      invoice_id_jp: inserted.invoice_number,
      invoice_date_jp: invoiceDate.toISOString(),
      invoiced_status_jp: true,
    }).in('id', ids.slice(i, i + 500))
  }
  return true
}

async function advanceCareLifecycle(
  supabase: ReturnType<typeof createAdminClient>,
  demoClientId: string,
  demoMerchant: string | null
): Promise<{ changes: number; credits: number }> {
  let changes = 0
  let credits = 0

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

  // Credit Requested → Credit Approved (20%) + insert a Credit transaction
  const { data: cr } = await supabase.from('care_tickets').select('id, events, credit_amount, shipment_id').eq('client_id', demoClientId).eq('status', 'Credit Requested').limit(200)
  for (const t of cr || []) {
    if (Math.random() > 0.20) continue
    const amount = t.credit_amount || +(Math.random() * 40 + 10).toFixed(2)
    const events = [{
      note: `A credit of $${amount.toFixed(2)} has been approved and will appear on your next invoice.`,
      status: 'Credit Approved', createdAt: new Date().toISOString(), createdBy: 'System',
    }, ...(t.events || [])]
    await supabase.from('care_tickets').update({ status: 'Credit Approved', credit_amount: amount, events, updated_at: new Date().toISOString() }).eq('id', t.id)
    changes++

    // Create a matching Credit transaction row tied to the shipment (negative billed_amount by convention)
    const creditId = `DEMO-CR-${Date.now().toString(36)}-${crypto.randomBytes(5).toString('hex')}`
    const { error: txErr } = await supabase.from('transactions').insert({
      client_id: demoClientId, merchant_id: demoMerchant, transaction_id: creditId,
      reference_id: t.shipment_id || null, reference_type: 'Shipment',
      cost: -amount, base_cost: -amount, surcharge: 0,
      base_charge: -amount, total_charge: -amount, billed_amount: -amount,
      markup_applied: 0, markup_percentage: 0, markup_is_preview: false, is_voided: false,
      currency_code: 'USD', charge_date: new Date().toISOString().split('T')[0],
      fee_type: 'Credit', transaction_type: 'Credit',
      care_ticket_id: t.id,
      invoiced_status_sb: true, invoiced_status_jp: false,
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    })
    if (!txErr) credits++
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

  return { changes, credits }
}

export async function GET(request: NextRequest) { return POST(request) }
