require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  // Get a completed shipment to test
  const { data: ships } = await supabase
    .from('shipments')
    .select('id, shipment_id, order_id, shipbob_order_id, client_id, status')
    .eq('status', 'Completed')
    .limit(3)

  console.log('Sample shipments:')
  for (const s of ships) {
    console.log('  shipment_id:', s.shipment_id)
    console.log('  order_id:', s.order_id)
    console.log('  shipbob_order_id:', s.shipbob_order_id)
    console.log('  ---')
  }

  // Get token
  const { data: clients } = await supabase
    .from('clients')
    .select('id, client_api_credentials(api_token, provider)')
    .eq('id', ships[0].client_id)
    .limit(1)

  const token = clients?.[0]?.client_api_credentials?.find(c => c.provider === 'shipbob')?.api_token
  if (!token) { console.log('No token'); return }

  // Test both order_id and shipbob_order_id
  for (const ship of ships) {
    console.log('\n' + '='.repeat(60))
    console.log('Testing shipment:', ship.shipment_id)

    // Try with order_id (our internal UUID)
    console.log('\n1. Using order_id (UUID):', ship.order_id)
    let url = `https://api.shipbob.com/2025-07/order/${ship.order_id}/shipment/${ship.shipment_id}/logs`
    console.log('   URL:', url)
    let res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    console.log('   Status:', res.status)
    if (res.ok) {
      const data = await res.json()
      console.log('   Logs count:', data?.length || 0)
      if (data?.length > 0) {
        console.log('   First log:', data[0].log_type_name)
      }
    } else {
      const errText = await res.text()
      console.log('   Error:', errText.substring(0, 200))
    }

    // Try with shipbob_order_id (ShipBob's integer ID)
    console.log('\n2. Using shipbob_order_id (ShipBob int):', ship.shipbob_order_id)
    url = `https://api.shipbob.com/2025-07/order/${ship.shipbob_order_id}/shipment/${ship.shipment_id}/logs`
    console.log('   URL:', url)
    res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
    console.log('   Status:', res.status)
    if (res.ok) {
      const data = await res.json()
      console.log('   Logs count:', data?.length || 0)
      if (data?.length > 0) {
        console.log('   First 3 logs:')
        data.slice(0, 3).forEach(l => console.log('     -', l.log_type_id, l.log_type_name))
      }
    } else {
      const errText = await res.text()
      console.log('   Error:', errText.substring(0, 200))
    }
  }
}

main().catch(console.error)
