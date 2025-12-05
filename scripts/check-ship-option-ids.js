#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)
const HENSON_ID = '6b94c274-0446-4167-9d02-b998f8be59ad'

async function check() {
  const { data } = await supabase
    .from('shipments')
    .select('carrier_service, ship_option_id')
    .eq('client_id', HENSON_ID)
    .limit(5000)

  const byShipOption = {}
  for (const s of data) {
    const key = s.ship_option_id || 'NULL'
    if (!byShipOption[key]) byShipOption[key] = { count: 0, carrierServices: new Set() }
    byShipOption[key].count++
    if (s.carrier_service) byShipOption[key].carrierServices.add(s.carrier_service)
  }

  console.log('=== SHIP OPTION ID BREAKDOWN ===')
  for (const [id, stats] of Object.entries(byShipOption).sort((a, b) => b[1].count - a[1].count)) {
    console.log(`ship_option_id: ${id} (${stats.count} shipments)`)
    console.log(`  carrier_services: ${[...stats.carrierServices].join(', ')}`)
    console.log('')
  }
}

check().catch(console.error)
