#!/usr/bin/env node
/**
 * Seed Paul's Boutique demo client: client row + 20 guitar-accessory SKUs + demo user.
 *
 * Idempotent — safe to re-run. Prints the created demo client UUID at the end
 * (needed by backfill script).
 *
 * Usage:
 *   node scripts/seed-demo.js
 *   node scripts/seed-demo.js --email demo+custom@jetpack3pl.com
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const DEMO_EMAIL_FLAG_INDEX = process.argv.indexOf('--email')
const DEMO_EMAIL = DEMO_EMAIL_FLAG_INDEX >= 0 ? process.argv[DEMO_EMAIL_FLAG_INDEX + 1] : 'demo@jetpack3pl.com'
const DEMO_PASSWORD = 'PaulsBoutique2026!'

const DEMO_CLIENT = {
  company_name: "Paul's Boutique",
  merchant_id: 'DEMO-MERCHANT-001',
  short_code: 'PB',
  is_active: true,
  is_internal: false,
  is_demo: true,
  billing_period: 'weekly',
  billing_terms: 'due_on_receipt',
  billing_currency: 'USD',
  payment_method: 'ach',
  billing_email: DEMO_EMAIL,
  billing_contact_name: 'Paul Jones',
  billing_address: {
    line1: '1275 Folsom St',
    city: 'San Francisco',
    state: 'CA',
    zip: '94103',
    country: 'US',
  },
  next_invoice_number: 1,
  size_label: 'dolphin',
}

// 20 guitar accessory SKUs with realistic metadata.
// shipbob_product_id: 900001-900020 (reserved demo range).
// variants[0].inventory.inventory_id: 900001-900020 (1:1 with product).
const DEMO_PRODUCTS = [
  { id: 900001, name: 'Acoustic Guitar Strings - Light Gauge',     sku: 'PB-ACS-LT',   weight: 0.12, cat: 'strings', price: 9.99 },
  { id: 900002, name: 'Acoustic Guitar Strings - Medium Gauge',    sku: 'PB-ACS-MD',   weight: 0.14, cat: 'strings', price: 9.99 },
  { id: 900003, name: 'Electric Guitar Strings - 9s',              sku: 'PB-ELE-09',   weight: 0.10, cat: 'strings', price: 7.99 },
  { id: 900004, name: 'Electric Guitar Strings - 10s',             sku: 'PB-ELE-10',   weight: 0.11, cat: 'strings', price: 7.99 },
  { id: 900005, name: 'Electric Guitar Strings - 11s',             sku: 'PB-ELE-11',   weight: 0.12, cat: 'strings', price: 8.99 },
  { id: 900006, name: 'Classical Guitar Nylon Strings',            sku: 'PB-CLS-NYL',  weight: 0.09, cat: 'strings', price: 12.99 },
  { id: 900007, name: 'Bass Guitar Strings - 4-String',            sku: 'PB-BAS-4',    weight: 0.22, cat: 'strings', price: 22.99 },
  { id: 900008, name: 'Bass Guitar Strings - 5-String',            sku: 'PB-BAS-5',    weight: 0.28, cat: 'strings', price: 27.99 },
  { id: 900009, name: 'Celluloid Picks - Light 12-Pack',           sku: 'PB-PIK-LT',   weight: 0.03, cat: 'picks',   price: 4.99 },
  { id: 900010, name: 'Celluloid Picks - Medium 12-Pack',          sku: 'PB-PIK-MD',   weight: 0.03, cat: 'picks',   price: 4.99 },
  { id: 900011, name: 'Celluloid Picks - Heavy 12-Pack',           sku: 'PB-PIK-HV',   weight: 0.03, cat: 'picks',   price: 4.99 },
  { id: 900012, name: 'Pick Variety Pack - 24 Assorted',           sku: 'PB-PIK-VAR',  weight: 0.06, cat: 'picks',   price: 9.99 },
  { id: 900013, name: 'Fretboard Conditioner Oil - 2oz',           sku: 'PB-POL-OIL',  weight: 0.25, cat: 'polish',  price: 8.99 },
  { id: 900014, name: 'Guitar Polish Spray - 4oz',                 sku: 'PB-POL-SPR',  weight: 0.32, cat: 'polish',  price: 7.99 },
  { id: 900015, name: 'String Cleaner & Lubricant',                sku: 'PB-POL-CLN',  weight: 0.18, cat: 'polish',  price: 6.99 },
  { id: 900016, name: 'Trigger Capo - Black',                      sku: 'PB-TOO-CAP',  weight: 0.20, cat: 'tools',   price: 14.99 },
  { id: 900017, name: 'Clip-On Chromatic Tuner',                   sku: 'PB-TOO-TUN',  weight: 0.15, cat: 'tools',   price: 11.99 },
  { id: 900018, name: 'String Winder & Cutter Combo',              sku: 'PB-TOO-WND',  weight: 0.12, cat: 'tools',   price: 5.99 },
  { id: 900019, name: 'Woven Guitar Strap - Black/Red',            sku: 'PB-STR-BLK',  weight: 0.30, cat: 'straps',  price: 19.99 },
  { id: 900020, name: 'Instrument Cable - 10ft 1/4"',              sku: 'PB-CAB-10F',  weight: 0.45, cat: 'cables',  price: 15.99 },
]

async function main() {
  console.log("\n🎸 Seeding Paul's Boutique demo client\n")

  // === 1. Upsert client row ===
  const { data: existingClient } = await supabase
    .from('clients')
    .select('id')
    .eq('merchant_id', DEMO_CLIENT.merchant_id)
    .maybeSingle()

  let clientId
  if (existingClient) {
    clientId = existingClient.id
    console.log(`ℹ  Demo client exists: ${clientId}`)
  } else {
    const { data: newClient, error } = await supabase
      .from('clients')
      .insert(DEMO_CLIENT)
      .select('id')
      .single()
    if (error) throw error
    clientId = newClient.id
    console.log(`✓ Created demo client: ${clientId}`)
  }

  // === 2. Upsert 20 products ===
  let productCount = 0
  for (const p of DEMO_PRODUCTS) {
    const variants = [
      {
        id: p.id,
        sku: p.sku,
        name: p.name,
        is_active: true,
        dimension: { weight: p.weight, weight_unit_of_measurement: 'lbs', length: 4, width: 4, height: 2 },
        inventory: {
          on_hand_qty: Math.floor(Math.random() * 5000) + 1000,
          inventory_id: p.id,
          name: p.name,
        },
      },
    ]
    const { error } = await supabase.from('products').upsert(
      {
        client_id: clientId,
        merchant_id: DEMO_CLIENT.merchant_id,
        shipbob_product_id: p.id,
        name: p.name,
        type: 'simple',
        taxonomy: `guitar-accessories/${p.cat}`,
        variants,
        created_on: new Date().toISOString(),
        updated_on: new Date().toISOString(),
        synced_at: new Date().toISOString(),
      },
      { onConflict: 'client_id,shipbob_product_id' }
    )
    if (error) {
      console.error(`  ❌ ${p.sku}: ${error.message}`)
    } else {
      productCount++
    }
  }
  console.log(`✓ Upserted ${productCount}/${DEMO_PRODUCTS.length} products`)

  // === 3. Create / link demo user ===
  const { data: listRes } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 })
  let demoUser = (listRes?.users || []).find(u => u.email === DEMO_EMAIL)

  if (!demoUser) {
    const { data, error } = await supabase.auth.admin.createUser({
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { demo: true },
    })
    if (error) throw error
    demoUser = data.user
    console.log(`✓ Created demo auth user: ${demoUser.id} (${DEMO_EMAIL})`)
    console.log(`  Password: ${DEMO_PASSWORD}`)
  } else {
    console.log(`ℹ  Demo auth user exists: ${demoUser.id}`)
  }

  const { error: ucError } = await supabase
    .from('user_clients')
    .upsert(
      {
        user_id: demoUser.id,
        client_id: clientId,
        role: 'brand_owner',
        permissions: null,
      },
      { onConflict: 'user_id,client_id' }
    )
  if (ucError) throw ucError
  console.log(`✓ user_clients link (brand_owner → ${clientId})`)

  // === 4. Default markup rule (for invoice generation) ===
  const { data: existingRule } = await supabase
    .from('markup_rules')
    .select('id')
    .eq('client_id', clientId)
    .limit(1)
    .maybeSingle()
  if (!existingRule) {
    await supabase.from('markup_rules').insert({
      client_id: clientId,
      name: 'Demo Default',
      markup_type: 'percentage',
      markup_value: 15,
      fee_type: null, // applies to all fee types
      conditions: {},
      priority: 0,
      is_active: true,
      is_additive: false,
      billing_category: null,
      description: 'Default 15% markup for all fees — demo client',
    })
    console.log(`✓ Default 15% markup rule created`)
  } else {
    console.log(`ℹ  Markup rule exists`)
  }

  console.log(`\n==========================================`)
  console.log(`DEMO_CLIENT_ID=${clientId}`)
  console.log(`DEMO_USER_ID=${demoUser.id}`)
  console.log(`DEMO_EMAIL=${DEMO_EMAIL}`)
  console.log(`==========================================\n`)
  console.log(`Next: node scripts/backfill-demo-shipments.js ${clientId}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
