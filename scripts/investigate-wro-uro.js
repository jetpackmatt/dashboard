/**
 * Deep investigation of WRO/URO attribution
 */

require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
)

const SHIPBOB_API = 'https://api.shipbob.com/2025-07'

async function main() {
  console.log('='.repeat(70))
  console.log('DEEP DIVE: WRO/URO TRANSACTION DETAILS')
  console.log('='.repeat(70))

  // Get ALL fields from WRO/URO transactions
  const { data: wroTx } = await supabase
    .from('transactions')
    .select('*')
    .in('reference_type', ['WRO', 'URO'])
    .is('client_id', null)

  console.log('\n--- FULL WRO TRANSACTION STRUCTURE ---')
  const wros = wroTx?.filter(t => t.reference_type === 'WRO') || []
  if (wros.length > 0) {
    console.log('Sample WRO transaction (all fields):')
    console.log(JSON.stringify(wros[0], null, 2))
  }

  console.log('\n--- FULL URO TRANSACTION STRUCTURE ---')
  const uros = wroTx?.filter(t => t.reference_type === 'URO') || []
  if (uros.length > 0) {
    console.log('Sample URO transaction (all fields):')
    console.log(JSON.stringify(uros[0], null, 2))
  }

  // Get clients with tokens
  const { data: clients } = await supabase
    .from('clients')
    .select('id, company_name, client_api_credentials(api_token, provider)')
    .eq('is_active', true)

  console.log('\n--- TRYING RECEIVING API WITH PER-CLIENT TOKENS ---\n')

  const wroIds = wros.map(w => w.reference_id)
  const uroIds = uros.map(u => u.reference_id)

  // Track which WROs/UROs we find
  const foundWros = {}
  const foundUros = {}

  // Try to find WROs via each client's receiving API
  for (const client of clients || []) {
    const cred = client.client_api_credentials?.find(c => c.provider === 'shipbob')
    if (!cred) continue

    console.log(`\nClient: ${client.company_name}`)

    // Try to get the WRO by ID
    for (const wroId of wroIds.slice(0, 2)) {
      const resp = await fetch(`${SHIPBOB_API}/receiving/${wroId}`, {
        headers: { Authorization: `Bearer ${cred.api_token}` }
      })
      console.log(`  GET /receiving/${wroId}: ${resp.status}`)
      if (resp.ok) {
        const data = await resp.json()
        foundWros[wroId] = client.id
        console.log('  FOUND! Data:', JSON.stringify(data, null, 2).slice(0, 500))
      }
    }

    // Also try fetching all receiving orders for this client
    const recResp = await fetch(`${SHIPBOB_API}/receiving?Limit=250&SortOrder=Descending`, {
      headers: { Authorization: `Bearer ${cred.api_token}` }
    })

    if (recResp.ok) {
      const recData = await recResp.json()
      console.log(`  Total receiving orders: ${recData?.length || 0}`)

      // Check if any match our WRO IDs
      for (const rec of recData || []) {
        if (wroIds.includes(rec.id?.toString())) {
          foundWros[rec.id] = client.id
          console.log(`  MATCH: WRO ${rec.id} belongs to ${client.company_name}`)
        }
      }

      // Show latest WRO IDs to compare ranges
      if (recData && recData.length > 0) {
        console.log(`  Latest 5 WRO IDs:`, recData.slice(0, 5).map(r => r.id).join(', '))
      }
    }
  }

  // Check unique URO IDs
  console.log('\n--- URO ID ANALYSIS ---')
  const uniqueUros = [...new Set(uroIds)]
  console.log('Unique URO IDs:', uniqueUros.join(', '))
  console.log('Total URO transactions:', uros.length)
  console.log('Unique URO IDs:', uniqueUros.length)

  // Check if UROs have any patterns
  console.log('\nURO transactions by ID:')
  const uroById = {}
  uros.forEach(u => {
    if (!uroById[u.reference_id]) uroById[u.reference_id] = []
    uroById[u.reference_id].push(u)
  })
  Object.entries(uroById).forEach(([id, txs]) => {
    console.log(`  URO ${id}: ${txs.length} transactions, total $${txs.reduce((s, t) => s + t.amount, 0).toFixed(2)}`)
  })

  // Try billing_receiving matching by other fields
  console.log('\n--- CROSS-REFERENCE WITH BILLING_RECEIVING ---')

  // Get all billing_receiving records
  const { data: billingRec } = await supabase
    .from('billing_receiving')
    .select('*')

  console.log(`Total billing_receiving records: ${billingRec?.length || 0}`)

  // Check fee types in billing_receiving
  const feeTypes = [...new Set(billingRec?.map(r => r.fee_type) || [])]
  console.log('Fee types in billing_receiving:', feeTypes.join(', '))

  // Check for URO records
  const uroRecords = billingRec?.filter(r => r.fee_type?.includes('URO')) || []
  console.log(`URO records in billing_receiving: ${uroRecords.length}`)
  if (uroRecords.length > 0) {
    console.log('Sample URO billing_receiving:')
    uroRecords.slice(0, 3).forEach(r => console.log(JSON.stringify(r, null, 2)))
  }

  // Try matching by amount and date
  console.log('\n--- MATCHING BY AMOUNT + DATE ---')

  for (const uro of uros.slice(0, 5)) {
    const uroDate = new Date(uro.charge_date).toISOString().split('T')[0]
    const matches = billingRec?.filter(r =>
      Math.abs(r.amount - uro.amount) < 0.01 &&
      r.transaction_date === uroDate
    ) || []

    if (matches.length > 0) {
      console.log(`\nURO ${uro.reference_id} ($${uro.amount} on ${uroDate}):`)
      matches.forEach(m => console.log(`  Potential match: ${m.fee_type} - client ${m.client_id}`))
    }
  }

  // Summary
  console.log('\n' + '='.repeat(70))
  console.log('SUMMARY')
  console.log('='.repeat(70))
  console.log(`WROs found via API: ${Object.keys(foundWros).length}/${wroIds.length}`)
  console.log(`UROs found via API: ${Object.keys(foundUros).length}/${uniqueUros.length}`)
}

main().catch(console.error)
