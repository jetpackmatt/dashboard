/**
 * Debug clients query
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function check() {
  // Check all clients
  const { data: allClients, error } = await supabase
    .from('clients')
    .select('id, company_name, is_active')

  if (error) {
    console.log('Error:', error)
    return
  }

  console.log('All clients:', allClients)

  // Check client_api_credentials
  const { data: creds, error: credsError } = await supabase
    .from('client_api_credentials')
    .select('client_id, provider')

  if (credsError) {
    console.log('Creds error:', credsError)
    return
  }

  console.log('\nCredentials:', creds)
}

check().catch(console.error)
