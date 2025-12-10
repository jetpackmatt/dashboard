require('dotenv').config({ path: '.env.local' })
const { createClient } = require('@supabase/supabase-js')
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY)

async function main() {
  console.log('=== Fixing WRO Transaction Attribution ===\n')

  // Build WRO lookup from receiving_orders
  const { data: wros } = await supabase
    .from('receiving_orders')
    .select('shipbob_receiving_id, client_id, merchant_id')

  const wroLookup = {}
  for (const wro of wros || []) {
    wroLookup[String(wro.shipbob_receiving_id)] = {
      client_id: wro.client_id,
      merchant_id: wro.merchant_id
    }
  }
  console.log('Built WRO lookup with', Object.keys(wroLookup).length, 'entries')

  // Build clients lookup for merchant_id
  const { data: clients } = await supabase
    .from('clients')
    .select('id, merchant_id, company_name')

  const clientLookup = {}
  for (const c of clients || []) {
    clientLookup[c.id] = { merchant_id: c.merchant_id, name: c.company_name }
  }

  // Get all unattributed WRO transactions
  const { data: txs } = await supabase
    .from('transactions')
    .select('*')
    .is('merchant_id', null)
    .eq('reference_type', 'WRO')

  console.log('Found', txs?.length || 0, 'unattributed WRO transactions\n')

  let fixed = 0
  let skipped = 0

  for (const tx of txs || []) {
    const wroInfo = wroLookup[tx.reference_id]

    if (wroInfo) {
      const clientInfo = clientLookup[wroInfo.client_id]

      const { error } = await supabase
        .from('transactions')
        .update({
          client_id: wroInfo.client_id,
          merchant_id: wroInfo.merchant_id
        })
        .eq('transaction_id', tx.transaction_id)

      if (error) {
        console.log('❌ Error updating', tx.transaction_id, ':', error.message)
      } else {
        fixed++
        console.log('✅ Fixed:', tx.transaction_id, '(WRO', tx.reference_id, ') ->', clientInfo?.name || wroInfo.client_id)
      }
    } else {
      skipped++
      console.log('⏭️  Skipped:', tx.transaction_id, '(WRO', tx.reference_id, ') - not in receiving_orders')
    }
  }

  console.log('\n=== Results ===')
  console.log('Fixed:', fixed)
  console.log('Skipped:', skipped)

  // Recheck unattributed count
  const { count } = await supabase
    .from('transactions')
    .select('*', { count: 'exact', head: true })
    .is('merchant_id', null)

  console.log('\nRemaining unattributed transactions:', count)
}

main().catch(console.error)
