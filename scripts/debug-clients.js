/**
 * Debug clients query
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function debug() {
  console.log('ENV check:')
  console.log('SUPABASE_URL:', process.env.NEXT_PUBLIC_SUPABASE_URL ? 'set' : 'NOT SET')
  console.log('SERVICE_ROLE_KEY:', process.env.SUPABASE_SERVICE_ROLE_KEY ? 'set' : 'NOT SET')
  console.log('')

  // Simple query
  console.log('Query 1: All clients (no filter)')
  const { data: all, error: e1 } = await supabase
    .from('clients')
    .select('id, company_name')

  if (e1) {
    console.log('Error:', e1)
  } else {
    console.log('Result:', all)
  }

  console.log('')

  // Query with is_active filter
  console.log('Query 2: Active clients only')
  const { data: active, error: e2 } = await supabase
    .from('clients')
    .select('id, company_name, is_active')
    .eq('is_active', true)

  if (e2) {
    console.log('Error:', e2)
  } else {
    console.log('Result:', active)
  }

  console.log('')

  // Credentials
  console.log('Query 3: Credentials')
  const { data: creds, error: e3 } = await supabase
    .from('client_api_credentials')
    .select('client_id, provider')

  if (e3) {
    console.log('Error:', e3)
  } else {
    console.log('Result:', creds)
  }
}

debug().catch(console.error)
