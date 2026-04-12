#!/usr/bin/env node
/**
 * Backfill 12 months of demo shipments, orders, items, and transactions
 * for Paul's Boutique by cloning from the 4 real ShipBob clients with
 * anonymized customer PII and randomized demo products.
 *
 * Volume model:
 *   - Current month (month 0): 3000 US + 1000 CA
 *   - Walk backward 12 months with randomized 3-8% MoM growth rate per country
 *   - Per-day variance: monthly/days ± random_int(3..77) per country
 *
 * Source data is sampled (with replacement if needed) from these real clients:
 *   Arterra Pet, Eli Health, Henson Shaving, Methyl-Life
 *
 * Cloning rules:
 *   NEW:        shipment_id (DEMO-*), shipbob_order_id (DEMO-*), id (uuid)
 *   ANONYMIZED: customer_name, customer_email, address1, customer_phone
 *   PRESERVED:  city, state, zip, country, carrier, ship_option, zone,
 *               fc_name, tracking_id (for real carrier links), all event_*
 *               timestamps, transit_time_days, weights, dimensions
 *
 * Usage:
 *   node scripts/backfill-demo-shipments.js <DEMO_CLIENT_ID>
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const crypto = require('crypto')

const DEMO_CLIENT_ID = process.argv[2]
if (!DEMO_CLIENT_ID) {
  console.error('Usage: node backfill-demo-shipments.js <DEMO_CLIENT_ID>')
  process.exit(1)
}

const DEMO_MERCHANT_ID = 'DEMO-MERCHANT-001'
const SOURCE_CLIENT_IDS = [
  '78854d47-a4eb-4bc1-af16-f2ac624cdc9d', // Arterra Pet
  'e6220921-695e-41f9-9f49-af3e0cdc828a', // Eli Health
  '6b94c274-0446-4167-9d02-b998f8be59ad', // Henson Shaving
  'ca33dd0e-bd81-4ff7-88d1-18a3caf81d8e', // Methyl-Life
]

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

// ============ UTILITIES ============

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min
}

function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)]
}

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

// 9-digit numeric IDs in reserved demo range (700000000-899999999).
// Real ShipBob IDs are in the 300M-400M range so 7xxM / 8xxM is collision-free
// with production. Use a COUNTER (not random) to also avoid intra-demo
// birthday-paradox collisions at ~40K shipments.
// Shipment IDs: 700000000+   Order IDs: 800000000+
let _shipmentCounter = 700_000_000
let _orderCounter    = 800_000_000
function nextShipmentId() { return String(_shipmentCounter++) }
function nextOrderId()    { return String(_orderCounter++) }
// Transactions aren't shown to users; keep ULID-style (always unique).
function demoTxId() {
  return `DEMO-TX-${Date.now().toString(36)}-${crypto.randomBytes(6).toString('hex')}`
}

// Volume calc: walk backward from current month
function computeMonthlyTargets(monthsBack = 12) {
  // month 0 = current month, month -12 = oldest
  const targets = {}
  let us = 7000   // current-month baseline
  let ca = 2000
  targets[0] = { us, ca }
  for (let m = 1; m <= monthsBack; m++) {
    const growthUs = 0.03 + Math.random() * 0.05  // 3-8%
    const growthCa = 0.03 + Math.random() * 0.05
    us = Math.round(us / (1 + growthUs))
    ca = Math.round(ca / (1 + growthCa))
    targets[-m] = { us, ca }
  }
  return targets
}

// Realistic daily variance; never round numbers
function dailyCount(monthlyTotal, daysInMonth) {
  const baseline = monthlyTotal / daysInMonth
  for (;;) {
    const magnitude = randInt(3, 77)
    const sign = Math.random() < 0.5 ? -1 : 1
    const v = Math.max(1, Math.round(baseline + sign * magnitude))
    // Reject round numbers (exact multiples of 10 and baseline)
    if (v % 10 !== 0 || Math.random() < 0.15) return v
  }
}

// Fake identity pools (mixed real + realistic variations; no real PII)
const FIRST_NAMES = ['James','Emma','Liam','Olivia','Noah','Ava','Lucas','Mia','Ethan','Isabella','Mason','Sophia','Logan','Charlotte','Alexander','Amelia','Benjamin','Harper','Jackson','Evelyn','Owen','Abigail','Daniel','Emily','Sebastian','Elizabeth','Henry','Sofia','Carter','Avery','Elijah','Ella','Michael','Scarlett','Gabriel','Grace','William','Chloe','David','Victoria','Joseph','Riley','Samuel','Aria','John','Lily','Wyatt','Aubrey','Julian','Zoey','Luke','Penelope','Anthony','Layla','Dylan','Claire','Aiden','Hannah','Caleb','Nora','Matthew','Lillian','Isaac','Addison','Joshua','Eleanor','Andrew','Natalie','Nathan','Luna','Christian','Savannah','Ryan','Brooklyn','Leo','Leah','Adrian','Zoe','Isaiah','Stella','Charles','Hazel','Thomas','Ellie','Aaron','Paisley','Eli','Audrey','Cameron','Skylar','Connor','Violet','Jeremiah','Claire','Ezra','Bella','Josiah','Aurora','Hunter','Lucy','Easton','Anna','Levi','Samantha','Austin','Caroline','Ian','Genesis','Adam','Aaliyah','Brandon','Kennedy','Xavier','Kinsley','Silas','Allison','Jose','Maya','Cooper','Sarah','Tyler','Madelyn','Evan','Adeline','Nolan','Alexa','Hudson','Ariana','Jason','Elena','Sam','Gabriella','Jordan','Naomi','Kevin','Alice','Jayden','Sadie','Zachary','Hailey']
const LAST_NAMES = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts','Gomez','Phillips','Evans','Turner','Diaz','Parker','Cruz','Edwards','Collins','Reyes','Stewart','Morris','Morales','Murphy','Cook','Rogers','Gutierrez','Ortiz','Morgan','Cooper','Peterson','Bailey','Reed','Kelly','Howard','Ramos','Kim','Cox','Ward','Richardson','Watson','Brooks','Chavez','Wood','James','Bennett','Gray','Mendoza','Ruiz','Hughes','Price','Alvarez','Castillo','Sanders','Patel','Myers','Long','Ross','Foster','Jimenez']

const ADDRESS_STREETS = ['Main St','Oak Ave','Maple Dr','Pine Rd','Cedar Ln','Elm St','Washington Ave','Park Blvd','Lake Dr','River Rd','Broadway','Highland Ave','Fairview St','Sunset Blvd','Hill St','Market St','Church St','Spring St','Center Ave','School Rd','Meadow Ln','Willow Dr','Cherry St','Walnut Ave','Birch St','Poplar Rd','Forest Dr','Valley Rd','Ridge St','Mountain View','Cottage Ave','Garden St','Grove Pl','Harbor Blvd','Beach Ave','Ocean Dr','Bay Rd','Pacific Ave','Atlantic Ave','Lincoln St','Jefferson Rd','Madison Ave','Adams St','Jackson Blvd','Kennedy Dr','Eisenhower Way']

function anonymizeName() {
  return `${randomChoice(FIRST_NAMES)} ${randomChoice(LAST_NAMES)}`
}

function anonymizeEmail(name) {
  const [first, last] = name.toLowerCase().split(' ')
  const suffix = randInt(10, 999)
  return `${first}.${last}${suffix}@example.com`
}

function anonymizeAddress() {
  return `${randInt(10, 9999)} ${randomChoice(ADDRESS_STREETS)}${Math.random() < 0.2 ? ' Apt ' + randInt(1, 999) : ''}`
}

function anonymizePhone(country) {
  if (country === 'CA') {
    const areaCodes = ['416','437','647','705','819','450','514','613']
    return `${randomChoice(areaCodes)}-${randInt(100,999)}-${randInt(1000,9999)}`
  }
  return `555-${randInt(100, 999)}-${randInt(1000, 9999)}`
}

// ============ DEMO PRODUCTS ============
// Must match seed-demo.js shipbob_product_id range 900001-900020
const PRODUCTS = [
  { id: 900001, sku: 'PB-ACS-LT',  name: 'Acoustic Guitar Strings - Light Gauge',   cat: 'strings', price: 9.99,  weight: 0.12 },
  { id: 900002, sku: 'PB-ACS-MD',  name: 'Acoustic Guitar Strings - Medium Gauge',  cat: 'strings', price: 9.99,  weight: 0.14 },
  { id: 900003, sku: 'PB-ELE-09',  name: 'Electric Guitar Strings - 9s',            cat: 'strings', price: 7.99,  weight: 0.10 },
  { id: 900004, sku: 'PB-ELE-10',  name: 'Electric Guitar Strings - 10s',           cat: 'strings', price: 7.99,  weight: 0.11 },
  { id: 900005, sku: 'PB-ELE-11',  name: 'Electric Guitar Strings - 11s',           cat: 'strings', price: 8.99,  weight: 0.12 },
  { id: 900006, sku: 'PB-CLS-NYL', name: 'Classical Guitar Nylon Strings',          cat: 'strings', price: 12.99, weight: 0.09 },
  { id: 900007, sku: 'PB-BAS-4',   name: 'Bass Guitar Strings - 4-String',          cat: 'strings', price: 22.99, weight: 0.22 },
  { id: 900008, sku: 'PB-BAS-5',   name: 'Bass Guitar Strings - 5-String',          cat: 'strings', price: 27.99, weight: 0.28 },
  { id: 900009, sku: 'PB-PIK-LT',  name: 'Celluloid Picks - Light 12-Pack',         cat: 'picks',   price: 4.99,  weight: 0.03 },
  { id: 900010, sku: 'PB-PIK-MD',  name: 'Celluloid Picks - Medium 12-Pack',        cat: 'picks',   price: 4.99,  weight: 0.03 },
  { id: 900011, sku: 'PB-PIK-HV',  name: 'Celluloid Picks - Heavy 12-Pack',         cat: 'picks',   price: 4.99,  weight: 0.03 },
  { id: 900012, sku: 'PB-PIK-VAR', name: 'Pick Variety Pack - 24 Assorted',         cat: 'picks',   price: 9.99,  weight: 0.06 },
  { id: 900013, sku: 'PB-POL-OIL', name: 'Fretboard Conditioner Oil - 2oz',         cat: 'polish',  price: 8.99,  weight: 0.25 },
  { id: 900014, sku: 'PB-POL-SPR', name: 'Guitar Polish Spray - 4oz',               cat: 'polish',  price: 7.99,  weight: 0.32 },
  { id: 900015, sku: 'PB-POL-CLN', name: 'String Cleaner & Lubricant',              cat: 'polish',  price: 6.99,  weight: 0.18 },
  { id: 900016, sku: 'PB-TOO-CAP', name: 'Trigger Capo - Black',                    cat: 'tools',   price: 14.99, weight: 0.20 },
  { id: 900017, sku: 'PB-TOO-TUN', name: 'Clip-On Chromatic Tuner',                 cat: 'tools',   price: 11.99, weight: 0.15 },
  { id: 900018, sku: 'PB-TOO-WND', name: 'String Winder & Cutter Combo',            cat: 'tools',   price: 5.99,  weight: 0.12 },
  { id: 900019, sku: 'PB-STR-BLK', name: 'Woven Guitar Strap - Black/Red',          cat: 'straps',  price: 19.99, weight: 0.30 },
  { id: 900020, sku: 'PB-CAB-10F', name: 'Instrument Cable - 10ft 1/4"',            cat: 'cables',  price: 15.99, weight: 0.45 },
]

// Weighted sampling: strings 40%, picks 25%, polish 15%, tools/straps/cables 20%
const CATEGORY_WEIGHTS = { strings: 40, picks: 25, polish: 15, tools: 12, straps: 4, cables: 4 }
const WEIGHTED_PRODUCTS = []
for (const p of PRODUCTS) {
  const weight = CATEGORY_WEIGHTS[p.cat] || 5
  for (let i = 0; i < weight; i++) WEIGHTED_PRODUCTS.push(p)
}

function pickProducts() {
  const n = randomChoice([1, 1, 1, 2, 2, 3]) // weighted 1-item heavy
  const chosen = []
  for (let i = 0; i < n; i++) chosen.push(randomChoice(WEIGHTED_PRODUCTS))
  return chosen
}

// ============ CORE ============

// Fetch source shipments for a date range (paginated by UUID id).
// If `anyDate=true`, ignore monthStart/monthEnd and pull from the most recent
// window we have data for (used to date-shift into months with no source data).
async function fetchSourceShipments(monthStart, monthEnd, country, need, anyDate = false) {
  const pool = []
  for (const cid of SOURCE_CLIENT_IDS) {
    let lastId = null
    let pageCount = 0
    while (pool.length < need * 3 && pageCount < 30) {
      let q = supabase
        .from('shipments')
        .select(
          'id, shipment_id, order_id, tracking_id, carrier, carrier_service, ship_option_id, ship_option_name, zone_used, fc_name, actual_weight_oz, dim_weight_oz, billable_weight_oz, length, width, height, origin_country, destination_country, status, transit_time_days, event_created, event_picked, event_packed, event_labeled, event_labelvalidated, event_intransit, event_outfordelivery, event_delivered, created_at, updated_at, estimated_fulfillment_date, estimated_delivery_date, tracking_url, insurance_value, last_update_at'
        )
        .eq('client_id', cid)
        .eq('destination_country', country)
        .order('id', { ascending: true })
        .limit(1000)
      if (!anyDate) {
        q = q.gte('created_at', monthStart).lt('created_at', monthEnd)
      }
      if (lastId) q = q.gt('id', lastId)
      const { data, error } = await q
      if (error) {
        console.warn(`  [source fetch] ${cid.slice(0, 8)}: ${error.message}`)
        break
      }
      if (!data || data.length === 0) break
      pool.push(...data)
      lastId = data[data.length - 1].id
      if (data.length < 1000) break
      pageCount++
    }
  }
  return pool
}

// Shift all timestamp fields on a source shipment so its created_at lands in
// the target month at roughly the same day-of-month and time-of-day.
function dateShiftShipment(src, targetMonthStart, targetMonthEnd) {
  const origCreated = new Date(src.created_at)
  const targetStart = new Date(targetMonthStart)
  const targetEnd = new Date(targetMonthEnd)
  const daysInTarget = Math.ceil((targetEnd - targetStart) / 86400_000)
  const origDayOfMonth = origCreated.getUTCDate()
  const targetDay = Math.min(origDayOfMonth, daysInTarget) - 1
  const newCreated = new Date(targetStart)
  newCreated.setUTCDate(targetStart.getUTCDate() + targetDay)
  newCreated.setUTCHours(origCreated.getUTCHours(), origCreated.getUTCMinutes(), 0, 0)
  const deltaMs = newCreated.getTime() - origCreated.getTime()
  const shiftField = (iso) => {
    if (!iso) return null
    return new Date(new Date(iso).getTime() + deltaMs).toISOString()
  }
  const shifted = { ...src }
  for (const k of [
    'created_at', 'updated_at', 'event_created', 'event_picked', 'event_packed',
    'event_labeled', 'event_labelvalidated', 'event_intransit', 'event_outfordelivery',
    'event_delivered', 'estimated_fulfillment_date', 'estimated_delivery_date',
    'last_update_at',
  ]) {
    shifted[k] = shiftField(shifted[k])
  }
  return shifted
}

// Fetch one source order per shipment (for city/state/zip).
// IMPORTANT: chunk size must stay small — PostgREST URL-length limit causes
// .in() with ~500 UUIDs (~18KB URL) to silently fail and return no data. Use 100.
async function fetchSourceOrders(orderUuids) {
  const ids = [...new Set(orderUuids.filter(Boolean))]
  if (ids.length === 0) return new Map()
  const map = new Map()
  const chunkSize = 100
  for (let i = 0; i < ids.length; i += chunkSize) {
    const chunk = ids.slice(i, i + chunkSize)
    const { data, error } = await supabase
      .from('orders')
      .select('id, city, state, zip_code, country, channel_name, channel_id, order_import_date, purchase_date, shipping_method, order_type, application_name')
      .in('id', chunk)
    if (error) {
      console.warn(`  [fetchSourceOrders] chunk ${i / chunkSize} failed: ${error.message}`)
      continue
    }
    for (const r of data || []) map.set(r.id, r)
  }
  return map
}

// Build demo rows for a batch of sampled source shipments
async function buildAndInsertBatch(sampledShipments) {
  const orderRows = []
  const orderItemRows = []
  const shipmentRows = []
  const shipmentItemRows = []
  const txRows = []

  const orderMap = await fetchSourceOrders(sampledShipments.map(s => s.order_id))

  for (const src of sampledShipments) {
    const srcOrder = orderMap.get(src.order_id)
    const country = src.destination_country || srcOrder?.country || 'US'
    const customerName = anonymizeName()
    const customerEmail = anonymizeEmail(customerName)
    const address1 = anonymizeAddress()
    const phone = anonymizePhone(country)

    const orderUuid = crypto.randomUUID()
    const shipbobOrderId = nextOrderId()
    const shipmentId = nextShipmentId()
    const now = new Date().toISOString()

    // Items: 1-3 random demo products. Dedupe by product id, sum quantities
    // (order_items UNIQUE on order_id+shipbob_product_id).
    const chosenProducts = pickProducts()
    const byProduct = new Map()
    for (const prod of chosenProducts) {
      const qty = Math.random() < 0.85 ? 1 : (Math.random() < 0.7 ? 2 : 3)
      const existing = byProduct.get(prod.id)
      if (existing) existing.qty += qty
      else byProduct.set(prod.id, { ...prod, qty })
    }
    let orderTotal = 0
    const lineItemLinks = []
    let lineIdx = 0
    for (const item of byProduct.values()) {
      orderTotal += item.price * item.qty
      lineItemLinks.push({ ...item, lineIdx: lineIdx++ })
    }

    orderRows.push({
      id: orderUuid,
      client_id: DEMO_CLIENT_ID,
      merchant_id: DEMO_MERCHANT_ID,
      shipbob_order_id: shipbobOrderId,
      store_order_id: `PB-${randInt(100000, 999999)}`,
      customer_name: customerName,
      customer_email: customerEmail,
      customer_phone: phone,
      order_import_date: srcOrder?.order_import_date || src.created_at,
      purchase_date: srcOrder?.purchase_date || src.created_at,
      status: src.status || 'Completed',
      city: srcOrder?.city || null,
      state: srcOrder?.state || null,
      zip_code: srcOrder?.zip_code || null,
      country,
      address1,
      address2: null,
      total_price: orderTotal,
      total_shipments: 1,
      channel_name: srcOrder?.channel_name || 'Shopify',
      channel_id: srcOrder?.channel_id || null,
      shipping_method: srcOrder?.shipping_method || src.ship_option_name,
      order_type: srcOrder?.order_type || 'DTC',
      application_name: srcOrder?.application_name || 'Shopify',
      tags: [],
      shopify_tags: [],
      created_at: src.created_at,
      updated_at: src.updated_at || now,
    })

    for (const li of lineItemLinks) {
      orderItemRows.push({
        id: crypto.randomUUID(),
        client_id: DEMO_CLIENT_ID,
        order_id: orderUuid,
        merchant_id: DEMO_MERCHANT_ID,
        shipbob_product_id: li.id,
        sku: li.sku,
        quantity: li.qty,
        unit_price: li.price,
        upc: null,
        external_line_id: li.lineIdx + 1,
        created_at: src.created_at,
      })
      shipmentItemRows.push({
        id: crypto.randomUUID(),
        client_id: DEMO_CLIENT_ID,
        merchant_id: DEMO_MERCHANT_ID,
        shipment_id: shipmentId,
        shipbob_product_id: li.id,
        sku: li.sku,
        name: li.name,
        quantity: li.qty,
        is_dangerous_goods: false,
        serial_numbers: [],
        created_at: src.created_at,
      })
    }

    shipmentRows.push({
      id: crypto.randomUUID(),
      client_id: DEMO_CLIENT_ID,
      merchant_id: DEMO_MERCHANT_ID,
      order_id: orderUuid,
      shipment_id: shipmentId,
      shipbob_order_id: shipbobOrderId,
      tracking_id: src.tracking_id, // REAL tracking id → carrier links work
      estimated_fulfillment_date_status: Math.random() < 0.90 ? 'FulfilledOnTime' : (Math.random() < 0.80 ? 'FulfilledLate' : 'AwaitingInventoryAllocation'),
      tracking_url: src.tracking_url,
      status: src.status || 'Completed',
      transit_time_days: src.transit_time_days,
      carrier: src.carrier,
      carrier_service: src.carrier_service,
      ship_option_id: src.ship_option_id,
      ship_option_name: src.ship_option_name,
      zone_used: src.zone_used,
      fc_name: src.fc_name,
      actual_weight_oz: src.actual_weight_oz,
      dim_weight_oz: src.dim_weight_oz,
      billable_weight_oz: src.billable_weight_oz,
      length: src.length,
      width: src.width,
      height: src.height,
      origin_country: src.origin_country,
      destination_country: src.destination_country,
      recipient_name: customerName,
      recipient_email: customerEmail,
      recipient_phone: phone,
      insurance_value: src.insurance_value,
      estimated_fulfillment_date: src.estimated_fulfillment_date,
      estimated_delivery_date: src.estimated_delivery_date,
      event_created: src.event_created,
      event_picked: src.event_picked,
      event_packed: src.event_packed,
      event_labeled: src.event_labeled,
      event_labelvalidated: src.event_labelvalidated,
      event_intransit: src.event_intransit,
      event_outfordelivery: src.event_outfordelivery,
      event_delivered: src.event_delivered,
      last_update_at: src.last_update_at || src.updated_at,
      order_type: srcOrder?.order_type || 'DTC',
      channel_name: srcOrder?.channel_name || 'Shopify',
      application_name: srcOrder?.application_name || 'Shopify',
      tags: [],
      created_at: src.created_at,
      updated_at: src.updated_at || now,
    })

    // === Transactions: synthesize a shipping charge + maybe a pick fee ===
    const chargeDate = (src.event_labeled || src.created_at || new Date().toISOString()).split('T')[0]
    const baseCost = 3 + Math.random() * 6 + (src.billable_weight_oz || 8) * 0.05
    const surcharge = Math.random() < 0.25 ? Math.random() * 2 : 0
    const markupPct = 15
    const baseCharge = +(baseCost * (1 + markupPct / 100)).toFixed(2)
    const totalCharge = +(baseCharge + surcharge).toFixed(2)
    const billedAmount = totalCharge

    // Shipping transaction
    txRows.push({
      id: crypto.randomUUID(),
      client_id: DEMO_CLIENT_ID,
      merchant_id: DEMO_MERCHANT_ID,
      transaction_id: demoTxId(),
      reference_id: shipmentId,
      reference_type: 'Shipment',
      cost: +baseCost.toFixed(2),
      base_cost: +baseCost.toFixed(2),
      surcharge: +surcharge.toFixed(2),
      base_charge: baseCharge,
      total_charge: totalCharge,
      billed_amount: billedAmount,
      markup_applied: +((billedAmount - baseCost - surcharge) || 0).toFixed(2),
      markup_percentage: markupPct,
      markup_is_preview: false,
      is_voided: false,
      currency_code: 'USD',
      charge_date: chargeDate,
      fee_type: 'Shipping',
      transaction_type: 'Charge',
      fulfillment_center: src.fc_name,
      tracking_id: src.tracking_id,
      invoiced_status_sb: true,
      invoiced_status_jp: false,
      created_at: src.created_at,
      updated_at: src.updated_at || now,
    })

    // Pick fee (for some shipments with extra items)
    const pickQty = lineItemLinks.reduce((s, x) => s + x.qty, 0)
    if (pickQty > 1 && Math.random() < 0.3) {
      const pickCost = 0.25 * (pickQty - 1)
      const pickBilled = +(pickCost * 1.15).toFixed(2)
      txRows.push({
        id: crypto.randomUUID(),
        client_id: DEMO_CLIENT_ID,
        merchant_id: DEMO_MERCHANT_ID,
        transaction_id: demoTxId(),
        reference_id: shipmentId,
        reference_type: 'Shipment',
        cost: +pickCost.toFixed(2),
        base_cost: +pickCost.toFixed(2),
        surcharge: 0,
        base_charge: pickBilled,
        total_charge: pickBilled,
        billed_amount: pickBilled,
        markup_applied: +(pickBilled - pickCost).toFixed(2),
        markup_percentage: markupPct,
        markup_is_preview: false,
        is_voided: false,
        currency_code: 'USD',
        charge_date: chargeDate,
        fee_type: 'Pick',
        transaction_type: 'Charge',
        fulfillment_center: src.fc_name,
        invoiced_status_sb: true,
        invoiced_status_jp: false,
        created_at: src.created_at,
        updated_at: src.updated_at || now,
      })
    }
  }

  // Batch insert in order — parents first, then children
  const BATCH = 500
  for (let i = 0; i < orderRows.length; i += BATCH) {
    const err = await supabase.from('orders').insert(orderRows.slice(i, i + BATCH))
    if (err.error) throw new Error(`orders: ${err.error.message}`)
  }
  for (let i = 0; i < shipmentRows.length; i += BATCH) {
    const err = await supabase.from('shipments').insert(shipmentRows.slice(i, i + BATCH))
    if (err.error) throw new Error(`shipments: ${err.error.message}`)
  }
  for (let i = 0; i < orderItemRows.length; i += BATCH) {
    const err = await supabase.from('order_items').insert(orderItemRows.slice(i, i + BATCH))
    if (err.error) throw new Error(`order_items: ${err.error.message}`)
  }
  for (let i = 0; i < shipmentItemRows.length; i += BATCH) {
    const err = await supabase.from('shipment_items').insert(shipmentItemRows.slice(i, i + BATCH))
    if (err.error) throw new Error(`shipment_items: ${err.error.message}`)
  }
  for (let i = 0; i < txRows.length; i += BATCH) {
    const err = await supabase.from('transactions').insert(txRows.slice(i, i + BATCH))
    if (err.error) throw new Error(`transactions: ${err.error.message}`)
  }

  return {
    orders: orderRows.length,
    shipments: shipmentRows.length,
    items: orderItemRows.length,
    tx: txRows.length,
  }
}

// Sample `need` shipments from a source pool, distributed by day within the month
function sampleByDay(pool, monthStart, monthEnd, monthlyNeed, country) {
  const startDate = new Date(monthStart)
  const endDate = new Date(monthEnd)
  const daysInMonth = Math.ceil((endDate - startDate) / 86400_000)
  const byDay = new Map()
  for (const s of pool) {
    const d = new Date(s.created_at).toISOString().split('T')[0]
    if (!byDay.has(d)) byDay.set(d, [])
    byDay.get(d).push(s)
  }

  const selected = []
  for (let i = 0; i < daysInMonth; i++) {
    const day = new Date(startDate.getTime() + i * 86400_000).toISOString().split('T')[0]
    const dailyTarget = dailyCount(monthlyNeed, daysInMonth)
    const available = shuffle(byDay.get(day) || [])
    if (available.length === 0) continue
    // Sample with replacement if needed
    for (let j = 0; j < dailyTarget; j++) {
      selected.push(available[j % available.length])
    }
  }
  return selected
}

async function main() {
  // Preflight: confirm demo client exists
  const { data: demo } = await supabase.from('clients').select('id, company_name, is_demo').eq('id', DEMO_CLIENT_ID).single()
  if (!demo || !demo.is_demo) {
    console.error('Demo client not found or not flagged is_demo. Run seed-demo.js first.')
    process.exit(1)
  }
  console.log(`\n🎸 Backfilling demo shipments for ${demo.company_name} (${DEMO_CLIENT_ID})\n`)

  // Check for existing demo data — idempotency
  const { count: existingShipments } = await supabase
    .from('shipments').select('*', { count: 'exact', head: true }).eq('client_id', DEMO_CLIENT_ID)
  if ((existingShipments || 0) > 100) {
    console.log(`⚠  Demo already has ${existingShipments} shipments.`)
    console.log('   To re-run: node scripts/purge-demo.js --execute first, then re-run seed + backfill.')
    process.exit(0)
  }

  const targets = computeMonthlyTargets(12)
  const monthLabels = Object.keys(targets).map(Number).sort((a, b) => a - b)

  // Print plan
  console.log('Monthly volume plan (US + CA):')
  let totalUs = 0, totalCa = 0
  for (const m of monthLabels) {
    const d = new Date(); d.setMonth(d.getMonth() + m); d.setDate(1)
    console.log(`  ${d.toISOString().slice(0, 7)}: ${targets[m].us.toLocaleString()} US + ${targets[m].ca.toLocaleString()} CA`)
    totalUs += targets[m].us; totalCa += targets[m].ca
  }
  console.log(`  ────────────────────────────────────`)
  console.log(`  TOTAL:    ${totalUs.toLocaleString()} US + ${totalCa.toLocaleString()} CA = ${(totalUs+totalCa).toLocaleString()} shipments\n`)

  const summary = { orders: 0, shipments: 0, items: 0, tx: 0 }
  for (const m of monthLabels) {
    const monthStartDate = new Date(); monthStartDate.setMonth(monthStartDate.getMonth() + m); monthStartDate.setDate(1); monthStartDate.setHours(0,0,0,0)
    const monthEndDate = new Date(monthStartDate); monthEndDate.setMonth(monthEndDate.getMonth() + 1)
    const monthStart = monthStartDate.toISOString()
    const monthEnd = monthEndDate.toISOString()
    const label = monthStartDate.toISOString().slice(0, 7)

    for (const country of ['US', 'CA']) {
      const need = targets[m][country.toLowerCase()]
      let pool = await fetchSourceShipments(monthStart, monthEnd, country, need)
      let dateShifted = false
      if (pool.length < need / 2) {
        // Not enough source data in this month — pull from any date and shift.
        pool = await fetchSourceShipments(null, null, country, need, true)
        dateShifted = true
      }
      if (pool.length === 0) {
        console.log(`  ${label} ${country}: no source shipments anywhere, skipping`)
        continue
      }
      // Sample flat-random from pool to hit the daily targets
      let sampled
      if (dateShifted) {
        // For shifted months, pick `need + variance` from pool (with replacement),
        // then date-shift each to land within monthStart..monthEnd.
        const daysInMonth = Math.ceil((new Date(monthEnd) - new Date(monthStart)) / 86400_000)
        const dailyTargets = []
        for (let i = 0; i < daysInMonth; i++) dailyTargets.push(dailyCount(need, daysInMonth))
        const total = dailyTargets.reduce((a, b) => a + b, 0)
        sampled = []
        for (let i = 0; i < total; i++) {
          const src = pool[i % pool.length]
          sampled.push(dateShiftShipment(src, monthStart, monthEnd))
        }
      } else {
        sampled = sampleByDay(pool, monthStart, monthEnd, need, country)
      }
      console.log(`  ${label} ${country}: pool=${pool.length} sampled=${sampled.length} target=${need}${dateShifted ? ' (date-shifted)' : ''}`)

      // Process in chunks to avoid huge memory/single insert
      const CHUNK = 500
      for (let i = 0; i < sampled.length; i += CHUNK) {
        const chunk = sampled.slice(i, i + CHUNK)
        const res = await buildAndInsertBatch(chunk)
        summary.orders += res.orders
        summary.shipments += res.shipments
        summary.items += res.items
        summary.tx += res.tx
        process.stdout.write(`    chunk ${i / CHUNK + 1}: +${res.shipments} shipments, +${res.tx} tx\r`)
      }
      console.log()
    }
  }

  console.log(`\n✅ Shipment backfill complete:`)
  console.log(`   Orders:      ${summary.orders.toLocaleString()}`)
  console.log(`   Shipments:   ${summary.shipments.toLocaleString()}`)
  console.log(`   Items:       ${summary.items.toLocaleString()} (order + shipment combined)`)
  console.log(`   Transactions: ${summary.tx.toLocaleString()}`)

  console.log(`\n📦 Generating ancillary data (storage, receiving, returns, DIQ)...`)
  const ancillary = await generateAncillaryData()
  console.log(`   Storage tx:    ${ancillary.storage}`)
  console.log(`   Receiving tx:  ${ancillary.receivingTx}   (receiving_orders: ${ancillary.receivingOrders})`)
  console.log(`   Returns tx:    ${ancillary.returnsTx}     (returns: ${ancillary.returns})`)
  console.log(`   Addl services: ${ancillary.additionalTx}`)
  console.log(`   DIQ entries:   ${ancillary.diqEntries}`)

  console.log(`\nNext: node scripts/backfill-demo-care.js ${DEMO_CLIENT_ID}`)
  console.log(`      node scripts/backfill-demo-invoices.js ${DEMO_CLIENT_ID}`)
}

// ============ ANCILLARY DATA ============
// Generates realistic ancillary data: storage, receiving, returns, additional
// services, and Delivery IQ entries from the already-inserted demo shipments.
async function generateAncillaryData() {
  const result = { storage: 0, receivingOrders: 0, receivingTx: 0, returns: 0, returnsTx: 0, additionalTx: 0, diqEntries: 0 }

  // Gather all demo shipments (needed for returns + DIQ sampling)
  const allShipments = []
  let lastId = null
  while (true) {
    let q = supabase.from('shipments')
      .select('id, shipment_id, shipbob_order_id, tracking_id, carrier, fc_name, event_labeled, event_delivered, created_at, destination_country')
      .eq('client_id', DEMO_CLIENT_ID)
      .order('id', { ascending: true }).limit(1000)
    if (lastId) q = q.gt('id', lastId)
    const { data } = await q
    if (!data || data.length === 0) break
    allShipments.push(...data)
    lastId = data[data.length - 1].id
    if (data.length < 1000) break
  }
  console.log(`   Loaded ${allShipments.length.toLocaleString()} demo shipments for ancillary generation`)

  // Determine month range
  const dates = allShipments.map(s => new Date(s.created_at)).filter(d => !isNaN(d))
  if (dates.length === 0) return result
  const minDate = new Date(Math.min(...dates))
  const maxDate = new Date(Math.max(...dates))
  const months = []
  const cursor = new Date(minDate.getFullYear(), minDate.getMonth(), 1)
  while (cursor <= maxDate) {
    months.push(new Date(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }

  const FC_NAMES = ['Twin Lakes (WI)', 'Fort Worth 3', 'Ontario 6 (CA)', 'Riverside (CA)', 'Elwood (IL)', 'Brampton (Ontario) 2', 'Trenton (NJ)', 'Wind Gap 2 (PA)']

  // === Storage + WRO + Additional services per month ===
  const storageRows = []
  const receivingOrderRows = []
  const receivingTxRows = []
  const additionalTxRows = []
  let receivingIdCounter = 900_000_001
  for (const monthStart of months) {
    const chargeDate = new Date(monthStart); chargeDate.setDate(28) // last week of month
    const dateStr = chargeDate.toISOString().split('T')[0]
    const monthIso = chargeDate.toISOString()

    // STORAGE — 1 monthly transaction, scales up over time
    const monthsAgo = Math.max(0, Math.round((Date.now() - monthStart.getTime()) / (30.4 * 86400_000)))
    const storageCost = +(400 + 20 * (12 - monthsAgo) + Math.random() * 150).toFixed(2)
    const storageBilled = +(storageCost * 1.15).toFixed(2)
    storageRows.push({
      id: crypto.randomUUID(), client_id: DEMO_CLIENT_ID, merchant_id: DEMO_MERCHANT_ID,
      transaction_id: demoTxId(), reference_id: null, reference_type: null,
      cost: storageCost, base_cost: storageCost, surcharge: 0,
      base_charge: storageBilled, total_charge: storageBilled, billed_amount: storageBilled,
      markup_applied: +(storageBilled - storageCost).toFixed(2), markup_percentage: 15,
      markup_is_preview: false, is_voided: false, currency_code: 'USD',
      charge_date: dateStr, fee_type: 'Storage', transaction_type: 'Charge',
      fulfillment_center: randomChoice(FC_NAMES),
      invoiced_status_sb: true, invoiced_status_jp: false,
      created_at: monthIso, updated_at: monthIso,
    })

    // RECEIVING (WRO) — 4 to 8 per month at varying sizes
    const wroCount = randInt(4, 8)
    for (let i = 0; i < wroCount; i++) {
      const wroId = receivingIdCounter++
      const wroDate = new Date(monthStart); wroDate.setDate(randInt(1, 27)); wroDate.setHours(randInt(8, 17), randInt(0, 59))
      const wroIso = wroDate.toISOString()
      const fc = randomChoice(FC_NAMES)
      const quantityReceived = randInt(50, 2000)
      receivingOrderRows.push({
        id: crypto.randomUUID(), client_id: DEMO_CLIENT_ID, merchant_id: DEMO_MERCHANT_ID,
        shipbob_receiving_id: wroId,
        purchase_order_number: `PO-${randInt(10000, 99999)}`,
        status: 'Completed', package_type: randomChoice(['Box', 'Pallet', 'Envelope']),
        box_packaging_type: 'Box',
        fc_name: fc, fc_country: 'US',
        expected_arrival_date: wroIso, insert_date: wroIso, last_updated_date: wroIso,
        inventory_quantities: [{ name: 'Guitar accessories', quantity: quantityReceived }],
        synced_at: wroIso,
      })
      const wroCost = +(15 + quantityReceived * 0.02 + Math.random() * 40).toFixed(2)
      const wroBilled = +(wroCost * 1.15).toFixed(2)
      receivingTxRows.push({
        id: crypto.randomUUID(), client_id: DEMO_CLIENT_ID, merchant_id: DEMO_MERCHANT_ID,
        transaction_id: demoTxId(), reference_id: String(wroId), reference_type: 'WRO',
        cost: wroCost, base_cost: wroCost, surcharge: 0,
        base_charge: wroBilled, total_charge: wroBilled, billed_amount: wroBilled,
        markup_applied: +(wroBilled - wroCost).toFixed(2), markup_percentage: 15,
        markup_is_preview: false, is_voided: false, currency_code: 'USD',
        charge_date: wroIso.split('T')[0], fee_type: 'Receiving', transaction_type: 'Charge',
        fulfillment_center: fc, invoiced_status_sb: true, invoiced_status_jp: false,
        created_at: wroIso, updated_at: wroIso,
      })
    }

    // ADDITIONAL SERVICES — a few small misc charges per month
    const addlCount = randInt(3, 10)
    for (let i = 0; i < addlCount; i++) {
      const addlDate = new Date(monthStart); addlDate.setDate(randInt(1, 27))
      const cost = +(5 + Math.random() * 80).toFixed(2)
      const billed = +(cost * 1.15).toFixed(2)
      additionalTxRows.push({
        id: crypto.randomUUID(), client_id: DEMO_CLIENT_ID, merchant_id: DEMO_MERCHANT_ID,
        transaction_id: demoTxId(), reference_id: null, reference_type: null,
        cost, base_cost: cost, surcharge: 0,
        base_charge: billed, total_charge: billed, billed_amount: billed,
        markup_applied: +(billed - cost).toFixed(2), markup_percentage: 15,
        markup_is_preview: false, is_voided: false, currency_code: 'USD',
        charge_date: addlDate.toISOString().split('T')[0],
        fee_type: randomChoice(['Special Project', 'VAS', 'Case Pick', 'B2B Label']),
        transaction_type: 'Charge', fulfillment_center: randomChoice(FC_NAMES),
        invoiced_status_sb: true, invoiced_status_jp: false,
        created_at: addlDate.toISOString(), updated_at: addlDate.toISOString(),
      })
    }
  }

  // === RETURNS — ~3% of shipments ===
  const returnRows = []
  const returnsTxRows = []
  let returnIdCounter = 950_000_001
  const returnCandidates = allShipments.filter(s => s.event_delivered && Math.random() < 0.03)
  for (const s of returnCandidates) {
    const retId = returnIdCounter++
    const delivered = new Date(s.event_delivered)
    const requestedAt = new Date(delivered.getTime() + randInt(1, 30) * 86400_000)
    const arrivedAt = new Date(requestedAt.getTime() + randInt(3, 14) * 86400_000)
    const processedAt = new Date(arrivedAt.getTime() + randInt(1, 5) * 86400_000)
    const completedAt = new Date(processedAt.getTime() + randInt(1, 3) * 86400_000)
    const invAmt = +(10 + Math.random() * 60).toFixed(2)
    returnRows.push({
      id: crypto.randomUUID(), client_id: DEMO_CLIENT_ID, merchant_id: DEMO_MERCHANT_ID,
      shipbob_return_id: retId,
      reference_id: s.shipment_id,
      status: 'Completed', return_type: randomChoice(['Return', 'Refund']),
      tracking_number: `RET${randInt(100000000, 999999999)}`,
      shipment_tracking_number: s.tracking_id,
      original_shipment_id: Number(s.shipment_id),
      store_order_id: `PB-${randInt(100000, 999999)}`,
      invoice_amount: invAmt, invoice_currency: 'USD',
      fc_name: s.fc_name, channel_name: 'Shopify',
      insert_date: requestedAt.toISOString(),
      awaiting_arrival_date: requestedAt.toISOString(),
      arrived_date: arrivedAt.toISOString(),
      processing_date: processedAt.toISOString(),
      completed_date: completedAt.toISOString(),
      status_history: [], inventory: [], synced_at: completedAt.toISOString(),
    })
    const retCost = +(2.5 + Math.random() * 4).toFixed(2)
    const retBilled = +(retCost * 1.15).toFixed(2)
    returnsTxRows.push({
      id: crypto.randomUUID(), client_id: DEMO_CLIENT_ID, merchant_id: DEMO_MERCHANT_ID,
      transaction_id: demoTxId(), reference_id: String(retId), reference_type: 'Return',
      cost: retCost, base_cost: retCost, surcharge: 0,
      base_charge: retBilled, total_charge: retBilled, billed_amount: retBilled,
      markup_applied: +(retBilled - retCost).toFixed(2), markup_percentage: 15,
      markup_is_preview: false, is_voided: false, currency_code: 'USD',
      charge_date: completedAt.toISOString().split('T')[0],
      fee_type: 'Return', transaction_type: 'Charge',
      fulfillment_center: s.fc_name, invoiced_status_sb: true, invoiced_status_jp: false,
      created_at: completedAt.toISOString(), updated_at: completedAt.toISOString(),
    })
  }

  // === DIQ / Lost-in-Transit Checks — ~2% of undelivered or slow-delivered shipments ===
  const diqRows = []
  const diqCandidates = allShipments.filter(s => {
    if (!s.event_labeled) return false
    const labeledDays = (Date.now() - new Date(s.event_labeled).getTime()) / 86400_000
    if (labeledDays < 4) return false
    if (s.event_delivered) {
      const transit = (new Date(s.event_delivered) - new Date(s.event_labeled)) / 86400_000
      if (transit < 8) return false  // only slow ones
    }
    return Math.random() < 0.02
  })
  for (const s of diqCandidates) {
    const labeledAt = new Date(s.event_labeled)
    const daysInTransit = Math.floor((Date.now() - labeledAt.getTime()) / 86400_000)
    const eligibleAfter = new Date(labeledAt.getTime() + 15 * 86400_000).toISOString().split('T')[0]
    const firstChecked = new Date(labeledAt.getTime() + 3 * 86400_000 + randInt(0, 2 * 86400_000)).toISOString()
    // Allowed: at_risk, eligible, claim_filed, approved, denied, missed_window, returned_to_sender
    const status = s.event_delivered
      ? randomChoice(['returned_to_sender', 'missed_window'])
      : randomChoice(['at_risk', 'at_risk', 'at_risk', 'eligible', 'eligible', 'claim_filed', 'approved', 'denied'])
    const statusBadge = randomChoice(['STUCK', 'STALLED', 'LOST', 'RETURNING', 'NORMAL'])
    const watchReason = randomChoice(['STALLED', 'NO SCAN', 'NEEDS ACTION', 'INTL DELAY', 'DELAYED'])
    diqRows.push({
      shipment_id: s.shipment_id, tracking_number: s.tracking_id, carrier: s.carrier,
      client_id: DEMO_CLIENT_ID, checked_at: firstChecked,
      first_checked_at: firstChecked, last_recheck_at: firstChecked,
      eligible_after: eligibleAfter, is_international: s.destination_country === 'CA',
      claim_eligibility_status: status,
      ai_status_badge: statusBadge, watch_reason: watchReason,
      ai_reshipment_urgency: randInt(20, 95), ai_customer_anxiety: randInt(10, 90),
      ai_risk_level: randomChoice(['LOW', 'MEDIUM', 'HIGH']),
      ai_predicted_outcome: randomChoice(['delivered', 'returned_to_sender', 'lost']),
      days_in_transit: daysInTransit, stuck_duration_days: randInt(0, 10),
      last_scan_date: new Date(Date.now() - randInt(1, 14) * 86400_000).toISOString(),
      last_scan_description: randomChoice(['Arrived at facility', 'In transit', 'Out for delivery attempt', 'Departed facility', 'Processing at carrier']),
      last_scan_location: randomChoice(['Louisville KY', 'Atlanta GA', 'Memphis TN', 'Chicago IL', 'Mississauga ON']),
    })
  }

  // === Insert all ===
  const BATCH = 500
  const insertBatch = async (table, rows) => {
    for (let i = 0; i < rows.length; i += BATCH) {
      const { error } = await supabase.from(table).insert(rows.slice(i, i + BATCH))
      if (error) console.warn(`  [${table}] batch ${i / BATCH}: ${error.message}`)
    }
  }
  await insertBatch('transactions', storageRows)
  await insertBatch('receiving_orders', receivingOrderRows)
  await insertBatch('transactions', receivingTxRows)
  await insertBatch('transactions', additionalTxRows)
  await insertBatch('returns', returnRows)
  await insertBatch('transactions', returnsTxRows)
  await insertBatch('lost_in_transit_checks', diqRows)

  result.storage = storageRows.length
  result.receivingOrders = receivingOrderRows.length
  result.receivingTx = receivingTxRows.length
  result.additionalTx = additionalTxRows.length
  result.returns = returnRows.length
  result.returnsTx = returnsTxRows.length
  result.diqEntries = diqRows.length
  return result
}

main().catch(err => {
  console.error('❌ Backfill failed:', err)
  process.exit(1)
})
