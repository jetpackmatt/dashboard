/**
 * Find which client owns return 2969524 by trying each client's API token
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function findOwner() {
  const returnId = 2969524

  console.log(`=== FINDING OWNER OF RETURN ${returnId} ===\n`)

  // Get all active clients
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, brand_name, merchant_id')
    .eq('is_active', true)

  // Get all credentials separately
  const { data: allCreds } = await supabase
    .from('client_api_credentials')
    .select('client_id, api_token, provider')
    .eq('provider', 'shipbob')

  // Build lookup
  const credLookup = {}
  for (const cred of allCreds || []) {
    credLookup[cred.client_id] = cred.api_token
  }

  console.log(`Found ${clients?.length || 0} active clients\n`)

  for (const client of clients || []) {
    const token = credLookup[client.id]

    if (!token) {
      console.log(`${client.company_name}: No ShipBob token, skipping`)
      continue
    }

    try {
      const res = await fetch(`https://api.shipbob.com/1.0/return/${returnId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.ok) {
        const data = await res.json()
        console.log(`✅ ${client.company_name} (${client.id}): FOUND!`)
        console.log(`   Status: ${data.status}`)
        console.log(`   Original Shipment: ${data.original_shipment_id}`)
        console.log(`   FC: ${data.fulfillment_center?.name}`)
        console.log(`   Channel: ${data.channel?.name}`)
        console.log(`   Reference ID: ${data.reference_id}`)
        console.log(`\n   Full data:`, JSON.stringify(data, null, 2))
        return { client, returnData: data }
      } else if (res.status === 401 || res.status === 403) {
        console.log(`❌ ${client.company_name}: No access (${res.status})`)
      } else if (res.status === 404) {
        console.log(`❌ ${client.company_name}: Not found (404)`)
      } else {
        console.log(`❌ ${client.company_name}: ${res.status}`)
      }
    } catch (e) {
      console.log(`❌ ${client.company_name}: Error - ${e.message}`)
    }

    // Small delay
    await new Promise(r => setTimeout(r, 100))
  }

  console.log('\n❌ No client found that owns this return')
  return null
}

findOwner().catch(console.error)
