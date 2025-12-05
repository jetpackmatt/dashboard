/**
 * Explore APIs needed for transaction client attribution
 *
 * Goal: Find how to map these reference types to client_id:
 * - FC (Storage): reference_id format {FC_ID}-{InventoryID}-{LocationType}
 * - WRO (Receiving): reference_id is WRO ID
 * - URO (Unidentified Receiving Order): reference_id is URO ID
 * - Return: reference_id is Return ID
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API = 'https://api.shipbob.com/2025-07'

async function main() {
  const parentToken = process.env.SHIPBOB_API_TOKEN

  // Get client tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .eq('is_active', true)

  console.log('='.repeat(70))
  console.log('EXPLORING ATTRIBUTION APIs')
  console.log('='.repeat(70))

  // =====================================================
  // 1. INVENTORY API - for FC (Storage) attribution
  // =====================================================
  console.log('\n\n=== 1. INVENTORY API (for FC/Storage) ===\n')

  // Try listing inventory with parent token
  console.log('Trying GET /inventory with parent token...')
  const invResp = await fetch(`${SHIPBOB_API}/inventory?Limit=5`, {
    headers: { Authorization: `Bearer ${parentToken}` }
  })
  console.log('Status:', invResp.status)

  if (invResp.ok) {
    const invData = await invResp.json()
    console.log('Items returned:', invData?.length || 0)
    if (invData && invData[0]) {
      console.log('Sample inventory item:')
      console.log(JSON.stringify(invData[0], null, 2))
    }
  } else {
    console.log('Response:', await invResp.text())
  }

  // Try with child token
  for (const client of clients || []) {
    const cred = client.client_api_credentials?.find(c => c.provider === 'shipbob')
    if (!cred) continue

    console.log(`\nTrying with ${client.company_name} token...`)
    const resp = await fetch(`${SHIPBOB_API}/inventory?Limit=5`, {
      headers: { Authorization: `Bearer ${cred.api_token}` }
    })
    console.log('Status:', resp.status)
    if (resp.ok) {
      const data = await resp.json()
      console.log('Items:', data?.length || 0)
      if (data && data[0]) {
        console.log('Sample:', JSON.stringify(data[0], null, 2).slice(0, 500))
      }
    }
    break // Just test one client
  }

  // =====================================================
  // 2. RECEIVING API - for WRO/URO attribution
  // =====================================================
  console.log('\n\n=== 2. RECEIVING API (for WRO/URO) ===\n')

  // Get sample WRO IDs from transactions
  const { data: wroTx } = await supabase
    .from('transactions')
    .select('reference_id, transaction_fee, additional_details')
    .eq('reference_type', 'WRO')
    .limit(3)

  console.log('Sample WRO transactions:')
  for (const tx of wroTx || []) {
    console.log(`  WRO ID: ${tx.reference_id} | Fee: ${tx.transaction_fee}`)
    if (tx.additional_details) {
      console.log('    Details:', JSON.stringify(tx.additional_details))
    }
  }

  // Try receiving API with parent token
  console.log('\nTrying GET /receiving with parent token...')
  const recResp = await fetch(`${SHIPBOB_API}/receiving?Limit=5`, {
    headers: { Authorization: `Bearer ${parentToken}` }
  })
  console.log('Status:', recResp.status)
  if (recResp.ok) {
    const data = await recResp.json()
    console.log('Items:', data?.length || 0)
    if (data && data[0]) {
      console.log('Sample WRO:', JSON.stringify(data[0], null, 2).slice(0, 800))
    }
  } else {
    console.log('Response:', await recResp.text())
  }

  // Try with child token
  for (const client of clients || []) {
    const cred = client.client_api_credentials?.find(c => c.provider === 'shipbob')
    if (!cred) continue

    console.log(`\nTrying receiving with ${client.company_name} token...`)
    const resp = await fetch(`${SHIPBOB_API}/receiving?Limit=5`, {
      headers: { Authorization: `Bearer ${cred.api_token}` }
    })
    console.log('Status:', resp.status)
    if (resp.ok) {
      const data = await resp.json()
      console.log('Items:', data?.length || 0)
      if (data && data[0]) {
        console.log('Sample WRO ID:', data[0].id, '| Status:', data[0].status)
      }
    }
    break
  }

  // =====================================================
  // 3. RETURNS API - for Return attribution
  // =====================================================
  console.log('\n\n=== 3. RETURNS API ===\n')

  // Get sample Return IDs
  const { data: retTx } = await supabase
    .from('transactions')
    .select('reference_id, transaction_fee, additional_details')
    .eq('reference_type', 'Return')
    .limit(3)

  console.log('Sample Return transactions:')
  for (const tx of retTx || []) {
    console.log(`  Return ID: ${tx.reference_id} | Fee: ${tx.transaction_fee}`)
    if (tx.additional_details) {
      console.log('    Details:', JSON.stringify(tx.additional_details))
    }
  }

  // Try returns API
  console.log('\nTrying GET /return with parent token...')
  const retResp = await fetch(`${SHIPBOB_API}/return?Limit=5`, {
    headers: { Authorization: `Bearer ${parentToken}` }
  })
  console.log('Status:', retResp.status)
  if (retResp.ok) {
    const data = await retResp.json()
    console.log('Items:', data?.length || 0)
    if (data && data[0]) {
      console.log('Sample return:', JSON.stringify(data[0], null, 2).slice(0, 800))
    }
  } else {
    console.log('Response:', await retResp.text())
  }

  // Try with child token
  for (const client of clients || []) {
    const cred = client.client_api_credentials?.find(c => c.provider === 'shipbob')
    if (!cred) continue

    console.log(`\nTrying returns with ${client.company_name} token...`)
    const resp = await fetch(`${SHIPBOB_API}/return?Limit=5`, {
      headers: { Authorization: `Bearer ${cred.api_token}` }
    })
    console.log('Status:', resp.status)
    if (resp.ok) {
      const data = await resp.json()
      console.log('Items:', data?.length || 0)
      if (data && data[0]) {
        console.log('Sample Return ID:', data[0].id)
      }
    }
    break
  }

  // =====================================================
  // 4. Check billing_* tables for inventory mapping
  // =====================================================
  console.log('\n\n=== 4. CHECKING BILLING_STORAGE TABLE ===\n')

  const { data: storage } = await supabase
    .from('billing_storage')
    .select('*')
    .limit(3)

  if (storage && storage.length > 0) {
    console.log('billing_storage columns:', Object.keys(storage[0]).join(', '))
    console.log('\nSample records:')
    for (const s of storage) {
      console.log(JSON.stringify(s, null, 2))
    }

    // Check if this table has client_id or company linking
    const { count } = await supabase
      .from('billing_storage')
      .select('*', { count: 'exact', head: true })
    console.log('\nTotal billing_storage records:', count)
  }

  // =====================================================
  // SUMMARY
  // =====================================================
  console.log('\n\n' + '='.repeat(70))
  console.log('SUMMARY: ATTRIBUTION STRATEGY')
  console.log('='.repeat(70))
  console.log(`
Based on API exploration, here's the attribution strategy:

1. FC (Storage) - 16,666 transactions
   - additional_details contains InventoryId
   - Need to: Sync inventory via child tokens → build inventory_id→client mapping
   - Or: Use billing_storage table if it has company info

2. WRO (Receiving) - 145 transactions
   - reference_id is the WRO ID
   - Need to: Sync receiving orders via child tokens → build wro_id→client mapping

3. URO (Unidentified Receiving) - 27 transactions
   - Similar to WRO, belongs to receiving category
   - May need special handling

4. Return - 202 transactions
   - reference_id is the Return ID
   - Need to: Sync returns via child tokens → build return_id→client mapping

5. Default (Payments) - 69 transactions (-$478K)
   - These are account-level payments to ShipBob
   - Should NOT be attributed to individual clients
   - Exclude from billing

6. TicketNumber - 4 transactions
   - Manual adjustments
   - May need manual investigation
`)
}

main().catch(console.error)
