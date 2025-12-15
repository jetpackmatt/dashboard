/**
 * Find which client owns order 307909309
 */
require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

async function findOwner() {
  const orderId = 307909309

  console.log(`=== FINDING OWNER OF ORDER ${orderId} ===\n`)

  // Get all active clients
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('id, company_name, merchant_id')
    .eq('is_active', true)

  if (clientsError) {
    console.log('Clients query error:', clientsError)
  }

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

  console.log(`Clients query result: ${clients ? clients.length : 'null'}`)
  console.log(`Creds query result: ${allCreds ? allCreds.length : 'null'}`)
  console.log(`CredLookup keys: ${Object.keys(credLookup).length}`)
  console.log(`Checking ${clients?.length || 0} active clients...\n`)

  for (const client of clients || []) {
    const token = credLookup[client.id]

    if (!token) {
      console.log(`${client.company_name}: No ShipBob token, skipping`)
      continue
    }

    try {
      const res = await fetch(`https://api.shipbob.com/1.0/order/${orderId}`, {
        headers: { Authorization: `Bearer ${token}` }
      })

      if (res.ok) {
        const data = await res.json()
        console.log(`✅ ${client.company_name} (${client.id}): FOUND ORDER!`)
        console.log(`   Order Number: ${data.order_number}`)
        console.log(`   Status: ${data.status}`)
        console.log(`   Created: ${data.created_date}`)
        console.log(`   Channel: ${data.channel?.name}`)
        console.log(`   Shipments: ${data.shipments?.length || 0}`)

        // Now let's try to find return 2969524 with the same token
        console.log(`\n   Trying to fetch return 2969524 with this token...`)
        const returnRes = await fetch(`https://api.shipbob.com/1.0/return/2969524`, {
          headers: { Authorization: `Bearer ${token}` }
        })

        if (returnRes.ok) {
          const returnData = await returnRes.json()
          console.log(`   ✅ Return FOUND!`)
          console.log(`   Return Status: ${returnData.status}`)
          console.log(`   Original Shipment: ${returnData.original_shipment_id}`)
          console.log(`   Tracking: ${returnData.tracking_number}`)
          console.log(`   FC: ${returnData.fulfillment_center?.name}`)
        } else {
          console.log(`   ❌ Return NOT found with this token: ${returnRes.status}`)
        }

        return { client, orderData: data }
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

    await new Promise(r => setTimeout(r, 100))
  }

  console.log('\n❌ No client found that owns this order')
  return null
}

findOwner().catch(console.error)
