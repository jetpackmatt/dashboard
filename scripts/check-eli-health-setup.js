require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('=== Eli Health Client Setup Check ===\n')

  // Get full Eli Health info including API credentials
  const { data: client } = await supabase
    .from('clients')
    .select(`
      id, company_name, merchant_id, is_active,
      client_api_credentials(api_token, provider)
    `)
    .ilike('company_name', '%eli%')
    .single()

  if (!client) {
    console.log('Eli Health not found!')
    return
  }

  console.log('Client ID:', client.id)
  console.log('Company:', client.company_name)
  console.log('Merchant ID:', client.merchant_id || 'NOT SET')
  console.log('Active:', client.is_active)

  const shipbobCred = client.client_api_credentials?.find(c => c.provider === 'shipbob')
  console.log('ShipBob API Token:', shipbobCred?.api_token ? 'SET (' + shipbobCred.api_token.substring(0, 10) + '...)' : 'NOT SET')

  console.log('\n=== Issues ===')
  if (!client.merchant_id) {
    console.log('❌ merchant_id is NULL - need to set this for attribution')
  }
  if (!shipbobCred?.api_token) {
    console.log('❌ No ShipBob API token - WRO sync won\'t work for this client')
  }

  // Check if there are any receiving_orders for this client
  const { count: wroCount } = await supabase
    .from('receiving_orders')
    .select('*', { count: 'exact', head: true })
    .eq('client_id', client.id)

  console.log('\nReceiving Orders for Eli Health:', wroCount || 0)
}

main().catch(console.error)
