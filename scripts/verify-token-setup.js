#!/usr/bin/env node
/**
 * Verify client_api_credentials table has tokens
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

// Must use service_role key to access client_api_credentials (RLS blocks anon/authenticated)
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function main() {
  console.log('='.repeat(80))
  console.log('CLIENT TOKEN VERIFICATION')
  console.log('='.repeat(80))

  // Get all clients
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')
    .order('company_name')

  if (clientsError) {
    console.log('Error fetching clients:', clientsError)
    return
  }

  console.log('\nClients in database: ' + clients.length)

  // Get all credentials
  const { data: credentials, error: credsError } = await supabase
    .from('client_api_credentials')
    .select('client_id, provider, created_at')

  if (credsError) {
    console.log('Error fetching credentials:', credsError)
    console.log('(Table may not exist or RLS blocking)')
    return
  }

  console.log('Credentials in database: ' + (credentials?.length || 0))

  // Match clients with credentials
  console.log('\n--- Client Token Status ---')
  for (const client of clients) {
    const cred = credentials?.find(c => c.client_id === client.id)
    const status = cred ? '✅ Has token (created: ' + cred.created_at + ')' : '❌ No token'
    console.log('\n' + client.company_name + ':')
    console.log('  ID: ' + client.id)
    console.log('  Merchant ID: ' + client.merchant_id)
    console.log('  Status: ' + status)
  }

  // Test token retrieval function
  console.log('\n--- Token Retrieval Test ---')
  for (const client of clients) {
    const { data: tokenData, error: tokenError } = await supabase
      .from('client_api_credentials')
      .select('api_token')
      .eq('client_id', client.id)
      .eq('provider', 'shipbob')
      .single()

    if (tokenError) {
      console.log(client.company_name + ': ❌ ' + tokenError.message)
    } else if (tokenData?.api_token) {
      // Show first 10 chars only for security
      const preview = tokenData.api_token.substring(0, 10) + '...'
      console.log(client.company_name + ': ✅ Token found (' + preview + ')')
    } else {
      console.log(client.company_name + ': ❌ No token data')
    }
  }
}

main().catch(console.error)
