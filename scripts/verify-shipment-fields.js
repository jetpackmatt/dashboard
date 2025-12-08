require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Get a shipped shipment with tracking from DB
  const { data: shipments } = await supabase
    .from('shipments')
    .select('*')
    .not('tracking_id', 'is', null)
    .not('fc_name', 'is', null)
    .order('created_at', { ascending: false })
    .limit(1)

  if (!shipments?.length) {
    console.log('No delivered shipments found')
    return
  }

  const dbShip = shipments[0]
  console.log('='.repeat(80))
  console.log('SHIPMENT FIELD VERIFICATION')
  console.log('='.repeat(80))
  console.log('Shipment ID:', dbShip.shipment_id)
  console.log('Status:', dbShip.status)
  console.log('')

  // Get client token
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .eq('id', dbShip.client_id)
    .limit(1)

  const token = clients?.[0]?.client_api_credentials?.find(c => c.provider === 'shipbob')?.api_token
  if (!token) {
    console.log('No token for client')
    return
  }

  // Fetch shipment from API
  const res = await fetch(`https://api.shipbob.com/2025-07/shipment/${dbShip.shipment_id}`, {
    headers: { Authorization: `Bearer ${token}` }
  })
  const apiShip = await res.json()

  if (apiShip.error) {
    console.log('API error:', apiShip.error)
    return
  }

  console.log('\n--- KEY FIELD COMPARISONS ---')
  const fields = [
    ['created_date', 'created_at', apiShip.created_date, dbShip.created_at],
    ['actual_fulfillment_date', 'label_generation_date', apiShip.actual_fulfillment_date, dbShip.label_generation_date],
    ['status-based', 'shipped_date', '(status='+apiShip.status+')', dbShip.shipped_date],
    ['delivery_date', 'delivered_date', apiShip.delivery_date, dbShip.delivered_date],
    ['location.name', 'fc_name', apiShip.location?.name, dbShip.fc_name],
    ['measurements.total_weight_oz', 'actual_weight_oz', apiShip.measurements?.total_weight_oz, dbShip.actual_weight_oz],
    ['measurements.length_in', 'length', apiShip.measurements?.length_in, dbShip.length],
    ['measurements.width_in', 'width', apiShip.measurements?.width_in, dbShip.width],
    ['measurements.depth_in', 'height', apiShip.measurements?.depth_in, dbShip.height],
    ['package_material_type', 'package_material_type', apiShip.package_material_type, dbShip.package_material_type],
    ['tracking.tracking_number', 'tracking_id', apiShip.tracking?.tracking_number, dbShip.tracking_id],
    ['tracking.carrier', 'carrier', apiShip.tracking?.carrier, dbShip.carrier],
    ['ship_option', 'carrier_service', apiShip.ship_option, dbShip.carrier_service],
  ]

  for (const [apiField, dbField, apiVal, dbVal] of fields) {
    const match = String(apiVal) === String(dbVal) ? '✅' : '❌'
    console.log(`${match} ${apiField.padEnd(30)} | API: ${String(apiVal).slice(0,25).padEnd(25)} | DB: ${String(dbVal).slice(0,25)}`)
  }

  console.log('\n--- COMPUTED FIELDS ---')
  console.log('dim_weight_oz:', dbShip.dim_weight_oz)
  console.log('billable_weight_oz:', dbShip.billable_weight_oz)
  console.log('transit_time_days:', dbShip.transit_time_days)
  console.log('origin_country:', dbShip.origin_country)
  console.log('destination_country:', dbShip.destination_country)
}

main().catch(console.error)
