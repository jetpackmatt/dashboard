require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  const eliClientId = 'e6220921-695e-41f9-9f49-af3e0cdc828a'

  // Check orders
  const { count: orderCount } = await supabase
    .from('orders')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', eliClientId)

  console.log('Orders for Eli Health:', orderCount || 0)

  // Check shipments
  const { count: shipmentCount } = await supabase
    .from('shipments')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', eliClientId)

  console.log('Shipments for Eli Health:', shipmentCount || 0)

  // Check transactions
  const { count: txCount } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', eliClientId)

  console.log('Transactions for Eli Health:', txCount || 0)

  // If no orders, try to fetch merchant_id from API
  console.log('\n=== Fetching merchant_id from API ===')

  const { data: client } = await supabase
    .from('clients')
    .select('client_api_credentials(api_token, provider)')
    .eq('id', eliClientId)
    .single()

  const token = client?.client_api_credentials?.find(c => c.provider === 'shipbob')?.api_token

  if (!token) {
    console.log('No token found')
    return
  }

  // Fetch channel info to get merchant_id
  const res = await fetch('https://api.shipbob.com/2025-07/channel', {
    headers: { Authorization: `Bearer ${token}` }
  })

  if (!res.ok) {
    console.log('API error:', res.status, res.statusText)
    return
  }

  const channels = await res.json()
  console.log('Channels found:', channels.length)

  if (channels.length > 0) {
    console.log('First channel:', JSON.stringify(channels[0], null, 2))
  }
}

main().catch(console.error)
